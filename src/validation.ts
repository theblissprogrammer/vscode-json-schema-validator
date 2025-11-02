import * as vscode from 'vscode';
import Ajv2020, { ErrorObject } from "ajv/dist/2020";
import betterAjvErrors from '@sidvind/better-ajv-errors';
import * as path from 'path';
import fs from "fs";

import { parse, parseTree, findNodeAtLocation } from 'jsonc-parser';
import { getSchemaSource, getCacheDuration, loadSchema } from './schemaLoader';
import { 
    hasMustacheSyntax, 
    processMustacheTemplate, 
    mapCleanedOffsetToOriginalPosition,
    MustacheProcessResult 
} from './mustacheProcessor';

/**
 * Retrieve the literal value of a `const` keyword by following AJV's schemaPath.
 *
 * @param rootSchema  Your parsed JSON Schema object (the one you compiled with Ajv).
 * @param schemaPath  The AJV ErrorObject.schemaPath, e.g. "#/$defs/ListItem/properties/dlsName/const"
 * @returns            The value of that `const`, or `undefined` if not found.
 */
function getConstFromSchema(rootSchema: any, schemaPath: string): any | undefined {
    // strip the leading "#/"
    if (!schemaPath.startsWith('#/')) {
        return undefined;
    }
    const parts = schemaPath.slice(2).split('/').map(p =>
        // unescape JSON-Pointer tokens
        p.replace(/~1/g, '/').replace(/~0/g, '~')
    );

    let node: any = rootSchema;
    for (const part of parts) {
        if (node === undefined) {
            return undefined;
        }
        // if we're in an array (e.g. oneOf), convert the part to a number
        if (Array.isArray(node)) {
            const idx = parseInt(part, 10);
            if (isNaN(idx) || idx < 0 || idx >= node.length) {
                return undefined;
            }
            node = node[idx];
        } else {
            node = node[part];
        }
    }
    // `node` should now be the literal value (for {"const":"ListItem"} → "ListItem")
    return node;
}

export async function runValidation(
    doc: vscode.TextDocument, 
    onSave = false,
    diagnostics: vscode.DiagnosticCollection,
    statusBar: vscode.StatusBarItem,
    outputChannel: vscode.OutputChannel
) {
    // Clear channel
    outputChannel.clear();
    outputChannel.show(true);
    
    // only JSON/JSONC or .json.mustache files
    const isMustacheFile = doc.uri.fsPath.endsWith('.json.mustache');
    if (!['json', 'jsonc'].includes(doc.languageId) && !isMustacheFile) {
        return;
    }

    const dataPath = doc.uri.fsPath;
    const projectRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!projectRoot) {
        return vscode.window.showErrorMessage('Open a workspace folder first.');
    }

    const schemaSource = getSchemaSource(projectRoot);
    
    // **SKIP** validating the schema file itself (only for file-based schemas)
    if (!schemaSource.startsWith('http://') && !schemaSource.startsWith('https://')) {
        if (doc.uri.fsPath === schemaSource) {
            return;
        }
    }

    outputChannel.appendLine(`\n▶ Running validation on ${path.basename(dataPath)}`);

    // clear old diagnostics
    diagnostics.delete(doc.uri);

    // show validating in status bar
    statusBar.text = '$(sync~spin) Validating JSON…';
    statusBar.show();

    // parse JSONC
    const raw = onSave
        ? fs.readFileSync(doc.uri.fsPath, 'utf8')
        : doc.getText();

    // Check for mustache syntax and process if it's a .json.mustache file
    let mustacheResult: MustacheProcessResult | undefined;
    let textToValidate = raw;
    
    if (isMustacheFile && hasMustacheSyntax(raw)) {
        mustacheResult = processMustacheTemplate(raw);
        textToValidate = mustacheResult.cleanedText;
        outputChannel.appendLine(`🎭 Mustache template processed (${mustacheResult.mappings.filter(m => m.type === 'mustache').length} expressions)`);
    }

    // strip comments & trailing commas into a JS object:
    let data: any;
    try {
        data = parse(textToValidate, undefined, { allowTrailingComma: true });
    } catch {
        // invalid syntax: bail or add syntax diagnostic here
        diagnostics.set(doc.uri, [
            new vscode.Diagnostic(
                new vscode.Range(0, 0, 0, 1),
                mustacheResult 
                    ? 'Invalid JSON syntax (after mustache processing)' 
                    : 'Invalid JSON syntax',
                vscode.DiagnosticSeverity.Error
            )
        ]);
        statusBar.text = '$(error) JSON Syntax Error';
        return;
    }

    // Build your AST for pointer‐based diagnostics:
    const root = parseTree(textToValidate);
    if (!root) {
        statusBar.text = '$(error) JSON Syntax Error';
        return;
    }

    let schema: any;
    try {
        const cacheDuration = getCacheDuration();
        schema = await loadSchema(schemaSource, cacheDuration, outputChannel);
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`❌ Failed to load schema: ${errMsg}`);
        vscode.window.showErrorMessage(`Failed to load schema: ${errMsg}`);
        statusBar.text = '$(error) Schema Load Failed';
        return;
    }

    const ajv = new Ajv2020({
        allErrors: true,
        strictTypes: false,
        strictSchema: false,
        allowUnionTypes: true,
        validateFormats: false,
    });

    const validate = ajv.compile(schema);
    const valid = validate(data);

    if (valid) {
        outputChannel.appendLine(`✅ JSON is valid!`);
        vscode.window.showInformationMessage('✅ JSON is valid!');
        statusBar.text = '$(check) JSON OK';
        // clear after a couple seconds
        setTimeout(() => {
            if (statusBar.text?.includes('JSON OK')) {
                statusBar.hide();
            }
        }, 2000);
        return;
    } else {
        vscode.window.showInformationMessage('❌ Validation errors found');
        if (validate.errors) {
            const diags = diagnosticsFromBetterErrors(
                schema,
                data,
                validate.errors,
                doc,
                outputChannel,
                textToValidate,
                mustacheResult
            );
            diagnostics.set(doc.uri, diags);
            statusBar.text = `$(error) ${diags.length} JSON Error(s)`;
            statusBar.show();
        }
    }
};


function diagnosticsFromBetterErrors(
    schema: unknown,
    data: unknown,
    errors: ErrorObject[] | null,
    doc: vscode.TextDocument,
    outputChannel: vscode.OutputChannel,
    validatedText?: string,
    mustacheResult?: MustacheProcessResult
): vscode.Diagnostic[] {
    if (!errors) {
        return [];
    }

    // Use the validated text (cleaned) for parsing, or fall back to document text
    const textForParsing = validatedText || doc.getText();
    const root = parseTree(textForParsing);
    if (!root) {
        return [];
    }

    // === 1) Filter out errors that shouldn't be shown ===
    const filteredErrors = errors.filter(err => {
        // Skip "if" keyword - these are just condition checks, not validation errors
        if (err.keyword === 'if') {
            return false;
        }
        
        // For mustache files, skip type/format errors on fields that originally had mustache syntax
        if (mustacheResult && mustacheResult.hasMustache) {
            // Find the original value at this path by checking the mappings
            // If the error points to a location that was a mustache expression, skip type validation
            const pathArr = err.instancePath.split('/').slice(1)
                .map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))
                .map(s => /^\d+$/.test(s) ? +s : s);
            
            const node = findNodeAtLocation(root, pathArr);
            if (node) {
                // Check if this node's range overlaps with any mustache expression
                // We check the entire node range (start to end) not just the offset
                const nodeStart = node.offset;
                const nodeEnd = node.offset + node.length;
                
                const wasMustache = mustacheResult.mappings.some(m => {
                    if (m.type !== 'mustache' || m.replacement === '') {
                        return false;
                    }
                    // Check if the node overlaps with this mustache mapping
                    // Either the node starts within the mapping, or the mapping is within the node
                    const overlaps = (nodeStart >= m.cleanedStart && nodeStart < m.cleanedEnd) ||
                                   (nodeEnd > m.cleanedStart && nodeEnd <= m.cleanedEnd) ||
                                   (m.cleanedStart >= nodeStart && m.cleanedStart < nodeEnd);
                    return overlaps;
                });
                
                if (wasMustache) {
                    // This field was originally a mustache expression
                    // Skip type/format/enum/const/pattern validation for it
                    if (['type', 'format', 'enum', 'const', 'pattern'].includes(err.keyword)) {
                        return false;
                    }
                }
            }
        }
        
        return true;
    });
    
    // Show detailed errors for debugging
    if (filteredErrors.length > 0) {
        outputChannel.appendLine(`\n📋 Detailed errors:`);
        filteredErrors.forEach((err, idx) => {
            outputChannel.appendLine(`\nError ${idx + 1}:`);
            outputChannel.appendLine(`   keyword: ${err.keyword}`);
            outputChannel.appendLine(`   instancePath: ${err.instancePath}`);
            outputChannel.appendLine(`   schemaPath: ${err.schemaPath}`);
            outputChannel.appendLine(`   message: ${err.message}`);
            if (err.params) {
                outputChannel.appendLine(`   params: ${JSON.stringify(err.params)}`);
            }
        });
        outputChannel.appendLine('');
    }

    // === 2) Deduplicate errors by instancePath ===
    // Show all unique errors without aggressive depth filtering
    // This ensures all validation errors are visible to the user
    const seen = new Set<string>();
    const uniqueErrors: ErrorObject[] = [];
    for (const err of filteredErrors) {
        if (!seen.has(err.instancePath)) {
            seen.add(err.instancePath);
            uniqueErrors.push(err);
        }
    }

    const diags: vscode.Diagnostic[] = [];

    for (const err of uniqueErrors) {
        // --- find the precise AST node for this error ---
        const rawSegs = err.instancePath
            .split('/').slice(1)
            .map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
        // convert numeric segments to numbers
        const pathArr: (string | number)[] = rawSegs.map(s => /^\d+$/.test(s) ? +s : s);

        let node = findNodeAtLocation(root, pathArr);
        
        // Special handling for additionalProperties - highlight just the property name, not the whole object
        if (err.keyword === 'additionalProperties' && node && node.type === 'object') {
            const additionalProp = (err.params as any).additionalProperty as string;
            if (additionalProp && node.children) {
                // Find the specific property node within the object
                const propNode = node.children.find(child => 
                    child.type === 'property' && 
                    child.children && 
                    child.children[0]?.value === additionalProp
                );
                if (propNode && propNode.children && propNode.children[0]) {
                    // Use the property key node (the name), not the whole property
                    node = propNode.children[0];
                }
            }
        }
        
        let range: vscode.Range;

        if (node) {
            // highlight exactly the node
            // If mustache processing was done, map positions back to original
            if (mustacheResult) {
                const originalStart = mapCleanedOffsetToOriginalPosition(
                    node.offset,
                    doc,
                    mustacheResult.mappings
                );
                const originalEnd = mapCleanedOffsetToOriginalPosition(
                    node.offset + node.length,
                    doc,
                    mustacheResult.mappings
                );
                range = new vscode.Range(originalStart, originalEnd);
            } else {
                const start = doc.positionAt(node.offset);
                const end = doc.positionAt(node.offset + node.length);
                range = new vscode.Range(start, end);
            }
        } else {
            // fallback: use the code-frame line from better-errors
            const frame = betterAjvErrors(schema, data, [err], { format: 'cli', indent: 2 });
            const m = frame.match(/^\s*> *(\d+)\s*\|/m);
            const line = m ? +m[1] - 1 : 0;
            const text = doc.lineAt(line).text;
            range = new vscode.Range(
                new vscode.Position(line, 0),
                new vscode.Position(line, text.length)
            );
        }

        // --- find the nearest dlsName to prefix the message ---
        let compName: string | undefined;
        for (let len = pathArr.length; len >= 0; len--) {
            const cand = pathArr.slice(0, len).concat('dlsName');
            const dls = findNodeAtLocation(root, cand);
            if (dls?.value && typeof dls.value === 'string') {
                compName = dls.value;
                break;
            }
        }

        const header = compName ? `[${compName}]` : '[Unknown]';
        
        // Check if error comes from conditional schema (allOf, if/then/else)
        const isConditional = err.schemaPath.includes('/allOf/') || 
                             err.schemaPath.includes('/if/') || 
                             err.schemaPath.includes('/then/') ||
                             err.schemaPath.includes('/else/');
        
        // Enhance message based on error type
        let msg = `${header} ${err.instancePath} → ${err.message}`;
        let severity = vscode.DiagnosticSeverity.Error;
        
        if (err.keyword === 'additionalProperties') {
            const extra = (err.params as any).additionalProperty as string;
            msg = `${header} ${err.instancePath} → has additional property "${extra}" (not allowed by schema)`;
            severity = vscode.DiagnosticSeverity.Warning; // Additional properties are warnings
        } else if (err.keyword === 'required') {
            const missingProp = (err.params as any).missingProperty as string;
            if (isConditional) {
                // Extract which allOf branch for better context
                const branchMatch = err.schemaPath.match(/allOf\/(\d+)/);
                const branchNum = branchMatch ? `branch ${branchMatch[1]}` : 'conditional schema';
                msg = `${header} ${err.instancePath} → missing required property "${missingProp}" (required by ${branchNum})`;
            } else {
                msg = `${header} ${err.instancePath} → missing required property "${missingProp}"`;
            }
        } else if (err.keyword === 'then' || err.keyword === 'else') {
            // Don't show generic then/else errors, show the actual validation errors instead
            msg = `${header} ${err.instancePath} → ${err.message}`;
        } else if (err.keyword === 'enum') {
            const allowedValues = (err.params as any).allowedValues as unknown[];
            if (Array.isArray(allowedValues) && allowedValues.length > 0) {
                const valueList = allowedValues.map(v => JSON.stringify(v)).join(', ');
                msg = `${header} ${err.instancePath} → must be one of: ${valueList}`;
            }
        } else if (isConditional) {
            // Add context for other errors from conditional schemas
            msg = `${header} ${err.instancePath} → ${err.message} (from conditional schema)`;
        }
        
        const icon = severity === vscode.DiagnosticSeverity.Warning ? '⚠️ ' : '❌';
        outputChannel.appendLine(`${icon} ${msg}`);

        const diag = new vscode.Diagnostic(range, msg, severity);

        if (err.keyword === 'additionalProperties') {
            const extra = (err.params as any).additionalProperty as string;
            diag.code = extra;
        }

        // 2) capture const as before
        if (err.keyword === 'const') {
            const allowed = (err.params as any).allowedValue
                ?? getConstFromSchema(schema, err.schemaPath);
            if (allowed !== undefined) {
                // store literal or JSON-stringified for objects/numbers
                diag.code = typeof allowed === 'string' || typeof allowed === 'number'
                    ? allowed
                    : JSON.stringify(allowed);
            }
        }

        // 3) **new**: capture enum values
        if (err.keyword === 'enum') {
            const allowedArr = (err.params as any).allowedValues as unknown[];
            if (Array.isArray(allowedArr)) {
                // diag.code only accepts string or number, so stringify
                diag.code = JSON.stringify(allowedArr);
            }
        }

        diags.push(diag);
    }

    return diags;
}