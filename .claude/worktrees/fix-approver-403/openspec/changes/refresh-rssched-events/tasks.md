## 1. Script Scaffold and CLI Parsing

- [x] 1.1 Create `backend/refresh-events.js` with arg parsing: calendarOwner (positional), --file, --year, --dry-run, --phase, --batch-size, --graph-batch-size, --graph-delay
- [x] 1.2 Add calendar-config.json lookup (case-insensitive calendarOwner email to calendarId) with error message listing available calendars on mismatch
- [x] 1.3 Add validation: require --year always, require --file when phase includes import, print usage on missing args

## 2. Clean Phase

- [x] 2.1 Implement MongoDB query for rsSched events: `{ calendarOwner, source: { $in: ['rsSched', 'Resource Scheduler Import'] }, startDateTime >= year-start, startDateTime < year-end }`
- [x] 2.2 Implement Graph deletion loop: for events with `graphData.id`, call `graphApiService.deleteCalendarEvent(calendarOwner, calendarId, graphData.id)` with batch delay and error handling (404 = already deleted, continue)
- [x] 2.3 Implement MongoDB batch delete after Graph cleanup, with Cosmos DB rate-limit retry
- [x] 2.4 Add dry-run output showing counts of Graph events and MongoDB documents that would be deleted

## 3. Import Phase

- [x] 3.1 Port CSV parsing from `import-rssched.js`: stream-based parsing with BOM stripping, location lookup via rsKey from `templeEvents__Locations`, skip deleted rows
- [x] 3.2 Build complete event documents with all modern schema fields: status, calendarOwner, calendarId, _version, statusHistory, publishedAt, publishedBy, eventType, createdSource, source, rschedData, top-level time/location fields, graphData: null
- [x] 3.3 Implement batch insert into MongoDB with Cosmos DB rate-limit retry (batch size configurable, default 100)
- [x] 3.4 Add dry-run output showing parsed count, sample document, location match/unmatch summary

## 4. Publish Phase

- [x] 4.1 Query MongoDB for unpublished rsSched events: `{ calendarOwner, source: 'rsSched', $or: [{ graphData: null }, { 'graphData.id': { $exists: false } }], startDateTime in year range }`
- [x] 4.2 Build Graph event payloads from MongoDB documents (subject, start/end with timezone, location displayName, isAllDay, body, categories)
- [x] 4.3 Implement batch publish using `graphApiService.batchRequest()` with `/users/{calendarOwner}/calendars/{calendarId}/events` URLs, configurable batch size and delay
- [x] 4.4 Save Graph response data back to MongoDB: `graphData.id`, `graphData.iCalUId`, `graphData.webLink` for each successfully created event
- [x] 4.5 Add 429 rate-limit detection with exponential backoff retry (max 3 retries per batch)
- [x] 4.6 Add dry-run output showing count of events that would be published

## 5. Progress Reporting and Summary

- [x] 5.1 Add per-phase progress output: batch N/total, success/fail counts, running totals
- [x] 5.2 Add estimated time display at start of publish phase based on event count, batch size, and delay
- [x] 5.3 Add final summary: events cleaned (Graph + MongoDB), events imported, events published, failures per phase

## 6. Cleanup Obsolete Scripts

- [x] 6.1 Delete `backend/quick-csv-import.js`, `backend/export-to-graph.js`, `backend/migrate-csv-to-graph.js`, `backend/cleanup-csv-graph-duplicates.js`
