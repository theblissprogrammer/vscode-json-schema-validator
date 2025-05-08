# JSON Schema Validator VS Code Extension

A Visual Studio Code extension that validates JSON files against a JSON Schema using **Ajv**, displaying inline diagnostics and an output log.

## Features

* **On-Save Validation**: Automatically runs validation each time you save a JSON file.
* **Command Palette**: Manually trigger validation via the **"Validate JSON Against Schema"** command.
* **Inline Diagnostics**: Schema violations show up as red squiggles and entries in the Problems panel.
* **Output Channel**: Detailed validation logs appear in a dedicated **JSON Validator** output channel.

## Prerequisites

* [Node.js](https://nodejs.org/) (>=12.x)
* The extension bundles its own CLI (`validate.js`); no separate global install required.

## Installation

1. Clone or download this repository into your VS Code extensions folder:

   ```bash
   git clone https://github.com/yourusername/json-schema-validator.git
   ```
2. Navigate into the extension directory and install dependencies:

   ```bash
   cd json-schema-validator
   npm install
   ```
3. Build the extension:

   ```bash
   npm run build
   ```
4. Launch the extension in Development Host:

   * Open the project in VS Code.
   * Press `F5` (or your configured debug shortcut).

> **Tip**: If `F5` triggers macOS dictation, enable **Use F1, F2, etc. keys as standard function keys** in System Settings → Keyboard.

## Configuration

Set the JSON Schema file path in your workspace settings:

```jsonc
// .vscode/settings.json
{
  "jsonSchemaValidator.schemaPath": "${workspaceFolder}/schemas/schema.json"
}
```

* **schemaPath**: Path to your JSON Schema file. Can be absolute or relative to the workspace root.

## Usage

### Automatic Validation on Save

* Simply open any `.json` file in your workspace and save (`⌘S`).
* If the file violates the schema, you’ll see red squiggles and error messages in the Problems pane.

### Manual Validation

1. Open the Command Palette (`⌘⇧P`).
2. Type and select **"Validate JSON Against Schema"**.

## Extension Commands

| Command                      | Description                                |
| ---------------------------- | ------------------------------------------ |
| Validate JSON Against Schema | Validate the active JSON file immediately. |

## Extension Settings

| Setting                          | Type   | Default                                  | Description                          |
| -------------------------------- | ------ | ---------------------------------------- | ------------------------------------ |
| `jsonSchemaValidator.schemaPath` | string | `${workspaceFolder}/schemas/schema.json` | Path to the JSON Schema file to use. |

## Troubleshooting

* **"Cannot find module 'minimist'"**: Run `npm install` in the extension folder.
* **"No inputs were found in config file"**: Ensure your `tsconfig.json` includes `"src/**/*.ts"` and that your CLI code is under `src/`.
* **macOS Function Keys**: Enable function-key mode or remap **Debug: Start Debugging** in Keyboard Shortcuts.

## License

This project is licensed under the [MIT License](LICENSE).
