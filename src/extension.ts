import * as vscode from 'vscode';
import * as path from 'path';
import fs from "fs";
import { JSONSchema7 } from 'json-schema';
import * as $RefParser from '@apidevtools/json-schema-ref-parser';

import { JsonQuickFixProvider } from './quickfix';
import { runValidation } from './validation';
import { buildFromSchema } from './builder';

let outputChannel: vscode.OutputChannel;
let diagnostics: vscode.DiagnosticCollection;

let statusBar: vscode.StatusBarItem;

// a small debounce map: one timer per URI
const typingTimers = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 500;

export function activate(context: vscode.ExtensionContext) {
	const schemaPath = vscode.workspace.getConfiguration('jsonSchemaValidator').get<string>('schemaPath')!;
	const schemaFullPath = path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', schemaPath);

	diagnostics = vscode.languages.createDiagnosticCollection('json-schema');
	context.subscriptions.push(diagnostics);
	// create once
	outputChannel = vscode.window.createOutputChannel('JSON Validator');
	context.subscriptions.push(outputChannel);

	statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBar.command = 'extension.validateJson';
	context.subscriptions.push(statusBar);

	// 1) Run when user explicitly invokes the command
	context.subscriptions.push(
		vscode.commands.registerCommand('extension.validateJson', () => {
			const doc = vscode.window.activeTextEditor?.document;
			if (doc) runValidation(doc, true, schemaFullPath, diagnostics, statusBar, outputChannel);
		})
	);

	// **On type** (debounced)
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(e => {
			const doc = e.document;
			if (!['json', 'jsonc'].includes(doc.languageId)) return;

			const key = doc.uri.toString();
			clearTimeout(typingTimers.get(key)!);
			const handle = setTimeout(() => {
				runValidation(doc, false, schemaFullPath, diagnostics, statusBar, outputChannel);
				typingTimers.delete(key);
			}, DEBOUNCE_MS);
			typingTimers.set(key, handle);
		})
	);

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			['json', 'jsonc'],
			new JsonQuickFixProvider(schemaFullPath),
			{ providedCodeActionKinds: JsonQuickFixProvider.providedCodeActionKinds }
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('extension.openJsonBuilder', async () => {
			let schema: JSONSchema7;
			try {
				schema = JSON.parse(fs.readFileSync(path.resolve(schemaFullPath), "utf8"));
			} catch (e) {
				return vscode.window.showErrorMessage('Could not load schema.json');
			}

			// this returns a Promise<JSONSchema> with all $ref inlined
			const derefSchema = await $RefParser.dereference(schema);

			// derefSchema now has no $ref: all definitions are merged
			const result = await buildFromSchema(derefSchema as JSONSchema7, '', outputChannel);

			// 3) insert the JSON into the active editor
			const editor = vscode.window.activeTextEditor;
			if (!editor) return;
			const json = JSON.stringify(result, null, 2);
			editor.insertSnippet(new vscode.SnippetString(json), editor.selection.active);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('extension.openWebViewJsonBuilder', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return vscode.window.showErrorMessage('Open a JSON file first.');
			}

			// 1) load & deref your schema exactly as before...
			const rawSchema = JSON.parse(fs.readFileSync(path.resolve(schemaFullPath), "utf8")) as JSONSchema7;
			const rootSchema = (rawSchema.$ref && rawSchema.$defs)
				? (rawSchema.$defs![rawSchema.$ref.split('/').pop()!] as JSONSchema7)
				: rawSchema;

			// 2) Create the WebviewPanel
			const panel = vscode.window.createWebviewPanel(
				'jsonBuilder',
				'JSON Builder',
				vscode.ViewColumn.One,
				{
					enableScripts: true,
					localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
				}
			);

			// 3) Read & patch the HTML
			const htmlPath = path.join(context.extensionPath, 'media', 'editor.html');
			let html = fs.readFileSync(htmlPath, 'utf8');

			// 1) Compute the on-disk URIs correctly:
			const cssOnDisk = vscode.Uri.file(
				path.join(context.extensionPath, 'media', 'jsoneditor.min.css')
			);
			const jsOnDisk = vscode.Uri.file(
				path.join(context.extensionPath, 'media', 'jsoneditor.min.js')
			);

			// 2) Turn those into webview URIs
			const cssUri = panel.webview.asWebviewUri(cssOnDisk);
			const jsUri = panel.webview.asWebviewUri(jsOnDisk);

			// patch in CSP
			const csp = `
  default-src 'none';
  style-src ${panel.webview.cspSource} 'unsafe-inline';
  script-src ${panel.webview.cspSource};
  font-src ${panel.webview.cspSource};
`.replace(/\s+/g, ' ');
			html = html.replace(
				`<meta http-equiv="Content-Security-Policy" content="">`,
				`<meta http-equiv="Content-Security-Policy" content="${csp}">`
			);

			// inject our URIs
			html = html.replace(
				`<!-- INJECT:CSS -->`,
				`<link rel="stylesheet" href="${cssUri}" />`
			);
			html = html.replace(
				`<!-- INJECT:JS -->`,
				`<script src="${jsUri}"></script>`
			);

			panel.webview.html = html;

			// 4) When the webview is ready, send the schema + initial JSON
			panel.webview.onDidReceiveMessage( // not used here, but you could listen for ready signals
				_ => { },
				undefined,
				context.subscriptions
			);
			const derefSchema = await $RefParser.dereference(rawSchema) as JSONSchema7;

			// Give the webview a moment to load, then post
			const data = {
				schema: derefSchema,
				initial: (() => {
					try { return JSON.parse(editor.document.getText()); }
					catch { return {}; }
				})()
			};
			setTimeout(() => {
				panel.webview.postMessage(data);
			}, 100);

			// 5) Handle the “insert” message
			panel.webview.onDidReceiveMessage(msg => {
				if (msg.command === 'insert') {
					const snippet = JSON.stringify(msg.data, null, 2);
					editor.insertSnippet(new vscode.SnippetString(snippet), editor.selection.active);
					panel.dispose();
				}
			}, null, context.subscriptions);
		})
	);
}

export function deactivate() {
	outputChannel.dispose();
	diagnostics.clear();
	statusBar.dispose();
}
