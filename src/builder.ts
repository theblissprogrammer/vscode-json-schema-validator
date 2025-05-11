import * as vscode from 'vscode';
import { JSONSchema7 } from 'json-schema'; 

// Recursively prompt the user for a value conforming to `schema`.
// `path` is just for nicer prompts (“Enter props.user.name:”)
export async function buildFromSchema(
    schema: JSONSchema7, 
    path: string, 
    outputChannel: vscode.OutputChannel
): Promise<any> {
    // handle objects
    outputChannel.appendLine(`buildFromSchema ${schema} ${schema.properties}`);
    if (schema.type === 'object' && schema.properties) {
      const obj: any = {};
      const props = Object.keys(schema.properties);
      // required first
      const required = new Set(schema.required || []);
      for (const key of props) {
        const propSchema = schema.properties![key] as JSONSchema7;
        // optionally skip non-required
        if (!required.has(key)) {
          const add = await vscode.window.showQuickPick(['yes','no'], {
            placeHolder: `Add optional property "${key}"?`
          });
          if (add !== 'yes') {
            continue;
          }
        }
        obj[key] = await buildFromSchema(propSchema, path ? `${path}.${key}` : key, outputChannel);
      }
      return obj;
    }
  
    // handle arrays
    if (schema.type === 'array' && schema.items && !Array.isArray(schema.items)) {
      const arr: any[] = [];
      while (true) {
        const add = await vscode.window.showQuickPick(['yes','no'], {
          placeHolder: `Add another item to ${path}[]?`
        });
        if (add !== 'yes') break;
        arr.push(await buildFromSchema(schema.items as JSONSchema7, path + '[]', outputChannel));
      }
      return arr;
    }
  
    // handle enums
    if (schema.enum) {
      const pick = await vscode.window.showQuickPick(
        schema.enum.map(v => String(v)),
        { placeHolder: `Pick a value for ${path}` }
      );
      // try to return typed
      const raw = pick!;
      if (schema.type === 'number' || schema.type === 'integer') return Number(raw);
      if (schema.type === 'boolean') return raw === 'true';
      return raw;
    }
  
    // primitives
    switch (schema.type) {
      case 'string': {
        const val = await vscode.window.showInputBox({
          placeHolder: `Enter string for ${path}`,
        });
        return val ?? '';
      }
      case 'integer':
      case 'number': {
        const val = await vscode.window.showInputBox({
          placeHolder: `Enter number for ${path}`,
          validateInput: s => isNaN(+s) ? 'Not a number' : null
        });
        return val ? +val : 0;
      }
      case 'boolean': {
        const pick = await vscode.window.showQuickPick(['true','false'], {
          placeHolder: `Pick boolean for ${path}`
        });
        return pick === 'true';
      }
      default:
        // fallback to raw input
        return await vscode.window.showInputBox({
          placeHolder: `Enter value for ${path}`
        });
    }
  }