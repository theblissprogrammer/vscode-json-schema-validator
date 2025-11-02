import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

interface SchemaCache {
    schema: any;
    timestamp: number;
}

// Cache for schemas fetched from URLs
const schemaCache = new Map<string, SchemaCache>();

/**
 * Load a JSON schema from either a file path or URL
 * @param schemaSource - File path or URL to the schema
 * @param cacheDuration - Duration in seconds to cache URL-based schemas
 * @param outputChannel - Optional output channel for logging
 * @returns The parsed JSON schema
 */
export async function loadSchema(
    schemaSource: string,
    cacheDuration: number = 300,
    outputChannel?: vscode.OutputChannel
): Promise<any> {
    outputChannel?.appendLine(`🔍 [LOADER DEBUG] loadSchema called with: ${schemaSource}`);
    
    // Check if it's a URL
    if (isUrl(schemaSource)) {
        outputChannel?.appendLine(`🌐 [LOADER DEBUG] Detected URL, loading from URL...`);
        return loadSchemaFromUrl(schemaSource, cacheDuration, outputChannel);
    } else {
        outputChannel?.appendLine(`📁 [LOADER DEBUG] Detected file path, loading from file...`);
        return loadSchemaFromFile(schemaSource, outputChannel);
    }
}

/**
 * Check if a string is a URL
 */
function isUrl(source: string): boolean {
    return source.startsWith('http://') || source.startsWith('https://');
}

/**
 * Load schema from a local file
 */
function loadSchemaFromFile(filePath: string, outputChannel?: vscode.OutputChannel): any {
    try {
        const resolvedPath = path.resolve(filePath);
        outputChannel?.appendLine(`📁 Loading schema from file: ${resolvedPath}`);
        
        // Check if file exists
        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Schema file not found: ${resolvedPath}`);
        }
        
        const content = fs.readFileSync(resolvedPath, 'utf8');
        outputChannel?.appendLine(`✅ [LOADER DEBUG] File read successfully, parsing JSON...`);
        
        const parsed = JSON.parse(content);
        outputChannel?.appendLine(`✅ [LOADER DEBUG] JSON parsed successfully`);
        return parsed;
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        outputChannel?.appendLine(`❌ Failed to load schema from file: ${errMsg}`);
        throw new Error(`Failed to load schema from file: ${errMsg}`);
    }
}

/**
 * Load schema from a URL with caching
 */
async function loadSchemaFromUrl(
    url: string,
    cacheDuration: number,
    outputChannel?: vscode.OutputChannel
): Promise<any> {
    // Check cache
    const cached = schemaCache.get(url);
    if (cached) {
        const age = (Date.now() - cached.timestamp) / 1000; // age in seconds
        if (age < cacheDuration) {
            outputChannel?.appendLine(`📦 Using cached schema from URL (age: ${age.toFixed(0)}s)`);
            return cached.schema;
        } else {
            outputChannel?.appendLine(`⏰ Cached schema expired (age: ${age.toFixed(0)}s), refetching...`);
        }
    }

    outputChannel?.appendLine(`🌐 Fetching schema from URL: ${url}`);
    
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https://') ? https : http;
        
        const request = client.get(url, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                    outputChannel?.appendLine(`↪️  Redirecting to: ${redirectUrl}`);
                    loadSchemaFromUrl(redirectUrl, cacheDuration, outputChannel)
                        .then(resolve)
                        .catch(reject);
                    return;
                }
            }

            if (response.statusCode !== 200) {
                const error = `Failed to fetch schema: HTTP ${response.statusCode}`;
                outputChannel?.appendLine(`❌ ${error}`);
                reject(new Error(error));
                return;
            }

            let data = '';
            response.on('data', (chunk) => {
                data += chunk;
            });

            response.on('end', () => {
                try {
                    const schema = JSON.parse(data);
                    
                    // Cache the schema
                    schemaCache.set(url, {
                        schema,
                        timestamp: Date.now()
                    });
                    
                    outputChannel?.appendLine(`✅ Successfully fetched and cached schema from URL`);
                    resolve(schema);
                } catch (error) {
                    const errMsg = error instanceof Error ? error.message : String(error);
                    outputChannel?.appendLine(`❌ Failed to parse schema JSON: ${errMsg}`);
                    reject(new Error(`Failed to parse schema JSON: ${errMsg}`));
                }
            });
        });

        request.on('error', (error) => {
            outputChannel?.appendLine(`❌ Network error: ${error.message}`);
            reject(new Error(`Network error: ${error.message}`));
        });

        // Set timeout (5 seconds for faster feedback)
        request.setTimeout(5000, () => {
            request.destroy();
            const error = 'Request timeout after 5 seconds';
            outputChannel?.appendLine(`❌ ${error}`);
            reject(new Error(error));
        });
    });
}

/**
 * Clear the schema cache (useful for testing or manual refresh)
 */
export function clearSchemaCache(): void {
    schemaCache.clear();
}

/**
 * Get the configured schema source (URL takes precedence over path)
 * @param workspaceFolder - The workspace folder to resolve relative paths
 * @returns The schema source (URL or full file path)
 */
export function getSchemaSource(workspaceFolder?: string): string {
    const config = vscode.workspace.getConfiguration('jsonSchemaValidator');
    const schemaUrl = config.get<string>('schemaUrl', '').trim();
    const schemaPath = config.get<string>('schemaPath', '/schemas/schema.json');

    // URL takes precedence
    if (schemaUrl) {
        return schemaUrl;
    }

    // Return full path for file
    if (workspaceFolder) {
        return path.join(workspaceFolder, schemaPath);
    }

    return schemaPath;
}

/**
 * Get the configured cache duration
 */
export function getCacheDuration(): number {
    const config = vscode.workspace.getConfiguration('jsonSchemaValidator');
    return config.get<number>('schemaCacheDuration', 300);
}

