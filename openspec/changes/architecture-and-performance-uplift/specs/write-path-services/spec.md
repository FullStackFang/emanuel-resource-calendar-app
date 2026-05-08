## ADDED Requirements

### Requirement: auditService.record is the single audit insertion path for new code

A new module `backend/services/auditService.js` SHALL export `record(eventId, change)` (and any necessary companion helpers such as `recordBulk`). The module SHALL be the only path through which new code inserts into `templeEvents__EventAuditHistory`. New write handlers (and migrated existing handlers) SHALL call `auditService.record(...)` rather than calling `auditCollection.insertOne(...)` inline.

#### Scenario: New handler audits via the service

- **WHEN** a new write endpoint is added during or after this change
- **THEN** its audit insertion is `await auditService.record(eventId, { changeType, oldValue, newValue, userId, ... })` and there is no inline `auditCollection.insertOne` in the handler

#### Scenario: Existing inline audit migrates as the route extracts

- **WHEN** a handler is moved into a `routes/*.js` module by this change
- **THEN** the handler's inline audit insertions are replaced by `auditService.record(...)` calls at the same time

### Requirement: emailService notification helpers resolve location names internally

`backend/services/emailService.js` SHALL expose notification helpers such as `sendApprovalNotification(eventDoc, opts)`, `sendRejectionNotification(eventDoc, opts)`, `sendEditRequestNotification(eventDoc, opts)`, etc. The helpers SHALL accept the canonical event document and SHALL resolve location names from `eventDoc.locations[]` (using the locations collection) internally. Callers SHALL NOT pre-resolve location names or pre-build reservation payloads.

#### Scenario: Caller passes only the event document

- **WHEN** a write handler dispatches an approval email
- **THEN** the handler calls `emailService.sendApprovalNotification(eventDoc)` and the helper performs the location lookup, payload construction, and Graph send-mail call internally

#### Scenario: No duplicated location lookups across handlers

- **WHEN** the change is archive-ready
- **THEN** location-name resolution for email composition appears in `emailService.js` only — not duplicated in `setImmediate` blocks across multiple route files

### Requirement: lifecycleEvents.afterStateChange is the single SSE broadcast path

A new module `backend/services/lifecycleEvents.js` SHALL export `afterStateChange(event, transition)` and SHALL be the only path through which new code calls `broadcastEventChange(...)`. New write handlers SHALL call `lifecycleEvents.afterStateChange(updatedEvent, { from, to, action })` exactly once after their `res.json(...)` call.

#### Scenario: New write path uses the lifecycle helper

- **WHEN** a new endpoint transitions an event from `draft` to `pending`
- **THEN** the handler calls `lifecycleEvents.afterStateChange(event, { from: 'draft', to: 'pending', action: 'submitted' })` after the response is sent, and does not call `broadcastEventChange` directly

#### Scenario: Helper preserves response timing

- **WHEN** the lifecycle helper runs
- **THEN** the HTTP response to the writer has already been sent; the helper's broadcast is deferred (e.g., via the existing 150 ms write-to-read consistency delay codified in realtime-freshness)

### Requirement: Migration policy — services adopt as routes extract

The retrofit of existing inline audit insertions, inline email composition, and inline SSE broadcasts SHALL happen in lockstep with each route's extraction into a `routes/*.js` module. There SHALL NOT be a separate sweep PR that retrofits all sites at once. While migration is in flight, the helpers and the inline pattern coexist.

#### Scenario: Route module extraction migrates its own sites

- **WHEN** `routes/adminEvents.js` is extracted from `api-server.js`
- **THEN** every `auditCollection.insertOne`, inline email block, and direct `broadcastEventChange` call inside the moved handlers is converted to the service call as part of the same PR

#### Scenario: Sites remaining in api-server.js are not forced to migrate

- **WHEN** routes still live inside `api-server.js`
- **THEN** their inline audit/email/SSE patterns are tolerated and remain functional

### Requirement: Service modules are unit-tested independently

`auditService` and `lifecycleEvents` SHALL each have unit tests under `backend/__tests__/unit/services/`. The tests SHALL exercise the success path, the missing-event path (where applicable), and the error-handling path. `emailService` notification helpers SHALL be covered by the existing `emailTemplates` and `emailService` test suites, expanded to cover the new resolve-locations-internally behavior.

#### Scenario: auditService unit test exists

- **WHEN** the change is archive-ready
- **THEN** `backend/__tests__/unit/services/auditService.test.js` exists and asserts that `record` writes a correctly shaped document into the audit collection

#### Scenario: lifecycleEvents unit test exists

- **WHEN** the change is archive-ready
- **THEN** `backend/__tests__/unit/services/lifecycleEvents.test.js` exists and asserts that `afterStateChange` calls `broadcastEventChange` with the expected arguments
