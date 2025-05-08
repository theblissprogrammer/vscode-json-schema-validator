import * as vscode from 'vscode';
import Ajv2020, { ErrorObject } from "ajv/dist/2020";
import betterAjvErrors from '@sidvind/better-ajv-errors';
import { parseTree, findNodeAtLocation, Node } from 'jsonc-parser';
import * as fs from 'fs';

export class JsonQuickFixProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix
    ];

    constructor(private schemaPath: string) { }

    public provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range,
        context: vscode.CodeActionContext
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        // load schema once
        const schema = JSON.parse(fs.readFileSync(this.schemaPath, 'utf8'));

        for (const diag of context.diagnostics) {
            const msg = diag.message;

            // 1) boolean toggle
            if (msg.includes('must be boolean')) {
                actions.push(this.createBooleanFix(document, diag));
            }

            // 2) number conversion
            if (msg.includes('must be number')) {
                actions.push(this.createNumberFix(document, diag));
            }

            // 3) string conversion
            if (msg.includes('must be string')) {
                actions.push(this.createStringFix(document, diag));
            }

            // --- enum fixes ---
            if (msg.includes('must be equal to one of the allowed values') && typeof diag.code === 'string') {
                let allowed: unknown[];
                try {
                    allowed = JSON.parse(diag.code);
                } catch {
                    continue;
                }
                for (const val of allowed) {
                    const lit = JSON.stringify(val);
                    const title = `Replace with ${lit}`;
                    const fix = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
                    fix.diagnostics = [diag];
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(document.uri, diag.range, lit);
                    fix.edit = edit;
                    actions.push(fix);
                }
                continue;
            }

            // --- const fix (single) ---
            if (msg.includes('must be equal to constant') && diag.code !== undefined) {
                const lit = JSON.stringify(diag.code);
                const title = `Set to constant ${lit}`;
                const fix = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
                fix.diagnostics = [diag];
                const edit = new vscode.WorkspaceEdit();
                edit.replace(document.uri, diag.range, lit);
                fix.edit = edit;
                actions.push(fix);
                continue;
            }

            // 5) remove additional property
            if (diag.code && msg.includes('must NOT have additional properties')) {
                actions.push(this.createRemovePropertyFix(document, diag));
            }

            // 6) missing required property
            const miss = msg.match(/must have required property '(.+)'/);
            if (miss) {
                const propName = miss[1];
                actions.push(this.createInsertPropertyFix(document, diag, propName, schema));
            }
        }

        return actions;
    }

    // 1) Boolean toggle
    private createBooleanFix(
        doc: vscode.TextDocument,
        diag: vscode.Diagnostic
    ): vscode.CodeAction {
        // grab whatever was under the squiggle
        const oldText = doc.getText(diag.range).trim().toLowerCase();
        // if it contains “true” → true, otherwise → false
        const newVal = oldText.includes('true') ? 'true' : 'false';
        const title = `Convert to boolean ${newVal}`;

        const fix = new vscode.CodeAction(
            title,
            vscode.CodeActionKind.QuickFix
        );
        fix.diagnostics = [diag];
        const edit = new vscode.WorkspaceEdit();
        edit.replace(doc.uri, diag.range, newVal);
        fix.edit = edit;
        return fix;
    }

    // 2) Number conversion
    private createNumberFix(
        doc: vscode.TextDocument,
        diag: vscode.Diagnostic
    ): vscode.CodeAction {
        const txt = doc.getText(diag.range).trim().replace(/^['"]|['"]$/g, '');
        const num = isNaN(+txt) ? 0 : +txt;
        const title = `Convert to number ${num}`;
        const fix = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        fix.diagnostics = [diag];
        fix.edit = new vscode.WorkspaceEdit();
        fix.edit.replace(doc.uri, diag.range, String(num));
        return fix;
    }

    // 3) String conversion
    private createStringFix(
        doc: vscode.TextDocument,
        diag: vscode.Diagnostic
    ): vscode.CodeAction {
        const raw = doc.getText(diag.range).trim();
        const content = raw.replace(/^['"]|['"]$/g, '');
        const lit = JSON.stringify(content);
        const title = `Convert to string ${lit}`;
        const fix = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        fix.diagnostics = [diag];
        fix.edit = new vscode.WorkspaceEdit();
        fix.edit.replace(doc.uri, diag.range, lit);
        return fix;
    }

    // 4) Const fix, uses Ajv params.allowedValue
    private createConstFix(
        doc: vscode.TextDocument,
        diag: vscode.Diagnostic,
        allowedValue: any
    ): vscode.CodeAction {
        const lit = JSON.stringify(allowedValue);
        const title = `Set to constant ${lit}`;
        const fix = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        fix.diagnostics = [diag];
        fix.edit = new vscode.WorkspaceEdit();
        fix.edit.replace(doc.uri, diag.range, lit);
        return fix;
    }

    // 5) Remove extra property
    private createRemovePropertyFix(
        doc: vscode.TextDocument,
        diag: vscode.Diagnostic
    ): vscode.CodeAction {
        const propName = diag.code as string;            // e.g. "icon"
        const title = `Remove property "${propName}"`;
        const fix = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        fix.diagnostics = [diag];

        const raw = doc.getText();
        const root = parseTree(raw)!;

        // 1) get the pointer to the *parent* object from your diag.message
        //    e.g. "[ListItem] /…/props/accessory → must NOT …"
        const pointer = diag.message.split(' ')[1];      // "/sections/0/.../props/accessory"
        const segments = pointer
            .slice(1)                                      // drop leading '/'
            .split('/')
            .map(seg => seg.replace(/~1/g, '/').replace(/~0/g, '~'))
            // convert numeric segments to numbers so jsonc-parser can find them
            .map(s => /^\d+$/.test(s) ? Number(s) : s);

        // 2) locate the *object node* in the AST
        const parentNode = findNodeAtLocation(root, segments) as Node | undefined;
        if (!parentNode || !parentNode.children) {
            return fix; // nothing to remove
        }

        // 3) find the child property node whose key === propName
        let deleteRange: vscode.Range | undefined;
        for (const propNode of parentNode.children) {
            const [keyNode, valueNode] = propNode.children!;
            if (keyNode.value === propName) {
                // we want to delete from the start of this property to its end,
                // including a trailing comma if there is one:
                let startOffset = propNode.offset;
                let endOffset = propNode.offset + propNode.length;
                if (raw[endOffset] === ',') {
                    endOffset++;
                }
                const startPos = doc.positionAt(startOffset);
                const endPos = doc.positionAt(endOffset);
                deleteRange = new vscode.Range(startPos, endPos);
                break;
            }
        }

        if (deleteRange) {
            const edit = new vscode.WorkspaceEdit();
            edit.delete(doc.uri, deleteRange);
            fix.edit = edit;
        }

        return fix;
    }

    // 6) Insert missing property, defaulting intelligently
    private createInsertPropertyFix(
        doc: vscode.TextDocument,
        diag: vscode.Diagnostic,
        propName: string,
        schema: any
    ): vscode.CodeAction {
        const title = `Add missing property "${propName}"`;
        const fix = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        fix.diagnostics = [diag];

        const raw = doc.getText();
        const root = parseTree(raw)!;
        // find object node to insert into
        const line = diag.range.start.line;
        const indent = doc.lineAt(line).firstNonWhitespaceCharacterIndex;
        const insertPos = new vscode.Position(line + 1, indent);

        // attempt to pull default from schema
        let def = 'null';
        const pointer = diag.message.split(' ')[1];
        const path = pointer.split('/').slice(1, -1); // path to object
        let subschema = schema;
        for (const seg of path) {
            subschema = subschema.properties?.[seg] || subschema.items?.[+seg] || subschema;
        }
        const propSchema = subschema.properties?.[propName] || {};
        if (propSchema.default !== undefined) {
            def = JSON.stringify(propSchema.default);
        } else if (propSchema.type === 'string') {
            def = '""';
        } else if (propSchema.type === 'boolean') {
            def = 'false';
        } else if (propSchema.type === 'number' || propSchema.type === 'integer') {
            def = '0';
        } else if (propSchema.type === 'array') {
            def = '[]';
        } else if (propSchema.type === 'object') {
            def = '{}';
        }

        const text = `\n${' '.repeat(indent)}"${propName}": ${def},`;
        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, insertPos, text);
        fix.edit = edit;
        return fix;
    }
}