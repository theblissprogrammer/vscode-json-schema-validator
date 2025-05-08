import * as vscode from 'vscode';
import Ajv2020, { ErrorObject } from "ajv/dist/2020";
import betterAjvErrors from '@sidvind/better-ajv-errors';
import { parseTree, findNodeAtLocation } from 'jsonc-parser';
import * as fs from 'fs';

export class JsonQuickFixProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
      vscode.CodeActionKind.QuickFix
    ];
  
    constructor(private schemaPath: string) {}
  
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
  
        // 4) const fix
        if (msg.includes('must be equal to constant')) {
          // we assume err.params.allowedValue is embedded in the message string
          // better: parse the code-frame
          const frame = betterAjvErrors(schema, {}, [], { format:'cli', indent:2 });
          // but Ajv ErrorObject.params.allowedValue is best:
          const err = (diag as any).ajvError as ErrorObject;
          const allowed = err?.params?.allowedValue;
          if (allowed !== undefined) {
            actions.push(this.createConstFix(document, diag, allowed));
          }
        }
  
        // 5) remove additional property
        if (msg.includes('must NOT have additional properties')) {
          // extract the prop name from the pointer
          const pointer = msg.split(' ')[1];
          const segs = pointer.split('/').slice(1);
          const propName = segs[segs.length - 1];
          actions.push(this.createRemovePropertyFix(document, diag, propName));
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
        const title  = `Convert to boolean ${newVal}`;
        
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
      const fix   = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
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
      diag: vscode.Diagnostic,
      propName: string
    ): vscode.CodeAction {
      const title = `Remove property "${propName}"`;
      const fix = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
      fix.diagnostics = [diag];
      const edit = new vscode.WorkspaceEdit();
  
      const raw = doc.getText();
      const root = parseTree(raw)!;
      // locate the offending node
      const pointer = diag.message.split(' ')[1];
      const segs = pointer.split('/').slice(1).map(s => /^\d+$/.test(s) ? +s : s);
      const parentSegs = segs.slice(0, -1);
      const parent = findNodeAtLocation(root, parentSegs)!;
      // find the property node under parent
      for (const child of parent.children || []) {
        const keyNode = child.children![0];
        if (keyNode.value === propName) {
          const start = doc.positionAt(child.offset);
          let endOffset = child.offset + child.length;
          // include trailing comma if present
          if (raw[endOffset] === ',') endOffset++;
          const end = doc.positionAt(endOffset);
          edit.delete(doc.uri, new vscode.Range(start, end));
          break;
        }
      }
  
      fix.edit = edit;
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