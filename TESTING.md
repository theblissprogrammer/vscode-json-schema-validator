# Testing Guide for JSON Schema Validator Extension

## 📦 Installation

The extension has been packaged as: `json-schema2020-validator-0.0.2.vsix`

### Method 1: Install via VS Code UI (Recommended)

1. Open VS Code
2. Open the Command Palette (`⌘⇧P` or `Ctrl+Shift+P`)
3. Type and select: **"Extensions: Install from VSIX..."**
4. Navigate to and select: `json-schema2020-validator-0.0.2.vsix`
5. Click **"Install"**
6. Reload VS Code when prompted

### Method 2: Install via Command Line

```bash
code --install-extension json-schema2020-validator-0.0.2.vsix
```

## 🧪 Testing the Features

### 1. Test Settings UI ⚙️

1. Open Command Palette (`⌘⇧P`)
2. Type: **"JSON Schema Validator: Configure Settings"**
3. You should see a beautiful settings modal
4. Try toggling between "Local File" and "Remote URL"
5. Test saving settings with both scopes (Workspace/Global)

### 2. Test Local File Schema 📁

**Setup:**
```bash
# Create a test directory
mkdir -p test-workspace/schemas
cd test-workspace

# Create a simple schema
cat > schemas/schema.json << 'EOF'
{
  "$schema": "http://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "name": { "type": "string" },
    "age": { "type": "number" },
    "active": { "type": "boolean" }
  },
  "required": ["name", "age"]
}
EOF

# Create a test JSON file
cat > test.json << 'EOF'
{
  "name": "John",
  "age": "30"
}
EOF
```

**Test:**
1. Open `test-workspace` in VS Code
2. Open Settings UI and configure:
   - Source: **Local File**
   - Path: `/schemas/schema.json`
3. Open `test.json`
4. You should see validation errors (age should be number, not string)
5. Try the quick fix to convert age to number

### 3. Test Remote URL Schema 🌐

**Setup (Using a public test schema):**

**Test:**
1. Open Settings UI
2. Configure:
   - Source: **Remote URL**
   - URL: `https://json.schemastore.org/package.json`
   - Cache Duration: `300`
3. Create a `package.json` file with invalid content:
```json
{
  "name": 123,
  "version": true
}
```
4. Save the file
5. You should see validation errors
6. Check the **JSON Validator** output channel for cache logs

### 4. Test Schema Cache 🔄

1. Configure a remote URL schema
2. Open a JSON file and validate it
3. Check the output channel - should show: `🌐 Fetching schema from URL`
4. Validate again immediately
5. Check the output channel - should show: `📦 Using cached schema`
6. Run command: **"Refresh JSON Schema Cache"**
7. Validate again - should fetch fresh from URL

### 5. Test Quick Fixes 🛠️

Create a JSON file with various errors:
```json
{
  "name": 123,           // Should be string
  "age": "30",           // Should be number
  "active": "yes",       // Should be boolean
  "extraField": "test"   // Not in schema
}
```

**Test:**
- Click on each error
- You should see lightbulb 💡 icon
- Test quick fixes:
  - Convert to string
  - Convert to number
  - Convert to boolean
  - Remove additional property

### 6. Test Real-time Validation ⚡

1. Open a JSON file
2. Start typing/editing
3. Validation should trigger after 500ms of inactivity
4. Errors should appear as you type

### 7. Test JSON Builder 🏗️

1. Open Command Palette
2. Run: **"Create JSON from Schema"**
3. Follow the prompts to build a valid JSON object
4. The JSON should be inserted at your cursor position

## 🐛 Common Issues

### Extension Not Loading
- Check VS Code developer console: `Help > Toggle Developer Tools`
- Look for errors in the console

### Schema Not Found
- Verify the schema path is correct
- Check the **JSON Validator** output channel for details

### Network Errors (Remote Schema)
- Ensure you have internet connectivity
- Check if the URL is accessible
- Try refreshing the cache

### Permission Issues
- Make sure the schema file is readable
- Check workspace folder permissions

## 📋 Checklist

- [ ] Settings UI opens and displays correctly
- [ ] Can configure local file schema
- [ ] Can configure remote URL schema
- [ ] Local file validation works
- [ ] Remote URL validation works
- [ ] Schema caching works (check output logs)
- [ ] Cache refresh command works
- [ ] Quick fixes appear and work
- [ ] Real-time validation triggers on typing
- [ ] Status bar shows validation state
- [ ] Problems panel shows errors
- [ ] Output channel shows detailed logs

## 🎉 Success Criteria

If all the above features work, your extension is ready! 🚀

## 📊 Output Channel Examples

### Successful Local File Load:
```
▶ Running validation on test.json
📁 Loading schema from file: /path/to/schemas/schema.json
✅ JSON is valid!
```

### Successful Remote URL Load:
```
▶ Running validation on test.json
🌐 Fetching schema from URL: https://example.com/schema.json
✅ Successfully fetched and cached schema from URL
✅ JSON is valid!
```

### Using Cached Schema:
```
▶ Running validation on test.json
📦 Using cached schema from URL (age: 45s)
❌ Validation errors:
```

## 🔧 Troubleshooting Commands

```bash
# Rebuild the extension
npm run compile

# Repackage
npx vsce package

# View extension logs
# In VS Code: View > Output > Select "JSON Validator"
```

