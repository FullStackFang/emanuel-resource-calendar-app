## ADDED Requirements

### Requirement: CLI interface
The script SHALL be invoked as `node refresh-events.js <calendarOwner> --file=<csv> [options]` where `calendarOwner` is an email address that maps to a `calendarId` in `calendar-config.json`.

The script SHALL support the following options:
- `--file=<name>` — CSV file in `csv-imports/` folder (required for import phase)
- `--year=<YYYY>` — Scope clean/publish to events in this year (required)
- `--dry-run` — Preview all phases without making changes
- `--phase=clean|import|publish` — Run only the specified phase
- `--batch-size=N` — MongoDB batch size (default: 100)
- `--graph-batch-size=N` — Graph API batch size (default: 4, max: 20)
- `--graph-delay=N` — Milliseconds between Graph batches (default: 500)

#### Scenario: Valid invocation with all phases
- **WHEN** user runs `node refresh-events.js templeeventssandbox@emanuelnyc.org --file=2026.csv --year=2026`
- **THEN** the script runs clean, import, and publish phases sequentially

#### Scenario: Single phase invocation
- **WHEN** user runs `node refresh-events.js templeeventssandbox@emanuelnyc.org --year=2026 --phase=publish`
- **THEN** only the publish phase runs

#### Scenario: Unknown calendar owner
- **WHEN** user provides a calendarOwner email not found in `calendar-config.json`
- **THEN** the script exits with an error listing available calendar emails

#### Scenario: Missing required arguments
- **WHEN** user runs the script without `--year` or without `calendarOwner`
- **THEN** the script prints usage help and exits

### Requirement: Clean phase deletes rsSched events from Graph and MongoDB
The clean phase SHALL delete all events matching `source: { $in: ['rsSched', 'Resource Scheduler Import'] }` for the specified `calendarOwner` and year range (`startDateTime >= YYYY-01-01` and `startDateTime < YYYY+1-01-01`).

For each event that has a `graphData.id`, the script SHALL delete the corresponding Graph event via `graphApiService.deleteCalendarEvent()` before removing the MongoDB document.

The clean phase SHALL NOT delete events with a different `source` value or no `source` field (preserving manually-created reservations).

#### Scenario: Clean rsSched events for 2026
- **WHEN** clean phase runs for year 2026
- **THEN** only events with `source` in `['rsSched', 'Resource Scheduler Import']` AND `startDateTime` in 2026 are deleted from both Graph and MongoDB

#### Scenario: Clean preserves manual reservations
- **WHEN** clean phase runs and the database contains events with `source: undefined` or other source values in the same year
- **THEN** those events are not deleted

#### Scenario: Clean handles events without graphData.id
- **WHEN** an rsSched event has no `graphData.id` (never published to Graph)
- **THEN** the script skips the Graph deletion and only deletes the MongoDB document

#### Scenario: Dry run clean
- **WHEN** clean phase runs with `--dry-run`
- **THEN** the script reports how many events would be deleted from Graph and MongoDB without making changes

### Requirement: Import phase creates complete event documents from CSV
The import phase SHALL parse the CSV file and create MongoDB documents in `templeEvents__Events` with all fields required by the modern schema.

Each document SHALL include:
- `eventId: 'rssched-{rsId}'` (from CSV `rsId` column)
- `source: 'rsSched'`
- `status: 'published'`
- `calendarOwner: <from CLI arg>`
- `calendarId: <looked up from calendar-config.json>`
- `_version: 1`
- `statusHistory: [{ status: 'published', changedAt, changedBy: 'rssched-import', reason: 'rsSched import' }]`
- `publishedAt: <import timestamp>`
- `publishedBy: 'rssched-import@system'`
- `eventType: 'singleInstance'`
- `createdSource: 'rssched-import'`
- `graphData: null` (populated in publish phase)
- Top-level time fields: `startDateTime`, `endDateTime`, `startDate`, `startTime`, `endDate`, `endTime`
- Location matching via `rsKey` against `templeEvents__Locations`
- `rschedData` object preserving raw CSV fields

#### Scenario: Standard CSV import
- **WHEN** import phase runs with a valid CSV file
- **THEN** events are inserted into MongoDB with all required schema fields and `status: 'published'`

#### Scenario: Location matching by rsKey
- **WHEN** a CSV row has an `rsKey` that matches a location's `rsKey` in `templeEvents__Locations`
- **THEN** the event document includes the location `ObjectId` in `locations` and the display name in `locationDisplayNames`

#### Scenario: Unmatched locations are logged
- **WHEN** a CSV row has an `rsKey` with no matching location
- **THEN** the event is still imported but with empty `locations`, and the unmatched code is logged in the summary

#### Scenario: Deleted rows are skipped
- **WHEN** a CSV row has `Deleted` = `1` or `true`
- **THEN** that row is not imported

#### Scenario: Dry run import
- **WHEN** import phase runs with `--dry-run`
- **THEN** the script parses the CSV, reports counts and a sample document, but inserts nothing

### Requirement: Publish phase creates Graph events via app-only auth
The publish phase SHALL query MongoDB for events with `source: 'rsSched'`, `calendarOwner` matching the CLI arg, `graphData` that is null or missing `graphData.id`, and `startDateTime` in the specified year.

For each batch, the script SHALL use `graphApiService.batchRequest()` with URLs in the format `/users/{calendarOwner}/calendars/{calendarId}/events`.

On successful Graph event creation, the script SHALL update the MongoDB document with `graphData.id`, `graphData.iCalUId`, and `graphData.webLink` from the Graph API response.

#### Scenario: Publish unpublished events
- **WHEN** publish phase runs and there are events without `graphData.id`
- **THEN** Graph events are created and the Graph IDs are saved back to MongoDB

#### Scenario: Skip already-published events
- **WHEN** publish phase runs and an event already has `graphData.id`
- **THEN** that event is skipped (idempotent)

#### Scenario: Rate limit handling
- **WHEN** Graph API returns 429 (throttled) during a batch
- **THEN** the script waits with exponential backoff and retries the batch up to 3 times

#### Scenario: Partial batch failure
- **WHEN** some events in a batch succeed and others fail
- **THEN** successful events have their `graphData.id` saved; failed events are logged and remain publishable for a re-run

#### Scenario: Dry run publish
- **WHEN** publish phase runs with `--dry-run`
- **THEN** the script reports how many events would be published without making Graph API calls

### Requirement: Progress reporting
The script SHALL display progress during each phase including batch number, success/failure counts, and a final summary with totals.

#### Scenario: Summary after full run
- **WHEN** all three phases complete
- **THEN** the script prints a summary showing events cleaned (Graph + MongoDB), events imported, events published, and any failures

#### Scenario: Estimated time for publish
- **WHEN** publish phase starts with events to publish
- **THEN** the script prints an estimated time based on event count, batch size, and delay settings
