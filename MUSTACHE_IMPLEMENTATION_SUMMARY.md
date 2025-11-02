# Mustache Template Validation - Implementation Summary

## Overview
This document summarizes the implementation of Mustache template validation support for the JSON Schema Validator extension.

## Key Requirement
**Only files ending in `.json.mustache` will have mustache processing applied.**

## Files Modified

### 1. `src/mustacheProcessor.ts` (NEW)
Core mustache processing logic with the following components:

#### Key Functions:
- **`hasMustacheSyntax(text: string): boolean`**
  - Detects if text contains `{{...}}` patterns
  - Used to confirm mustache expressions exist before processing

- **`processMustacheTemplate(text: string): MustacheProcessResult`**
  - Scans for all mustache expressions using regex: `/\{\{([#^/!>]?)([^}]*)\}\}/g`
  - Replaces expressions with appropriate sample values based on smart type inference
  - Maintains position mappings for error tracking

- **`mapCleanedOffsetToOriginalPosition()`**
  - Converts positions in cleaned JSON back to original file positions
  - Essential for displaying errors at correct locations

#### Smart Type Inference:
The processor infers appropriate replacement values based on:
- **Variable names**: `isEnabled` → `true`, `count` → `0`, `items` → `[]`
- **Context**: Position after quotes, colons, or brackets
- **Defaults**: Falls back to `"sampleString"` for unknown types

#### Position Mapping:
```typescript
interface PositionMapping {
    originalStart: number;
    originalEnd: number;
    cleanedStart: number;
    cleanedEnd: number;
    type: 'mustache' | 'text';
    replacement?: string;
}
```

### 2. `src/validation.ts` (MODIFIED)
Integrated mustache processing into the validation pipeline:

#### Changes:
1. **Import mustache utilities** (lines 9-14):
   ```typescript
   import { 
       hasMustacheSyntax, 
       processMustacheTemplate, 
       mapCleanedOffsetToOriginalPosition,
       MustacheProcessResult 
   } from './mustacheProcessor';
   ```

2. **Check file extension** (lines 68-72):
   ```typescript
   const isMustacheFile = doc.uri.fsPath.endsWith('.json.mustache');
   if (!['json', 'jsonc'].includes(doc.languageId) && !isMustacheFile) {
       return;
   }
   ```

3. **Process mustache templates** (lines 107-132):
   - Only processes if `isMustacheFile` is true
   - Logs detailed debug information
   - Creates cleaned version for validation

4. **Updated function signature** (lines 226-228):
   - Added `validatedText?: string` parameter
   - Added `mustacheResult?: MustacheProcessResult` parameter

5. **Map error positions** (lines 316-327):
   - Uses `mapCleanedOffsetToOriginalPosition()` to convert positions
   - Ensures errors point to correct locations in original file

### 3. `src/extension.ts` (MODIFIED)
Updated to recognize `.json.mustache` files:

#### Changes:
1. **Document change handler** (lines 55-58):
   ```typescript
   const isMustacheFile = doc.uri.fsPath.endsWith('.json.mustache');
   if (!['json', 'jsonc'].includes(doc.languageId) && !isMustacheFile) {
       return;
   }
   ```

2. **Fixed linter warning** (lines 121-123):
   - Added braces to `if (!editor)` statement

## How It Works

### Flow Diagram:
```
1. File opened/edited
   ↓
2. Check: Does filename end with .json.mustache?
   ↓ YES                        ↓ NO
3. Detect mustache syntax     → Skip mustache processing
   ↓ FOUND                      
4. Process template:
   - Extract {{...}} expressions
   - Generate sample values
   - Create position mappings
   - Replace expressions
   ↓
5. Validate cleaned JSON
   ↓
6. Map error positions back to original
   ↓
7. Display diagnostics at correct locations
```

### Example Transformation:

**Original (`config.json.mustache`):**
```json
{
  "name": "{{componentName}}",
  "count": {{itemCount}},
  "enabled": {{isEnabled}}
}
```

**Processed (for validation):**
```json
{
  "name": "sampleString",
  "count": 0,
  "enabled": true
}
```

**Position Mapping:**
```
Mapping[0]: Text     "{\n  \"name\": \"" → "{\n  \"name\": \""
Mapping[1]: Mustache "{{componentName}}" → "sampleString"  
Mapping[2]: Text     "\",\n  \"count\": " → "\",\n  \"count\": "
Mapping[3]: Mustache "{{itemCount}}" → "0"
...
```

## Test File

Created `test-mustache.json.mustache` with various mustache patterns:
- Variable replacements
- Boolean values
- Number values
- Arrays
- Objects
- Conditional blocks

## Documentation

### 1. `MUSTACHE_SUPPORT.md`
Comprehensive documentation covering:
- File extension requirement
- Supported mustache syntax
- Smart type inference rules
- Position mapping details
- Examples and use cases
- Troubleshooting guide

### 2. `README.md`
Updated with:
- Feature listing
- Quick usage guide
- Example snippet
- Link to detailed documentation

## Key Benefits

1. ✅ **Transparent**: Works automatically for `.json.mustache` files
2. ✅ **Accurate**: Error positions map correctly to original file
3. ✅ **Smart**: Intelligent type inference for replacements
4. ✅ **Zero Overhead**: No impact on regular `.json` files
5. ✅ **Flexible**: Handles various mustache patterns

## Limitations

1. Only files ending with `.json.mustache` are processed
2. Type inference is heuristic-based (may not always match intent)
3. Complex nested mustache structures may have edge cases
4. Custom mustache helpers are removed (not executed)

## Testing Recommendations

1. Test with simple mustache variables
2. Test with boolean/number inference
3. Test with nested structures
4. Test error position accuracy
5. Test with mixed text/mustache content
6. Verify `.json` files are unaffected

## Future Enhancements

Potential improvements:
- Custom type hints via comments: `{{var}} // @type number`
- User-configurable inference rules
- Support for custom mustache helpers
- Mustache expression validation
- Multi-line mustache expressions

## Compilation

All TypeScript compiles successfully with zero errors:
```bash
npm run compile
✓ Success
```

