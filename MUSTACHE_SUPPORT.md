# Mustache Template Validation Support

This extension now supports validating JSON files that contain Mustache template syntax!

## File Extension Requirement

**Important**: Mustache template validation only works with files ending in `.json.mustache`

- ✅ `config.json.mustache` - Will be processed
- ✅ `template.json.mustache` - Will be processed  
- ❌ `config.json` - Will NOT be processed (even if it contains `{{...}}`)
- ❌ `template.mustache` - Will NOT be processed (must end with `.json.mustache`)

## Overview

The validator automatically processes `.json.mustache` files before validation:

1. **Detection**: Checks if file ends with `.json.mustache`
2. **Cleaning**: Replaces Mustache placeholders with appropriate sample values
3. **Validation**: Runs schema validation on the cleaned JSON
4. **Error Mapping**: Maps validation errors back to the original file locations

## Supported Mustache Syntax

The validator handles the following Mustache constructs:

- **Variables**: `{{variableName}}`
- **Conditionals**: `{{#if condition}}...{{/if}}`
- **Loops**: `{{#each items}}...{{/each}}`
- **Negation**: `{{^condition}}...{{/condition}}`
- **Comments**: `{{! This is a comment }}`
- **Partials**: `{{> partialName}}`

## Smart Type Inference

The mustache processor intelligently infers appropriate replacement values based on:

### Variable Names
- Boolean-like: `{{isEnabled}}`, `{{hasAccess}}`, `{{visible}}` → `true`
- Number-like: `{{count}}`, `{{id}}`, `{{index}}`, `{{age}}` → `0`
- Array-like: `{{items}}`, `{{list}}` → `[]`
- Object-like: `{{config}}`, `{{settings}}`, `{{data}}` → `{}`
- String-like: `{{name}}`, `{{title}}`, `{{text}}` → `"sampleString"`

### Context Analysis
The processor also considers the surrounding context:

```json
{
  "name": "{{userName}}",        // → "sampleString" (after quote)
  "count": {{itemCount}},        // → 0 (number context)
  "enabled": {{isEnabled}},      // → true (boolean-like name)
  "items": [{{item}}],           // → "sampleString" (array context)
  "config": {{configObject}}     // → {} (object-like name)
}
```

## Example: Before and After Processing

### Original File (with Mustache)
```json
{
  "componentName": "{{name}}",
  "version": "{{version}}",
  "enabled": {{isEnabled}},
  "maxItems": {{maxCount}},
  "items": [
    "{{item1}}",
    "{{item2}}"
  ],
  "{{#if showAdvanced}}": {
    "advanced": true
  }
}
```

### Processed for Validation
```json
{
  "componentName": "sampleString",
  "version": "sampleString",
  "enabled": true,
  "maxItems": 0,
  "items": [
    "sampleString",
    "sampleString"
  ],
  "": {
    "advanced": true
  }
}
```

## Position Mapping

The validator maintains accurate position mappings between the original and cleaned versions:

- **Error locations** point to the exact mustache expression or text in the original file
- **Quick fixes** work correctly with mustache templates
- **Diagnostics** are displayed at the correct positions in your editor

## Debug Output

When validating a `.json.mustache` file, the output channel shows:

```
🎭 [DEBUG] Mustache file detected (.json.mustache) - preprocessing...
🎭 [DEBUG] Mustache preprocessing complete:
   - Found 7 mustache expressions
   - Original length: 342
   - Cleaned length: 298
   - Cleaned sample: {...}
```

If the file doesn't end with `.json.mustache`, mustache expressions will be treated as invalid JSON syntax.

## How It Works

### 1. Detection Phase
```typescript
const isMustacheFile = doc.uri.fsPath.endsWith('.json.mustache');
if (isMustacheFile && hasMustacheSyntax(raw)) {
    // Process mustache template
}
```

### 2. Processing Phase
The `processMustacheTemplate()` function:
- Scans for all `{{...}}` expressions using regex
- Generates appropriate replacement values
- Maintains position mappings for each segment

### 3. Validation Phase
- Validates the cleaned JSON against the schema
- Uses AJV validation on the processed content

### 4. Error Mapping Phase
- Converts error positions from cleaned → original
- Maps offsets back through the position mappings
- Displays errors at correct locations in your file

## Technical Details

### Position Mapping Structure
```typescript
interface PositionMapping {
    originalStart: number;    // Start position in original file
    originalEnd: number;      // End position in original file
    cleanedStart: number;     // Start position in cleaned file
    cleanedEnd: number;       // End position in cleaned file
    type: 'mustache' | 'text'; // Type of segment
    replacement?: string;     // Replacement value (for mustache)
}
```

### Mapping Algorithm
When an error occurs at position X in the cleaned file:
1. Find the mapping segment containing position X
2. If it's a `text` segment: map directly (offset preserved)
3. If it's a `mustache` segment: map to the start of the original mustache expression
4. Convert offset → Position in the original document

## How It Works

### Simple Quote Detection
The processor uses a simple rule:
- **Inside quotes** (odd number of `"` after last `:` or `[`): Replace with unquoted `sampleValue`
- **Outside quotes** (even number of `"`): Replace with quoted `"sampleValue"`

### Examples:
```json
"name": "{{userName}}"        → "name": "sampleValue"       ✅
"count": {{itemCount}}        → "count": "sampleValue"      ✅  
"enabled": {{isEnabled}}      → "enabled": "sampleValue"    ✅
"items": ["{{item}}"]         → "items": ["sampleValue"]    ✅
```

### Block Helpers
- `{{#each items}}...{{/each}}` → Block tags removed, content kept
- `{{#if condition}}...{{/if}}` → Block tags removed, content kept
- `{{^unless}}...{{/unless}}` → Block tags removed, content kept

This means loop/conditional content is validated once (not per iteration).

## Limitations

### 1. File Extension Required
Only files ending with `.json.mustache` are processed.

### 2. Complex Nested Conditionals
Nested conditions with multiple branches may produce invalid JSON:

```json
// ❌ This pattern doesn't work well:
"label": 
  {{#isComingSoon}}
    {{#isPreOrder}}
      "preorder coming soon"
    {{/isPreOrder}}
    {{^isPreOrder}}
      "coming soon"
    {{/isPreOrder}}
  {{/isComingSoon}}
```

After processing, ALL branches remain, creating invalid JSON. **Workaround**: Simplify to single-level conditions.

### 3. No Type Inference
The processor doesn't infer types - all values become `"sampleValue"` (string) or `sampleValue` (unquoted). Numbers, booleans, objects, and arrays are all replaced with strings.

### 4. Block Content Not Repeated
Loops like `{{#items}}...{{/items}}` keep only ONE instance of their content, not multiple iterations.

## Configuration

No additional configuration is needed! The mustache support is automatic:

- ✅ Automatically processes `.json.mustache` files
- ✅ Works with existing schema validation
- ✅ Compatible with all validation features
- ✅ No performance impact on regular `.json` files

### How to Use

1. Create or rename your mustache template file with `.json.mustache` extension
2. The validator will automatically detect and process it
3. Edit the file as usual - validation happens automatically on save and while typing

## Examples

### Example 1: API Configuration
```json
{
  "apiUrl": "{{API_URL}}",
  "apiKey": "{{API_KEY}}",
  "timeout": {{TIMEOUT}},
  "retries": {{MAX_RETRIES}},
  "enabled": {{FEATURE_ENABLED}}
}
```

### Example 2: Conditional Features
```json
{
  "features": {
    "{{#if enableBeta}}": {
      "beta": true
    },
    "{{#if enableAnalytics}}": {
      "analytics": {
        "trackingId": "{{TRACKING_ID}}"
      }
    }
  }
}
```

### Example 3: Dynamic Arrays
```json
{
  "users": [
    {{#each users}}
    {
      "name": "{{name}}",
      "email": "{{email}}"
    }
    {{/each}}
  ]
}
```

## Troubleshooting

### Issue: Validation fails after mustache processing
**Solution**: Check the output channel to see the cleaned JSON. The mustache replacement might have created invalid JSON structure.

### Issue: Errors point to wrong locations
**Solution**: This is rare, but can happen with very complex mustache structures. The position mapping tries to point to the start of the mustache expression.

### Issue: Type inference is incorrect
**Solution**: The inference is based on variable names and context. Consider adjusting your mustache variable names to match common patterns (e.g., `isEnabled` for booleans, `itemCount` for numbers).

## Future Enhancements

Potential improvements for future versions:

- [ ] Custom type hints in comments: `{{variableName}} // @type number`
- [ ] User-configurable type inference rules
- [ ] Support for custom mustache helpers
- [ ] Better handling of complex nested structures
- [ ] Mustache expression validation (check if variables exist)

## Implementation Files

The mustache support is implemented in:

- **`src/mustacheProcessor.ts`**: Core mustache processing logic
- **`src/validation.ts`**: Integration with validation pipeline

## Contributing

If you find issues with mustache validation or have suggestions:

1. Check the output channel for debug information
2. Note the specific mustache pattern causing issues
3. Report the issue with a minimal example

---

**Note**: This feature is designed to be transparent and automatic. If your JSON doesn't contain mustache syntax, validation works exactly as before with zero overhead.

