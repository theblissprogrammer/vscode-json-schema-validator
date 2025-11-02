# Change Log

All notable changes to the "stc-schema-validator" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added
- **🎨 Settings UI**: Beautiful webview-based settings panel for easy configuration
- **API Endpoint Support**: Schema can now be loaded from HTTP/HTTPS URLs
- **Schema Caching**: Automatic caching of URL-based schemas with configurable duration
- **New Configuration Options**:
  - `jsonSchemaValidator.schemaUrl`: Fetch schema from API endpoint
  - `jsonSchemaValidator.schemaCacheDuration`: Control cache duration (default: 5 minutes)
- **New Commands**:
  - "JSON Schema Validator: Configure Settings" - Opens settings UI
  - "Refresh JSON Schema Cache" - Manually clear and reload schema

### Changed
- `runValidation` function is now async to support URL-based schema loading
- `JsonQuickFixProvider` now loads schemas asynchronously
- Schema loading centralized in new `schemaLoader.ts` utility

### Improved
- Better error handling for network failures
- Detailed logging for schema loading operations
- Support for HTTP redirects when fetching schemas

## [0.0.2] - Previous Release

- Initial release