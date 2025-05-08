import * as vscode from 'vscode';
import Ajv2020, { ErrorObject } from "ajv/dist/2020";
import betterAjvErrors from '@sidvind/better-ajv-errors';
import * as path from 'path';
import fs from "fs";

import { parse, parseTree, findNodeAtLocation } from 'jsonc-parser';

let outputChannel: vscode.OutputChannel;
let diagnostics: vscode.DiagnosticCollection;

let statusBar: vscode.StatusBarItem;

// a small debounce map: one timer per URI
const typingTimers = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 500;

export function activate(context: vscode.ExtensionContext) {
	diagnostics = vscode.languages.createDiagnosticCollection('json-schema');
	context.subscriptions.push(diagnostics);
	// create once
	outputChannel = vscode.window.createOutputChannel('JSON Validator');
	context.subscriptions.push(outputChannel);

	statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBar.command = 'extension.validateJson';
	context.subscriptions.push(statusBar);

	const runValidation = (doc: vscode.TextDocument, onSave = false) => {
		// only JSON/C
		if (!['json', 'jsonc'].includes(doc.languageId)) return;

		const dataPath = doc.uri.fsPath;
		const projectRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		if (!projectRoot) {
			return vscode.window.showErrorMessage('Open a workspace folder first.');
		}

		const schemaPath = vscode.workspace.getConfiguration('jsonSchemaValidator').get<string>('schemaPath')!;
		const schemaFullPath = path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', schemaPath);

		// **SKIP** validating the schema file itself
		if (doc.uri.fsPath === schemaFullPath) {
			return;
		}

		// reuse the same channel
		outputChannel.clear();
		outputChannel.show(true);
		outputChannel.appendLine(`▶ Running validation on ${path.basename(dataPath)}`);

		// clear old diagnostics
		diagnostics.delete(doc.uri);

		// show validating in status bar
		statusBar.text = '$(sync~spin) Validating JSON…';
		statusBar.show();

		// parse JSONC
		const raw = onSave
			? fs.readFileSync(doc.uri.fsPath, 'utf8')
			: doc.getText();

		// strip comments & trailing commas into a JS object:
		let data: any;
		try {
			data = parse(raw, undefined, { allowTrailingComma: true });
		} catch {
			// invalid syntax: bail or add syntax diagnostic here
			diagnostics.set(doc.uri, [
				new vscode.Diagnostic(
					new vscode.Range(0, 0, 0, 1),
					'Invalid JSON syntax',
					vscode.DiagnosticSeverity.Error
				)
			]);
			statusBar.text = '$(error) JSON Syntax Error';
			return;
		}

		// Build your AST for pointer‐based diagnostics:
		const root = parseTree(raw);
		if (!root) {
			statusBar.text = '$(error) JSON Syntax Error';
			return;
		}

		const schema = JSON.parse(fs.readFileSync(path.resolve(schemaFullPath), "utf8"));

		const ajv = new Ajv2020({
			allErrors: true,
			strictTypes: false,
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
			vscode.window.showInformationMessage('❌ Validation errors:');
			if (validate.errors) {
				const diags = diagnosticsFromBetterErrors(
					schema,
					data,
					validate.errors,
					doc
				);
				diagnostics.set(doc.uri, diags);
				statusBar.text = `$(error) ${diags.length} JSON Error(s)`;
				statusBar.show();
			}
			process.exit(1);
		}
	};

	// 1) Run when user explicitly invokes the command
	const disposable = vscode.commands.registerCommand('extension.validateJson', () => {
		const doc = vscode.window.activeTextEditor?.document;
		if (doc) runValidation(doc, true);
	});
	context.subscriptions.push(disposable);

	// **On type** (debounced)
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(e => {
			const doc = e.document;
			if (!['json', 'jsonc'].includes(doc.languageId)) return;

			const key = doc.uri.toString();
			clearTimeout(typingTimers.get(key)!);
			const handle = setTimeout(() => {
				runValidation(doc, false);
				typingTimers.delete(key);
			}, DEBOUNCE_MS);
			typingTimers.set(key, handle);
		})
	);

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			['json', 'jsonc'],
			new JsonQuickFixProvider(),
			{ providedCodeActionKinds: JsonQuickFixProvider.providedCodeActionKinds }
		)
	);
}

class JsonQuickFixProvider implements vscode.CodeActionProvider {
	// we only provide QuickFixes
	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix
	];

	public provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range,
		context: vscode.CodeActionContext,
		token: vscode.CancellationToken
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];

		for (const diag of context.diagnostics) {
			const msg = diag.message;

			// A) Fix boolean/null type mismatches
			if (msg.includes('must be boolean,null')) {
				const fix = this.createBooleanFix(document, diag);
				actions.push(fix);
			}

			// B) Fix missing required property
			const missing = msg.match(/must have required property '(.+)'/);
			if (missing) {
				const propName = missing[1];
				const fix = this.createInsertPropertyFix(document, diag, propName);
				actions.push(fix);
			}
		}

		return actions;
	}

	// A) Replace the existing value with `false` (or `true`) to satisfy boolean
	private createBooleanFix(
		doc: vscode.TextDocument,
		diag: vscode.Diagnostic
	  ): vscode.CodeAction {
		const fix = new vscode.CodeAction(
		  'Convert to actual boolean',
		  vscode.CodeActionKind.QuickFix
		);
		fix.diagnostics = [diag];
		fix.isPreferred = true;
	  
		// 1) Grab the existing text (including quotes, if it was a string)
		const oldText = doc.getText(diag.range).trim();      // e.g. `"true"` or `"false"`
	  
		// 2) Decide the new boolean literal
		//    If it was the *string* `"true"` (or case variants), use true; otherwise false
		const lower = oldText.toLowerCase();
		const newVal =
		  lower === `"true"` || lower === 'true'
			? 'true'
			: 'false';
	  
		// 3) Create an edit that replaces exactly that node range
		const edit = new vscode.WorkspaceEdit();
		edit.replace(doc.uri, diag.range, newVal);
	  
		fix.edit = edit;
		return fix;
	  }

	// B) Insert a missing property with a default value
	private createInsertPropertyFix(
		doc: vscode.TextDocument,
		diag: vscode.Diagnostic,
		propName: string
	): vscode.CodeAction {
		const fix = new vscode.CodeAction(
			`Add missing property "${propName}"`,
			vscode.CodeActionKind.QuickFix
		);
		fix.diagnostics = [diag];
		fix.isPreferred = true;

		const edit = new vscode.WorkspaceEdit();

		// Strategy: find the object node containing this diag.range
		// and insert `"propName": <default>,` on the next line
		const lineNum = diag.range.start.line;
		const indent = doc.lineAt(lineNum).firstNonWhitespaceCharacterIndex;
		const insertPos = new vscode.Position(lineNum + 1, indent);
		const defaultValue = 'null'; // or choose based on schema

		const snippet =
			`\n${' '.repeat(indent)}"${propName}": ${defaultValue},`;

		edit.insert(doc.uri, insertPos, snippet);
		fix.edit = edit;
		return fix;
	}
}


export function diagnosticsFromBetterErrors(
	schema: unknown,
	data: unknown,
	errors: ErrorObject[] | null,
	doc: vscode.TextDocument
): vscode.Diagnostic[] {
	if (!errors) return [];

	const raw = doc.getText();
	const root = parseTree(raw);
	if (!root) return [];

	// === 1) group & pick only the deepest errors per component ===
	const groups: Record<string, ErrorObject[]> = {};
	for (const err of errors) {
		const segs = err.instancePath.split('/').slice(1);
		const idx = segs.indexOf('components');
		const key = idx >= 0 ? '/' + segs.slice(0, idx + 2).join('/') : '/';
		(groups[key] ||= []).push(err);
	}
	const rootErrors: ErrorObject[] = [];
	for (const errs of Object.values(groups)) {
		const maxLen = Math.max(...errs.map(e => e.instancePath.split('/').length));
		rootErrors.push(...errs.filter(e => e.instancePath.split('/').length === maxLen));
	}

	const diags: vscode.Diagnostic[] = [];

	for (const err of rootErrors) {
		// --- find the precise AST node for this error ---
		const rawSegs = err.instancePath
			.split('/').slice(1)
			.map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
		// convert numeric segments to numbers
		const pathArr: (string | number)[] = rawSegs.map(s => /^\d+$/.test(s) ? +s : s);

		const node = findNodeAtLocation(root, pathArr);
		let range: vscode.Range;

		if (node) {
			// highlight exactly the node
			const start = doc.positionAt(node.offset);
			const end = doc.positionAt(node.offset + node.length);
			range = new vscode.Range(start, end);
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
		const msg = `${header} ${err.instancePath} → ${err.message}`;

		outputChannel.appendLine(`❌ ${msg}`);
		diags.push(new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Error));
	}

	return diags;
}

export function deactivate() {
	outputChannel.dispose();
	diagnostics.clear();
	statusBar.dispose();
}
