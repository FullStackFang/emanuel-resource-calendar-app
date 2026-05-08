## ADDED Requirements

### Requirement: POST /api/events/load fetches per-calendar Graph data in parallel

`POST /api/events/load` SHALL issue Graph API fetches for the user's set of calendars in parallel using `Promise.allSettled(...)`. A failure in one calendar's fetch SHALL NOT cause the overall request to fail; it SHALL be handled per-calendar with a structured warning log and a "no events from this calendar" result, matching today's per-calendar try/catch semantics.

#### Scenario: Three calendars complete in parallel

- **WHEN** a user with three calendars triggers `/api/events/load`
- **THEN** the three Graph fetches dispatch concurrently, the request completes in approximately the slowest single fetch's duration (not the sum), and the response includes events from all three

#### Scenario: One calendar fails, others succeed

- **WHEN** Graph returns 5xx for one of the three calendars
- **THEN** the failed calendar contributes zero events to the response, the warning is logged with the calendar identifier, and the request still returns 200 with events from the two successful calendars

### Requirement: Series-master enrichment is conditional on master presence

`enrichSeriesMastersWithOverrides` SHALL only run when the prior query yielded at least one document with `eventType === 'seriesMaster'`. The retry-on-empty path that protects against cold Cosmos DB index metadata SHALL be preserved when masters do exist.

#### Scenario: No masters in the result skip enrichment

- **WHEN** the events query returns zero series masters
- **THEN** `enrichSeriesMastersWithOverrides` is not called, sparing one cross-partition Cosmos query

#### Scenario: Masters present, retry-on-empty preserved

- **WHEN** masters exist and the override query returns empty on the first call
- **THEN** the existing single retry executes (preserving today's behavior against cold-partition warmup)

### Requirement: GET /api/events/list sorts in MongoDB and excludes graphData from the response

`GET /api/events/list` SHALL apply its time-window sort inside the MongoDB query (using a compound index, not a JavaScript array sort over the result set). Its response SHALL exclude `graphData` from each returned event document via a Mongo projection. Callers needing `graphData` SHALL use the per-event detail endpoint.

#### Scenario: Sort comes from Mongo, not JS

- **WHEN** the list endpoint runs against a result set of any size
- **THEN** the documents arrive from Mongo already sorted; the handler does not call `Array.prototype.sort` on the result

#### Scenario: List response payload omits graphData

- **WHEN** a client receives a `GET /api/events/list` response
- **THEN** none of the items contain a `graphData` field; the wire payload is correspondingly smaller and parses faster

#### Scenario: Detail endpoint still returns graphData

- **WHEN** a client requests a single event via the detail endpoint
- **THEN** the response includes `graphData` unchanged, preserving the documented "details have graphData, list does not" pattern

### Requirement: Compound index supports the list sort

`templeEvents__Events` SHALL have a compound index on `(status, calendarData.startDateTime)` (or a superset such as `(calendarOwner, status, calendarData.startDateTime)` if the query-shape audit during extraction calls for it). The index SHALL be created idempotently — `createIndex` calls SHALL NOT fail on re-deploy.

#### Scenario: Index exists in the deployed environment

- **WHEN** querying `db.templeEvents__Events.getIndexes()` in any environment after deployment
- **THEN** the compound index is present

#### Scenario: Re-deploy is a no-op for the index

- **WHEN** the deployment runs `createIndex` against an environment that already has the index
- **THEN** the call returns success without recreating the index

### Requirement: POST /api/events/:eventId/audit-update participates in the OCC contract

`POST /api/events/:eventId/audit-update` SHALL perform its update via `conditionalUpdate(...)` (or an equivalent `findOneAndUpdate` call that enforces the `_version` precondition) instead of a bare `updateOne`. The endpoint SHALL accept `expectedVersion` in the request body. When `expectedVersion` is `null` or omitted, the version check SHALL be skipped (matching the documented backward-compat pattern). When provided and mismatched, the endpoint SHALL respond with `409` and the standard `VERSION_CONFLICT` payload.

#### Scenario: Concurrent edits produce a 409

- **WHEN** two clients submit `audit-update` calls with the same `expectedVersion`
- **THEN** the first request succeeds (incrementing `_version`); the second receives 409 with code `VERSION_CONFLICT` and a field-level diff snapshot

#### Scenario: Legacy caller without expectedVersion still works

- **WHEN** a request omits `expectedVersion`
- **THEN** the endpoint applies the update without a version check (preserving today's behavior for callers that have not yet adopted OCC)

#### Scenario: Single round-trip read-after-write

- **WHEN** the endpoint updates the document
- **THEN** it returns the post-update document via `findOneAndUpdate({ returnDocument: 'after' })` without performing a redundant trailing `findOne`

### Requirement: Performance contract is regression-tested

Targeted backend tests SHALL exist for: (a) parallel Graph fetch behavior on `/api/events/load`, including the partial-failure path; (b) conditional enrichment skipping when no masters are present; (c) `audit-update` 409 behavior under version mismatch; (d) `audit-update` skipping the version check when `expectedVersion` is null. The list endpoint's projection SHALL be asserted in at least one test.

#### Scenario: Test asserts parallel fetch failure tolerance

- **WHEN** the test mocks one calendar's Graph fetch to fail
- **THEN** the response is 200 with events from the surviving calendars and no error thrown

#### Scenario: Test asserts list response has no graphData

- **WHEN** the list endpoint test inspects each returned event
- **THEN** none of them contain a `graphData` field
