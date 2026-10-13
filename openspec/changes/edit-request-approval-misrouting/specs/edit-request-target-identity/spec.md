## ADDED Requirements

### Requirement: An edit request targets the document it was submitted against
The system SHALL store the target document's `_id` as `eventObjectId` on every edit request, and every endpoint that acts on a request (approve, single-request hydration, reject, `GET /api/events/:id/version`) SHALL resolve the target by that `_id`. The `eventId` lookup SHALL be used only for legacy requests that carry no `eventObjectId`.

#### Scenario: Two documents share an eventId and the request is anchored to the second
- **WHEN** two event documents share one `eventId`, an edit request has `eventObjectId` equal to the second document's `_id`, and an approver approves it with the second document's `_version`
- **THEN** the second document carries the approved changes and its `_version` increased by one, the first document is byte-identical to before, and the audit entry's `reservationId` is the second document's `_id`

#### Scenario: Hydration returns the anchored document
- **WHEN** `GET /api/edit-requests/:id` is called for a request whose `eventObjectId` names the second of two same-`eventId` documents
- **THEN** the hydrated `event._id` is the second document's `_id` and `baselineShifted` is computed against it

#### Scenario: Reject email deep-links the anchored document
- **WHEN** a request anchored to the second of two same-`eventId` documents is rejected
- **THEN** the rejection email payload's event id is the second document's `_id`

#### Scenario: Legacy request without eventObjectId
- **WHEN** an edit request has no `eventObjectId`
- **THEN** the endpoints resolve the target by `eventId` exactly as before

### Requirement: Submit anchors the request to the opened document
The submit endpoint SHALL prefer an explicit `eventObjectId` in the body, then a valid ObjectId in `eventId`, and only then the `eventId` string lookup. The frontend SHALL send both `eventObjectId` (the opened item's `_id`) and `eventId`.

#### Scenario: Explicit eventObjectId wins over a duplicated eventId
- **WHEN** two documents share an `eventId` and the body carries `eventObjectId` of the second
- **THEN** the created request's `eventObjectId` is the second document's `_id` and its `baselineSnapshot._version` is that document's version

#### Scenario: Frontend payload
- **WHEN** a user submits an edit request from the review modal for an item with `_id`
- **THEN** the request body contains `eventObjectId` equal to that `_id`

### Requirement: Stale version is refused before any write
Before flipping the request to `approved`, approve SHALL read the target document's current `_version`; when the body's `eventVersion` is non-null and differs, it SHALL return 409 with the standard version-conflict envelope and SHALL NOT modify the request or the event.

#### Scenario: Stale eventVersion leaves the request pending
- **WHEN** the body's `eventVersion` is one less than the target's `_version`
- **THEN** the response is 409 with `details.code: 'VERSION_CONFLICT'`, the request status is still `pending`, the event `_version` is unchanged, and no audit entry was written

#### Scenario: Null eventVersion skips the pre-check
- **WHEN** the body carries `eventVersion: null`
- **THEN** approval proceeds as before

### Requirement: A residual write race is recorded, not hidden
When the event write fails the version check AFTER the request was marked approved, the system SHALL log at error level, insert an `edit-request-approval-split` audit entry carrying the request id and both versions, and return the `partialFailure` body whose message SHALL NOT reference a re-apply action.

#### Scenario: Version moves between pre-check and write
- **WHEN** the target's `_version` is bumped after the pre-check passed and before the event write
- **THEN** the response is 409 with `partialFailure: true`, an audit entry with `action: 'edit-request-approval-split'` exists for the event, and the message does not contain 're-apply'

### Requirement: The approve apply core is shared
The approve endpoint SHALL perform the apply (final-changes derivation, conflict check, event write, Graph sync, audit insert) through an exported helper `applyApprovedEditRequest`, so that a script can run the identical path.

#### Scenario: Source assertion
- **WHEN** the approve handler source is inspected
- **THEN** it calls `applyApprovedEditRequest` and `module.exports` exposes the helper

#### Scenario: Helper refuses without side effects
- **WHEN** the helper is called with a request whose changes introduce a hard scheduling conflict and `forcePublishEdit: false`
- **THEN** it returns `refused` with status 409 and no event document, audit entry or Graph call was made
