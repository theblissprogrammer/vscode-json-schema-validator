import * as vscode from 'vscode';

/**
 * Represents a mapping between original and cleaned text positions
 */
interface PositionMapping {
    originalStart: number;
    originalEnd: number;
    cleanedStart: number;
    cleanedEnd: number;
    type: 'mustache' | 'text';
    replacement?: string;
}

/**
 * Result of mustache processing
 */
export interface MustacheProcessResult {
    cleanedText: string;
    hasMustache: boolean;
    mappings: PositionMapping[];
}

/**
 * Detects if a string contains mustache syntax
 */
export function hasMustacheSyntax(text: string): boolean {
    // Match {{...}}, {{#...}}, {{/...}}, {{^...}}, etc.
    const mustachePattern = /\{\{[#^/!>]?[^}]*\}\}/;
    return mustachePattern.test(text);
}

/**
 * Generates a sample value based on context
 * Simple rule: If inside quotes, return unquoted. If outside quotes, return quoted.
 */
function generateSampleValue(mustacheExpr: string, context: string): string {
    const expr = mustacheExpr.trim();
    
    // Block helpers (conditionals, loops, etc.) - always remove
    if (expr.startsWith('#') || expr.startsWith('^')) {
        return ''; // Block start - remove completely
    }
    if (expr.startsWith('/')) {
        return ''; // Block end - remove completely
    }
    if (expr.startsWith('!')) {
        return ''; // Comment - remove completely
    }
    if (expr.startsWith('>')) {
        return ''; // Partial - remove completely
    }
    
    // For actual values, check if we're inside quotes
    const beforeContext = context.slice(Math.max(0, context.length - 200));
    
    // Strategy: Count quotes after the last colon OR after the last [ (for arrays)
    // Find the rightmost occurrence of either : or [
    const lastColonIndex = beforeContext.lastIndexOf(':');
    const lastBracketIndex = beforeContext.lastIndexOf('[');
    const delimiterIndex = Math.max(lastColonIndex, lastBracketIndex);
    
    if (delimiterIndex >= 0) {
        // Count quotes AFTER the delimiter to determine if we're in a string value
        const afterDelimiter = beforeContext.slice(delimiterIndex + 1);
        const quotesAfter = (afterDelimiter.match(/"/g) || []).length;
        const insideQuotes = quotesAfter % 2 === 1;
        
        if (insideQuotes) {
            // Inside quotes: return unquoted sample value
            return 'sampleValue';
        } else {
            // Outside quotes: return quoted sample value
            return '"sampleValue"';
        }
    }
    
    // Fallback: if no delimiter found, return quoted value
    return '"sampleValue"';
}

/**
 * Processes mustache template by replacing expressions with sample values
 * and maintaining position mappings
 */
export function processMustacheTemplate(text: string): MustacheProcessResult {
    const mappings: PositionMapping[] = [];
    let cleanedText = '';
    let lastIndex = 0;
    let cleanedOffset = 0;
    
    // Regex to match mustache expressions: {{...}} or {{{...}}}
    // Triple braces {{{...}}} are for unescaped HTML output in Mustache
    const mustacheRegex = /\{\{\{([^}]+)\}\}\}|\{\{([#^/!>]?)([^}]*)\}\}/g;
    
    let match: RegExpExecArray | null;
    let foundMustache = false;
    
    while ((match = mustacheRegex.exec(text)) !== null) {
        foundMustache = true;
        const fullMatch = match[0];
        
        // Check if this is triple-brace or double-brace
        let prefix = '';
        let expression = '';
        
        if (match[1] !== undefined) {
            // Triple-brace: {{{...}}}
            expression = match[1];
            prefix = '';
        } else {
            // Double-brace: {{...}}
            prefix = match[2] || ''; // #, ^, /, !, or >
            expression = match[3] || '';
        }
        
        const matchStart = match.index;
        const matchEnd = match.index + fullMatch.length;
        
        // Add text before this mustache expression
        if (matchStart > lastIndex) {
            const textBefore = text.slice(lastIndex, matchStart);
            cleanedText += textBefore;
            
            mappings.push({
                originalStart: lastIndex,
                originalEnd: matchStart,
                cleanedStart: cleanedOffset,
                cleanedEnd: cleanedOffset + textBefore.length,
                type: 'text'
            });
            
            cleanedOffset += textBefore.length;
        }
        
        // Generate replacement for this mustache expression
        // Use 200 chars of context to ensure we capture delimiters like : and [
        const contextBefore = text.slice(Math.max(0, matchStart - 200), matchStart);
        const replacement = generateSampleValue(prefix + expression, contextBefore);
        
        // Add the replacement to cleaned text
        cleanedText += replacement;
        
        // Record the mapping
        mappings.push({
            originalStart: matchStart,
            originalEnd: matchEnd,
            cleanedStart: cleanedOffset,
            cleanedEnd: cleanedOffset + replacement.length,
            type: 'mustache',
            replacement: replacement
        });
        
        cleanedOffset += replacement.length;
        lastIndex = matchEnd;
    }
    
    // Add remaining text after last mustache expression
    if (lastIndex < text.length) {
        const textAfter = text.slice(lastIndex);
        cleanedText += textAfter;
        
        mappings.push({
            originalStart: lastIndex,
            originalEnd: text.length,
            cleanedStart: cleanedOffset,
            cleanedEnd: cleanedOffset + textAfter.length,
            type: 'text'
        });
    }
    
    // Post-processing: Remove invalid trailing commas
    // This handles cases where mustache blocks leave behind commas before closing brackets/braces
    cleanedText = removeInvalidTrailingCommas(cleanedText);
    
    return {
        cleanedText,
        hasMustache: foundMustache,
        mappings
    };
}

/**
 * Remove invalid trailing commas that appear before closing brackets or braces
 * This happens when mustache blocks are removed but leave structural elements
 */
function removeInvalidTrailingCommas(text: string): string {
    // Pattern 1: comma followed by whitespace and closing bracket ]
    // Example: "items": [1, 2, ] -> "items": [1, 2]
    text = text.replace(/,(\s*)\]/g, '$1]');
    
    // Pattern 2: comma followed by whitespace and closing brace }
    // Example: "obj": {a: 1, } -> "obj": {a: 1}
    text = text.replace(/,(\s*)\}/g, '$1}');
    
    return text;
}

/**
 * Maps a position in the cleaned text back to the original text
 */
export function mapCleanedToOriginal(
    cleanedOffset: number, 
    mappings: PositionMapping[]
): number {
    // Find the mapping that contains this cleaned offset
    for (const mapping of mappings) {
        if (cleanedOffset >= mapping.cleanedStart && cleanedOffset <= mapping.cleanedEnd) {
            // Calculate relative position within this mapping
            const relativeOffset = cleanedOffset - mapping.cleanedStart;
            
            if (mapping.type === 'text') {
                // Direct mapping for text segments
                return mapping.originalStart + relativeOffset;
            } else {
                // For mustache replacements, map to the start of the original mustache
                // This ensures errors point to the mustache expression
                return mapping.originalStart;
            }
        }
    }
    
    // If not found in any mapping, return closest position
    if (cleanedOffset <= 0) return 0;
    
    // Find the last mapping before this offset
    for (let i = mappings.length - 1; i >= 0; i--) {
        if (mappings[i].cleanedStart < cleanedOffset) {
            return mappings[i].originalEnd;
        }
    }
    
    return 0;
}

/**
 * Maps a range in the cleaned text back to the original text
 */
export function mapCleanedRangeToOriginal(
    cleanedStart: number,
    cleanedEnd: number,
    mappings: PositionMapping[]
): { start: number; end: number } {
    return {
        start: mapCleanedToOriginal(cleanedStart, mappings),
        end: mapCleanedToOriginal(cleanedEnd, mappings)
    };
}

/**
 * Converts a cleaned document offset to original document position
 */
export function mapCleanedOffsetToOriginalPosition(
    cleanedOffset: number,
    originalDoc: vscode.TextDocument,
    mappings: PositionMapping[]
): vscode.Position {
    const originalOffset = mapCleanedToOriginal(cleanedOffset, mappings);
    return originalDoc.positionAt(originalOffset);
}

/**
 * Converts a cleaned document range to original document range
 */
export function mapCleanedRangeToOriginalRange(
    cleanedStart: number,
    cleanedEnd: number,
    originalDoc: vscode.TextDocument,
    mappings: PositionMapping[]
): vscode.Range {
    const { start: originalStart, end: originalEnd } = mapCleanedRangeToOriginal(
        cleanedStart,
        cleanedEnd,
        mappings
    );
    
    return new vscode.Range(
        originalDoc.positionAt(originalStart),
        originalDoc.positionAt(originalEnd)
    );
}

