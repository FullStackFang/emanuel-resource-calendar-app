# pending-queue-scoping Specification

## Purpose

Defines which event documents are eligible to surface in the Approval Queue and My Reservations list/count endpoints, and which documents are eligible as targets for the publish and reject endpoints. Codifies the "only the master is approvable" invariant at both the read layer (list + counts) and the write layer (publish + reject), and mandates that the `GET /api/events/list` endpoint mirror the `getUnifiedEvents` (Calendar) read path for field projection and for exception-driven `occurrenceOverrides` enrichment — so the shared `EventReviewExperience` modal receives identical event shapes regardless of entry point.

## Requirements

### Requirement: Approval Queue excludes per-occurrence override documents

The `GET /api/events/list?view=approval-queue` endpoint SHALL NOT return documents whose `eventType` is `exception` or `addition`. The endpoint SHALL continue to return `seriesMaster`, `singleInstance`, and documents with no `eventType` set.

#### Scenario: Pending series master with exception children
- **WHEN** an approver requests `GET /api/events/list?view=approval-queue&status=pending` and a pending series master has two `exception` child documents (also inheriting `status: 'pending'`)
- **THEN** the response contains exactly one event (the series master), not three

#### Scenario: Pending series master with addition children
- **WHEN** an approver requests `GET /api/events/list?view=approval-queue&status=pending` and a pending series master has one `addition` child document
- **THEN** the response contains exactly one event (the series master)

#### Scenario: Non-recurring pending event unaffected
- **WHEN** an approver requests `GET /api/events/list?view=approval-queue&status=pending` and the pending event is a `singleInstance` (no children)
- **THEN** the response contains that event and the filter does not exclude it

#### Scenario: Legacy pending event with no eventType
- **WHEN** an approver requests `GET /api/events/list?view=approval-queue&status=pending` and the pending event predates the eventType field (field missing)
- **THEN** the response contains that event; absence of `eventType` is not treated as `exception` or `addition`

### Requirement: Approval Queue counts exclude per-occurrence override documents

The `GET /api/events/list/counts?view=approval-queue` endpoint SHALL compute every count (pending, published, rejected, published_edit, published_cancellation, needsAttention, all) over the same document set surfaced by the list endpoint. Documents with `eventType` of `exception` or `addition` SHALL NOT be counted.

#### Scenario: Pending count matches list result
- **WHEN** the database contains one pending series master and two of its pending exception children, and the approver requests `GET /api/events/list/counts?view=approval-queue`
- **THEN** the `pending` count is `1`

#### Scenario: Needs-attention count excludes children
- **WHEN** a published series master has a pending edit request and two exception children also carry `pendingEditRequest.status: 'pending'`
- **THEN** the `needsAttention` count includes the master once and does not inflate on account of the children

### Requirement: My Reservations excludes per-occurrence override documents

The `GET /api/events/list?view=my-events` endpoint SHALL NOT return documents whose `eventType` is `exception` or `addition`. The requester sees one row per reservation they own, regardless of how many occurrence overrides the series has.

#### Scenario: Requester's pending series with overrides
- **WHEN** a requester owns a pending series master with three exception children, and requests `GET /api/events/list?view=my-events&status=pending`
- **THEN** the response contains exactly one event (the series master)

#### Scenario: Requester's published series with overrides
- **WHEN** a requester owns a published series master with two exception children and requests `GET /api/events/list?view=my-events&status=published`
- **THEN** the response contains exactly one event (the series master)

### Requirement: My Reservations counts exclude per-occurrence override documents

The `GET /api/events/list/counts?view=my-events` endpoint SHALL compute all counts (pending, published, rejected, draft, deleted, all) over the same document set surfaced by the list endpoint. Documents with `eventType` of `exception` or `addition` SHALL NOT be counted.

#### Scenario: Published count matches list result
- **WHEN** the requester owns one published series master and two of its published exception children, and requests `GET /api/events/list/counts?view=my-events`
- **THEN** the `published` count is `1`

### Requirement: Publish endpoint rejects per-occurrence override targets

`PUT /api/admin/events/:id/publish` SHALL return HTTP 400 with error code `INVALID_TARGET_EVENT_TYPE` when the target document's `eventType` is `exception` or `addition`. The response body SHALL include guidance directing the caller to publish the series master instead. The existing rejection of `eventType: 'occurrence'` is preserved.

#### Scenario: Publish targeting an exception document
- **WHEN** an approver calls `PUT /api/admin/events/<exceptionId>/publish` where the document's `eventType` is `exception`
- **THEN** the endpoint returns HTTP 400 with `code: 'INVALID_TARGET_EVENT_TYPE'` and no state change occurs on the exception document or its master

#### Scenario: Publish targeting an addition document
- **WHEN** an approver calls `PUT /api/admin/events/<additionId>/publish` where the document's `eventType` is `addition`
- **THEN** the endpoint returns HTTP 400 with `code: 'INVALID_TARGET_EVENT_TYPE'` and no state change occurs

#### Scenario: Publish targeting a series master still works
- **WHEN** an approver calls `PUT /api/admin/events/<masterId>/publish` where the document's `eventType` is `seriesMaster` and status is `pending`
- **THEN** the endpoint returns HTTP 200, the master is published, and `cascadeStatusUpdate` propagates `published` status to all non-deleted children

### Requirement: List endpoint projection matches Calendar projection

`GET /api/events/list` SHALL project the same event fields as `getUnifiedEvents` (the Calendar read path), so the shared `EventReviewExperience` modal receives identical event shapes regardless of entry point. At minimum the projection SHALL include: top-level `recurrence`, `occurrenceOverrides`, `seriesMasterId`, `statusHistory`, `categories`, `isAllowedConcurrent`, `allowedConcurrentCategories`, and every `graphData.*` subfield that the shared `EVENT_LIST_PROJECTION` constant exposes.

#### Scenario: Approval Queue row for a pending series master includes recurrence
- **WHEN** an approver requests `GET /api/events/list?view=approval-queue&status=pending` and the queue contains a pending seriesMaster whose MongoDB document has a top-level `recurrence: { pattern, range }`
- **THEN** the response event includes `recurrence.pattern` and `recurrence.range` with the same values as the stored document

#### Scenario: My Reservations row for a pending series master includes recurrence
- **WHEN** a requester requests `GET /api/events/list?view=my-events&status=pending` and owns a pending seriesMaster with top-level recurrence
- **THEN** the response event includes the full `recurrence` object

#### Scenario: Projection parity prevents future drift
- **WHEN** a field is added to `EVENT_LIST_PROJECTION` (the shared constant)
- **THEN** every view of `GET /api/events/list` returns that field without any further code change, because both endpoints reference the same projection constant

### Requirement: List endpoint enriches series masters with occurrence overrides from exception documents

`GET /api/events/list` SHALL spread an `occurrenceOverrides` array onto every seriesMaster in the response, synthesized from that series's `exception` / `addition` child documents. The array entries SHALL have the shape `{ occurrenceDate, ...overrideFields }`. The implementation SHALL be shared with the Calendar load endpoint (`POST /api/events/load`) via a single helper so the review modal cannot drift between entry points. Exception docs with an empty nested `overrides` object SHALL fall back to reading denormalized top-level inheritable fields (`startTime`, `endTime`, `locations`, `locationDisplayNames`, `categories`, etc.).

#### Scenario: Pending seriesMaster with one exception child returns populated occurrenceOverrides
- **WHEN** an approver requests `GET /api/events/list?view=approval-queue&status=pending` and a pending seriesMaster has one `exception` child with `overrides: { startTime: '14:00' }`
- **THEN** the response event includes `occurrenceOverrides` of length 1 with `{ occurrenceDate, startTime: '14:00' }`

#### Scenario: My Reservations surfaces the same occurrenceOverrides to the requester
- **WHEN** the requester who owns a pending seriesMaster with an exception child requests `GET /api/events/list?view=my-events&status=pending`
- **THEN** the response event includes the same `occurrenceOverrides` array

#### Scenario: Calendar path produces the same shape after unification
- **WHEN** any caller hits `POST /api/events/load` for a calendar window that includes a seriesMaster with an exception child
- **THEN** the master row in the response includes the same `occurrenceOverrides` shape as the list endpoint, because both paths call the same helper

#### Scenario: Fallback when exception doc has empty nested overrides
- **WHEN** an exception doc has `overrides: {}` but denormalized top-level fields (`startTime`, `endTime`, `locationDisplayNames`)
- **THEN** the enrichment produces an `occurrenceOverrides` entry populated from the top-level fields, not an empty object

### Requirement: Reject endpoint rejects per-occurrence override targets

`PUT /api/admin/events/:id/reject` SHALL return HTTP 400 with error code `INVALID_TARGET_EVENT_TYPE` when the target document's `eventType` is `exception` or `addition`. The endpoint SHALL also reject `eventType: 'occurrence'` with the same code, matching the publish endpoint's symmetry.

#### Scenario: Reject targeting an exception document
- **WHEN** an approver calls `PUT /api/admin/events/<exceptionId>/reject` where the document's `eventType` is `exception`
- **THEN** the endpoint returns HTTP 400 with `code: 'INVALID_TARGET_EVENT_TYPE'` and neither the child nor the master changes status

#### Scenario: Reject targeting an addition document
- **WHEN** an approver calls `PUT /api/admin/events/<additionId>/reject` where the document's `eventType` is `addition`
- **THEN** the endpoint returns HTTP 400 with `code: 'INVALID_TARGET_EVENT_TYPE'`

#### Scenario: Reject targeting a series master still works
- **WHEN** an approver calls `PUT /api/admin/events/<masterId>/reject` with a reason, where the document's `eventType` is `seriesMaster` and status is `pending`
- **THEN** the endpoint returns HTTP 200, the master is rejected, and `cascadeStatusUpdate` propagates `rejected` status to all non-deleted children
