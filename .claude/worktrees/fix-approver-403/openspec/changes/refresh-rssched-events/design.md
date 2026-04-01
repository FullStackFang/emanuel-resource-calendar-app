## Context

The Temple Emanuel calendar app syncs events from Resource Scheduler (rsSched) CSV exports into MongoDB and publishes them to Outlook via Microsoft Graph API. Over time, 5 scripts accumulated for different parts of this workflow, each with different auth models and document formats:

- `import-rssched.js` — CSV to MongoDB (correct format) + Graph publish (delegated token, `/me` endpoint)
- `quick-csv-import.js` — CSV to MongoDB (deprecated format with `internalData`, placeholder `graphData`)
- `export-to-graph.js` — MongoDB to Graph (delegated token, duplicate detection)
- `migrate-csv-to-graph.js` — Links existing MongoDB to existing Graph events (device-code auth)
- `cleanup-csv-graph-duplicates.js` — Removes duplicates created by the above

The backend now uses app-only authentication via `graphApiService.js` for all Graph operations. The scripts still require manually extracting delegated tokens from browser DevTools.

Additionally, `import-rssched.js` creates documents missing critical fields: `status`, `calendarOwner`, `_version`, `statusHistory`. These events are invisible to app queries and break on any admin action.

## Goals / Non-Goals

**Goals:**
- Single CLI script (`refresh-events.js`) for the full clean → import → publish lifecycle
- App-only auth via `graphApiService.js` — no manual token extraction
- Complete event documents matching the modern schema
- Year-scoped operations to avoid touching unrelated data
- Phase-based re-runs for error recovery
- Calendar-selectable (sandbox first, then production)

**Non-Goals:**
- Recurring event support in CSV import (rsSched events are single instances)
- Real-time sync or webhook integration with Resource Scheduler
- Frontend changes or new API endpoints
- Modifying `graphApiService.js` itself
- Handling non-rsSched events (manually created reservations are preserved)

## Decisions

### 1. Use `graphApiService.batchRequest()` for Graph operations

**Decision**: Use the existing `batchRequest()` method with `/users/{calendarOwner}/calendars/{calendarId}/events` URLs, batch size of 4 requests per batch.

**Rationale**: `graphApiService` already handles token acquisition, caching, and the app-only auth flow. Batching is faster than individual calls but small batch sizes (4) reduce rate-limit risk with Cosmos DB + Graph API combined.

**Alternative considered**: Individual `createCalendarEvent()` / `deleteCalendarEvent()` calls — simpler error handling per event, but ~5x slower for 500+ events.

### 2. Calendar identified by `calendarOwner` email (not calendar name)

**Decision**: CLI takes `calendarOwner` email (e.g., `templeeventssandbox@emanuelnyc.org`) as the primary argument. The `calendarId` is looked up from `calendar-config.json` using a case-insensitive key match.

**Rationale**: `calendarOwner` is the field used by `getUnifiedEvents()` and all app queries. Using it as the CLI arg ensures the imported events are discoverable. Calendar names in the config are already keyed by email.

**Alternative considered**: Calendar display name (e.g., "Temple Emanu-El Sandbox") — used by `import-rssched.js`, but fragile and inconsistent with how the app identifies calendars.

### 3. Clean phase targets `source: { $in: ['rsSched', 'Resource Scheduler Import'] }`

**Decision**: Delete both the current (`rsSched`) and legacy (`Resource Scheduler Import`) source markers during cleanup.

**Rationale**: Previous imports used `'Resource Scheduler Import'` as the source. A year-scoped cleanup must catch all rsSched-origin events regardless of which script created them.

### 4. Events imported as `status: 'published'` immediately

**Decision**: Skip the `draft → pending → published` workflow. Events land with `status: 'published'`, `publishedAt`, `publishedBy: 'rssched-import@system'`, and a `statusHistory` entry.

**Rationale**: rsSched events are authoritative — they come from the organization's scheduling system. They don't need approval. The `source: 'rsSched'` field distinguishes them from user-created reservations.

### 5. Three-phase architecture with `--phase` flag

**Decision**: The script runs 3 phases sequentially (clean → import → publish). Each phase is idempotent and can be run independently via `--phase=clean|import|publish`.

**Rationale**: Graph API calls can fail mid-batch due to rate limits or transient errors. Being able to re-run `--phase=publish` without re-importing avoids data duplication. The clean phase is separate because you might want to import without cleaning (additive import) or clean without re-importing (data reset).

**Idempotency guarantees:**
- **Clean**: Skips events already without `graphData.id`; MongoDB delete uses source + year filter
- **Import**: Uses `eventId: rssched-{rsId}` as a natural key; upsert-like behavior via `insertMany` with `ordered: false` (duplicates rejected by unique index on `eventId`)
- **Publish**: Skips events that already have `graphData.id`

### 6. Reuse `graphApiService` directly (not via API server endpoints)

**Decision**: Import `graphApiService` directly as a module rather than calling the API server's HTTP endpoints.

**Rationale**: The script runs as a standalone Node.js process, not through the Express app. Direct module import avoids needing the API server running and avoids JWT auth overhead. This is the same pattern used by other migration scripts.

## Risks / Trade-offs

**[Risk] Graph API rate limiting during bulk publish** → Configurable `--graph-delay` between batches (default 500ms), small batch size (4), exponential backoff on 429 responses. `--phase=publish` allows re-running just the failed portion.

**[Risk] Accidental deletion of non-rsSched events** → Clean phase filters by `source: { $in: ['rsSched', 'Resource Scheduler Import'] }` AND year range. Manual reservations (`source` absent or different) are never touched. `--dry-run` shows exactly what would be deleted.

**[Risk] calendarOwner email mismatch between config keys** → Case-insensitive lookup in `calendar-config.json`. Script exits with available calendars listed if no match found.

**[Risk] CSV format changes from Resource Scheduler** → Script validates expected columns on parse and reports unrecognized headers. Location matching via `rsKey` is best-effort (unmatched locations logged but not fatal).

**[Trade-off] No graph event update, only create/delete** → If an event's details changed in the CSV, the clean+reimport approach deletes and recreates the Graph event (new Graph ID). This is acceptable for a periodic bulk refresh but means Graph event IDs are not stable across refreshes.
