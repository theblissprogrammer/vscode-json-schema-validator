import * as vscode from 'vscode';
import { exec } from 'child_process';
import Ajv2020, { ErrorObject } from "ajv/dist/2020";
import betterAjvErrors from '@sidvind/better-ajv-errors';
import * as path from 'path';
import fs from "fs";

import { parseTree, findNodeAtLocation } from 'jsonc-parser';

let outputChannel: vscode.OutputChannel;
let diagnostics: vscode.DiagnosticCollection;

function diagnosticsFromBetterErrors(
	schema: unknown,
	data: unknown,
	errors: ErrorObject[] | null,
	doc: vscode.TextDocument
): vscode.Diagnostic[] {
	if (!errors) return [];

	const diags: vscode.Diagnostic[] = [];

	for (const err of errors) {
		// Produce a one‐error code-frame
		const frame = betterAjvErrors(
			schema,
			data,
			[err],
			{ format: 'cli', indent: 2 }
		);
		// Look for the “>  62 |” style marker
		const m = frame.match(/^\s*> *(\d+)\s*\|/m);
		const line = m ? parseInt(m[1], 10) - 1 : 0;

		// We don’t know the exact column from the marker, so highlight the whole line
		const start = new vscode.Position(line, 0);
		const end = new vscode.Position(line, doc.lineAt(line).text.length);
		const range = new vscode.Range(start, end);

		const message = err.message || 'Schema violation';
		const diag = new vscode.Diagnostic(
			range,
			message,
			vscode.DiagnosticSeverity.Error
		);
		diags.push(diag);
	}

	return diags;
}

export function activate(context: vscode.ExtensionContext) {
	diagnostics = vscode.languages.createDiagnosticCollection('json-schema');
	context.subscriptions.push(diagnostics);
	// create once
	outputChannel = vscode.window.createOutputChannel('JSON Validator');
	context.subscriptions.push(outputChannel);

	const runValidation = (doc: vscode.TextDocument) => {
		if (doc.languageId !== 'json') return;

		// make sure it’s saved
		if (doc.isDirty) {
			doc.save().then(() => runValidation(doc));
			return;
		}

		const dataPath = doc.uri.fsPath;
		const projectRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		if (!projectRoot) {
			return vscode.window.showErrorMessage('Open a workspace folder first.');
		}

		const cliPath = path.join(context.extensionUri.fsPath, 'out', 'validate.js');
		const schemaPath = vscode.workspace.getConfiguration('jsonSchemaValidator').get<string>('schemaPath')!;
		const schemaFullPath = path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', schemaPath);

		const schema = JSON.parse(fs.readFileSync(path.resolve(schemaFullPath), "utf8"));
		const raw = doc.getText();
		const root = parseTree(raw);
		if (!root) {
			// invalid JSON syntax—could create a diagnostic here if you like
			return;
		}
		// parse for Ajv
		let data: any;
		try {
			data = JSON.parse(raw);
		} catch {
			// syntax error already handled above
			return;
		}
		const ajv = new Ajv2020({
			allErrors: true,
			strictTypes: false,
		});
		// reuse the same channel
		outputChannel.clear();
		outputChannel.show(true);
		outputChannel.appendLine(`▶ Running validation on ${path.basename(dataPath)}`);
		// clear old diagnostics
		diagnostics.delete(doc.uri);

		const validate = ajv.compile(schema);
		const valid = validate(data);

		if (valid) {
			vscode.window.showInformationMessage('✅ JSON is valid!');
			process.exit(0);
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
				const output = betterAjvErrors(
					schema,
					data,
					validate.errors,
					{ format: 'cli', indent: 2 }
				);
				outputChannel.append(output);
			}
			process.exit(1);
		}
	};

	// 1) Run when user explicitly invokes the command
	const disposable = vscode.commands.registerCommand('extension.validateJson', () => {
		const editor = vscode.window.activeTextEditor;
		if (editor) runValidation(editor.document);
	});
	context.subscriptions.push(disposable);

	// 1) on-save inside the editor
	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument(runValidation)
	);
}

export function deactivate() {
	outputChannel.dispose();
}
