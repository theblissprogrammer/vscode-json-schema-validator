# JSON Schema Validator VS Code Extension

A Visual Studio Code extension that validates JSON files against a JSON Schema using **Ajv**, displaying inline diagnostics and an output log.

## Features

* **🎨 Settings UI**: User-friendly configuration panel with visual controls
* **🌐 API Endpoint Support**: Load schemas from remote URLs with automatic caching
* **⚡ Real-time Validation**: Automatically validates as you type (debounced) and on save
* **🔍 Inline Diagnostics**: Schema violations show up as red squiggles and entries in the Problems panel
* **🛠️ Smart Quick Fixes**: Automated code actions to fix common schema violations
* **📋 Output Channel**: Detailed validation logs appear in a dedicated **JSON Validator** output channel
* **🏗️ JSON Builder**: Interactive tool to create valid JSON from your schema
* **🎭 Mustache Template Support**: Validate JSON files with Mustache templates (`.json.mustache` files)

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

### Using the Settings UI (Recommended)

1. Open the Command Palette (`⌘⇧P` or `Ctrl+Shift+P`)
2. Type and select **"JSON Schema Validator: Configure Settings"**
3. Choose between:
   - **Local File**: Load schema from a file in your workspace
   - **Remote URL**: Fetch schema from an API endpoint
4. Configure cache duration for remote schemas
5. Choose to save settings globally or per-workspace

### Manual Configuration

Alternatively, you can edit your workspace or user settings directly:

```jsonc
// .vscode/settings.json
{
  // Option 1: Use a local file path
  "jsonSchemaValidator.schemaPath": "${workspaceFolder}/schemas/schema.json",
  
  // Option 2: Use an API endpoint (takes precedence over schemaPath)
  "jsonSchemaValidator.schemaUrl": "https://api.example.com/schema.json",
  
  // Cache duration for URL-based schemas (in seconds, default: 300)
  "jsonSchemaValidator.schemaCacheDuration": 300
}
```

* **schemaPath**: Path to your JSON Schema file. Can be absolute, relative to the workspace root, or a URL (http/https).
* **schemaUrl**: URL to fetch the JSON Schema from. If set, this takes precedence over `schemaPath`.
* **schemaCacheDuration**: Duration in seconds to cache schemas fetched from URLs (default: 300 seconds / 5 minutes).

## Usage

### Automatic Validation on Save

* Simply open any `.json` file in your workspace and save (`⌘S`).
* If the file violates the schema, you’ll see red squiggles and error messages in the Problems pane.

### Manual Validation

1. Open the Command Palette (`⌘⇧P`).
2. Type and select **"Validate JSON Against Schema"**.

### Mustache Template Validation

The extension supports validating JSON files that contain Mustache template syntax:

1. Name your file with the `.json.mustache` extension (e.g., `config.json.mustache`)
2. The validator will automatically:
   - Detect mustache expressions like `{{variableName}}`
   - Replace them with appropriate sample values
   - Validate the resulting JSON against your schema
   - Map any errors back to the correct locations in your template

**Example `config.json.mustache`**:
```json
{
  "apiUrl": "{{API_URL}}",
  "enabled": {{FEATURE_ENABLED}},
  "maxRetries": {{MAX_RETRIES}}
}
```

📚 For more details, see [MUSTACHE_SUPPORT.md](MUSTACHE_SUPPORT.md)

## Extension Commands

| Command                                | Description                                        |
| -------------------------------------- | -------------------------------------------------- |
| Validate JSON Against Schema           | Validate the active JSON file immediately.         |
| JSON Schema Validator: Configure Settings | Open the settings UI to configure schema paths. |
| Refresh JSON Schema Cache              | Clear the schema cache and fetch fresh from URL.   |

## Extension Settings

| Setting                                | Type   | Default                                  | Description                                                        |
| -------------------------------------- | ------ | ---------------------------------------- | ------------------------------------------------------------------ |
| `jsonSchemaValidator.schemaPath`       | string | `${workspaceFolder}/schemas/schema.json` | Path to the JSON Schema file (file path or HTTP/HTTPS URL).        |
| `jsonSchemaValidator.schemaUrl`        | string | `""`                                     | URL to fetch the JSON Schema from (takes precedence over path).    |
| `jsonSchemaValidator.schemaCacheDuration` | number | `300`                                 | Duration in seconds to cache URL-based schemas.                    |

## Troubleshooting

* **"Cannot find module 'minimist'"**: Run `npm install` in the extension folder.
* **"No inputs were found in config file"**: Ensure your `tsconfig.json` includes `"src/**/*.ts"` and that your CLI code is under `src/`.
* **macOS Function Keys**: Enable function-key mode or remap **Debug: Start Debugging** in Keyboard Shortcuts.

## License

This project is licensed under the [MIT License](LICENSE).
