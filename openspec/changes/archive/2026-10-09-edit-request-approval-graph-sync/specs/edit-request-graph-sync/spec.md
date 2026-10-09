## ADDED Requirements

### Requirement: Series-level approval patches the Graph master from effective state
When `PUT /api/edit-requests/:id/approve` applies a series-level (`editScope` null or `allEvents`) edit request to an event that has `graphData.id`, the system SHALL PATCH the Graph master after the event write commits and before the response is sent. The payload SHALL be built by the shared `buildMasterPatch` from the post-write event document plus the set of changed field names, so unchanged fields (locations, offsite, recurrence, hold state) resolve from stored state rather than from the request delta.

#### Scenario: Title and time change reaches Outlook
- **WHEN** an approver approves a request on a published single-instance event whose `proposedChanges` contain only `eventTitle`, `startDateTime` and `endDateTime`
- **THEN** `getCallHistory('updateCalendarEvent')` has one entry for the master's `graphData.id` whose payload has `subject` equal to the new title and `start.dateTime`/`end.dateTime` equal to the new times in the event's stored timezone

#### Scenario: Time-only change on a series is still aligned to range start
- **WHEN** an approver approves a request on a published weekly series whose `proposedChanges` contain `startDateTime`/`endDateTime` and NO `recurrence`
- **THEN** the PATCH payload's `start.dateTime` and `end.dateTime` are dated on the stored `recurrence.range.startDate` with the new time-of-day, and no `recurrence` key is sent

#### Scenario: Room change resolves display names
- **WHEN** the approved `proposedChanges` contain `locations` (ObjectIds) for a published event
- **THEN** the PATCH payload's `location.displayName` and `locations[].displayName` are the location documents' names, not empty strings

#### Scenario: Recurrence change is aligned to range start
- **WHEN** the approved `proposedChanges.recurrence.range.startDate` differs from the stored one
- **THEN** the PATCH carries the new `recurrence` and `start.dateTime`/`end.dateTime` dated on the new `range.startDate` with the time-of-day preserved

#### Scenario: Unpublished event is not synced
- **WHEN** an approver approves a request on an event with no `graphData.id`
- **THEN** `assertNotCalled('updateCalendarEvent')` holds and the approval succeeds as today

### Requirement: Approval runs the published-series reconciliation
When the approved event is a published series master, the system SHALL, after the master PATCH, call the shared `reconcilePublishedSeries`: materialize addition documents for dates in `recurrence.additions[]`, create Graph events for children with no `graphEventId`, cascade master changes to children that have a `graphEventId`, and handle exclusions per the `recurrence-exclusion-graph-sync` capability.

#### Scenario: Added date gets a standalone Graph event
- **WHEN** the approved `recurrence.additions` contains a date not previously present
- **THEN** an `addition` child document exists for that date after approval, `getCallHistory('createCalendarEvent')` has one entry dated on it, and the child carries the returned `graphEventId`

#### Scenario: Newly excluded date is cancelled in Outlook
- **WHEN** the approved `recurrence.exclusions` contains a date not previously present and the Graph mock returns an instance on that date
- **THEN** `getCallHistory('deleteCalendarEvent')` has one entry with that instance id and the master's `graphData.cancelledOccurrences` contains `{ date, graphId }`

#### Scenario: Master title change cascades to a linked child
- **WHEN** the approved changes include `eventTitle` and an `exception` child with a `graphEventId` exists for the series
- **THEN** `getCallHistory('updateCalendarEvent')` has an entry for the child's `graphEventId` with the new `subject`

#### Scenario: Pre-existing exclusions are not re-queried when recurrence is unchanged
- **WHEN** the approved `recurrence` equals the stored recurrence except for one added exclusion
- **THEN** `getCallHistory('getRecurringEventInstances')` has exactly one entry

### Requirement: Approval cannot remove exclusions
The approve path SHALL apply the same `EXCLUSION_REMOVAL_NOT_SUPPORTED` guard the submit path applies, evaluated on `finalChanges` (proposed changes merged with `approverChanges`), and SHALL return 400 before Write 1 when a stored exclusion is absent from the final recurrence.

#### Scenario: approverChanges drop an exclusion
- **WHEN** an approver supplies `approverChanges.recurrence` whose `exclusions` omit a date present in the stored recurrence
- **THEN** the response is 400 `EXCLUSION_REMOVAL_NOT_SUPPORTED`, the edit request remains `pending`, and the event is unchanged

### Requirement: Occurrence-scoped approval is pre-validated, writes an exception document, bumps the master
When the edit request has `editScope: 'thisEvent'` with an `occurrenceDate`, the system SHALL, BEFORE Write 1: resolve the series master (400 if the target is not one), validate the date is in range, build the override via `extractOverrideData` with recurrence keys stripped, and reject any `startDate`/`startDateTime` that disagrees with `occurrenceDate` (400 `DATE_IMMUTABLE`). It SHALL then create or update the `exception` child document via `exceptionDocumentService`, perform a `conditionalUpdate` on the master with `expectedVersion: eventVersion` that sets `lastModifiedDateTime`/`lastModifiedBy` and pushes a `statusHistory` entry, and SHALL NOT write to `occurrenceOverrides[]`. The response SHALL carry the master's new `eventVersion` and the `exceptionDocId`; the SSE payload SHALL be the re-read master.

#### Scenario: Pre-flight failure leaves the request pending
- **WHEN** an occurrence-scoped request targets a `singleInstance` event
- **THEN** the response is 400, the edit request status is still `pending`, and no event document changed

#### Scenario: New exception created and one instance patched
- **WHEN** an occurrence-scoped request changing `eventTitle` is approved on a published series master with no child for that date and the Graph mock returns an instance on that date
- **THEN** an `exception` document with `seriesMasterEventId` = master `eventId`, `occurrenceDate` = the date, `overrides.eventTitle` = the new title and `graphEventId` = the instance id exists; the master's `occurrenceOverrides` is unchanged; the master's `_version` increased by one; `getCallHistory('updateCalendarEvent')` has one entry for the instance id with the new `subject`; the response `eventVersion` equals the master's new `_version`

#### Scenario: Existing exception updated in place
- **WHEN** an occurrence-scoped request is approved and an `exception` document already exists for that date
- **THEN** exactly one child exists for that date afterwards and its `overrides` include the approved fields

#### Scenario: Stale eventVersion is a partial failure, as today
- **WHEN** the request body's `eventVersion` is stale
- **THEN** the response is 409 with `partialFailure: true` and `compensationRequired: true`

#### Scenario: Instance not resolvable
- **WHEN** the Graph mock returns no instance for the occurrence date
- **THEN** the exception document is still written, `assertNotCalled('updateCalendarEvent')` holds, and the response `graphSync.failed` contains `{ kind: 'occurrence', date }`

#### Scenario: Whole-state conflict check uses the occurrence's own date
- **WHEN** an occurrence-scoped request changes only `locations` and the new room is booked on the occurrence date but free on the series' first date
- **THEN** the response is 409 `SchedulingConflict`

### Requirement: Graph failure never un-approves and is reported
Graph errors during approval sync SHALL NOT change the response status or roll back either write. The response SHALL include `graphSync: { synced: [{kind, date, graphId}], failed: [{kind, date, error}], cancelledExclusions: [{date, graphId}] }` where `kind` is one of `master | addition | exception | occurrence | exclusion`, and the `edit-request-approved` audit entry SHALL carry the same object under `metadata.graphSync`. Follow-up writes made by the sync (`graphData`, `cancelledOccurrences`, children's `graphEventId`) SHALL NOT increment the master's `_version`.

#### Scenario: Graph PATCH throws
- **WHEN** `graphApiMock.setMockError('updateCalendarEvent', graphApiMock.graphError(503, 'busy'))` is set
- **THEN** the response is 200, the edit request is `approved`, the event carries the new values, `graphSync.failed[0].kind === 'master'`, and the response `eventVersion` equals the stored `_version`

#### Scenario: Success summary is auditable
- **WHEN** the approval sync completes without error
- **THEN** the audit entry's `metadata.graphSync.synced` lists `{ kind: 'master', graphId }` and `failed` is empty

### Requirement: Both handlers consume the shared module
`backend/api-server.js` SHALL call `buildMasterPatch` and `reconcilePublishedSeries` from `services/publishedMasterGraphSync.js` in both the admin Save handler and the approval handler, and the admin Save handler SHALL contain no inline Graph PATCH payload construction.

#### Scenario: Source assertion
- **WHEN** the test reads `api-server.js` as text
- **THEN** it finds `reconcilePublishedSeries(` at least twice, `buildMasterPatch(` at least twice, and no occurrence of `graphUpdate.recurrence = buildGraphRecurrence(` outside the shared module

#### Scenario: Save Graph payloads unchanged by extraction
- **WHEN** the characterization suite captured on HEAD is run after the extraction
- **THEN** every snapshotted `updateCalendarEvent` payload, call order, `graphSynced` value and `graphData` merge is identical
