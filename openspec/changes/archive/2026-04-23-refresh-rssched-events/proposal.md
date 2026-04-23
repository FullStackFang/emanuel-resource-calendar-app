## Why

Refreshing calendar events from Resource Scheduler CSV exports currently requires chaining 4-5 separate scripts (`quick-csv-import.js`, `export-to-graph.js`, `import-rssched.js`, `migrate-csv-to-graph.js`, `cleanup-csv-graph-duplicates.js`), each with different auth models, document formats, and CLI interfaces. The newer `import-rssched.js` is closest to correct but still uses delegated tokens for Graph API (requiring manual token extraction from browser DevTools) and creates documents missing critical schema fields (`status`, `calendarOwner`, `_version`, `statusHistory`). A single, repeatable script using the app-only `graphApiService` would eliminate manual token management and produce fully-formed event documents.

## What Changes

- **New script**: `backend/refresh-events.js` — single CLI tool with 3 phases (clean, import, publish) that handles the full lifecycle of refreshing rsSched events for a given calendar and year
- **App-only Graph auth**: Uses `graphApiService.js` (client credentials) instead of delegated tokens — no manual token extraction needed
- **Complete document schema**: Imported events include all modern fields (`status: 'published'`, `calendarOwner`, `_version: 1`, `statusHistory`, `publishedAt`, `eventType: 'singleInstance'`, `createdSource: 'rssched-import'`)
- **Year-scoped operations**: Clean phase deletes only rsSched events within the specified year, preserving manually-created reservations
- **Phase-based re-runs**: `--phase=clean|import|publish` allows re-running individual phases on failure without restarting the entire process
- **Retire obsolete scripts**: `quick-csv-import.js`, `export-to-graph.js`, `migrate-csv-to-graph.js`, `cleanup-csv-graph-duplicates.js` become obsolete

## Capabilities

### New Capabilities
- `rssched-refresh`: End-to-end refresh of Resource Scheduler events — CSV import to MongoDB with full schema, Graph event creation via app-only auth, year-scoped cleanup of existing events from both MongoDB and Outlook

### Modified Capabilities
<!-- No existing specs to modify -->

## Impact

- **New file**: `backend/refresh-events.js`
- **Dependencies**: `backend/services/graphApiService.js` (existing, app-only auth), `backend/calendar-config.json` (existing, calendar ID lookup), `csv-parser` (existing npm dep)
- **Reuses**: CSV parsing logic and location-matching from `import-rssched.js`
- **Obsoletes**: `backend/quick-csv-import.js`, `backend/export-to-graph.js`, `backend/migrate-csv-to-graph.js`, `backend/cleanup-csv-graph-duplicates.js`
- **No API or frontend changes** — this is a backend CLI tool only
