## MODIFIED Requirements

### Requirement: Occurrence-scoped approval is pre-validated, writes an exception document, bumps the master
When the edit request has `editScope: 'thisEvent'` with an `occurrenceDate`, the system SHALL, BEFORE Write 1: resolve the series master (400 if the target is not one), validate the date is in range, build the override via `extractOverrideData` with recurrence keys stripped, and reject any `startDate`/`startDateTime` that disagrees with `occurrenceDate` (400 `DATE_IMMUTABLE`). It SHALL also, BEFORE Write 1, compare a non-null body `eventVersion` to the master's current `_version` and return 409 `VERSION_CONFLICT` with no writes when they differ. It SHALL then create or update the `exception` child document via `exceptionDocumentService`, perform a `conditionalUpdate` on the master with `expectedVersion: eventVersion` that sets `lastModifiedDateTime`/`lastModifiedBy` and pushes a `statusHistory` entry, and SHALL NOT write to `occurrenceOverrides[]`. The response SHALL carry the master's new `eventVersion` and the `exceptionDocId`; the SSE payload SHALL be the re-read master.

#### Scenario: Pre-flight failure leaves the request pending
- **WHEN** an occurrence-scoped request targets a `singleInstance` event
- **THEN** the response is 400, the edit request status is still `pending`, and no event document changed

#### Scenario: New exception created and one instance patched
- **WHEN** an occurrence-scoped request changing `eventTitle` is approved on a published series master with no child for that date and the Graph mock returns an instance on that date
- **THEN** an `exception` document with `seriesMasterEventId` = master `eventId`, `occurrenceDate` = the date, `overrides.eventTitle` = the new title and `graphEventId` = the instance id exists; the master's `occurrenceOverrides` is unchanged; the master's `_version` increased by one; `getCallHistory('updateCalendarEvent')` has one entry for the instance id with the new `subject`; the response `eventVersion` equals the master's new `_version`

#### Scenario: Existing exception updated in place
- **WHEN** an occurrence-scoped request is approved and an `exception` document already exists for that date
- **THEN** exactly one child exists for that date afterwards and its `overrides` include the approved fields

#### Scenario: Stale eventVersion is refused before Write 1
- **WHEN** the request body's `eventVersion` is stale
- **THEN** the response is 409 with `details.code: 'VERSION_CONFLICT'`, the edit request status is still `pending`, and no event document changed

#### Scenario: Version race after the pre-check is a recorded partial failure
- **WHEN** the master's `_version` is bumped after the pre-check and before the master write
- **THEN** the response is 409 with `partialFailure: true` and `compensationRequired: true`, and an `edit-request-approval-split` audit entry exists

#### Scenario: Instance not resolvable
- **WHEN** the Graph mock returns no instance for the occurrence date
- **THEN** the exception document is still written, `assertNotCalled('updateCalendarEvent')` holds, and the response `graphSync.failed` contains `{ kind: 'occurrence', date }`

#### Scenario: Whole-state conflict check uses the occurrence's own date
- **WHEN** an occurrence-scoped request changes only `locations` and the new room is booked on the occurrence date but free on the series' first date
- **THEN** the response is 409 `SchedulingConflict`
