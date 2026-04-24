## Why

Pending recurring events with per-occurrence overrides (`exception` / `addition` documents) currently surface as independent rows in the Approval Queue and in My Reservations, and each such child can be approved or rejected on its own. The architectural invariant is that only the series master is approvable — approving the master cascades status, reviewer, and review notes to every attached child. The current behavior lets approvers act on a child independently, which desynchronizes the master from its children and breaks the cascade contract.

## What Changes

- Exclude `exception` and `addition` documents from the Approval Queue list and badge counts.
- Exclude `exception` and `addition` documents from the My Reservations (`my-events`) list and counts so requesters see a single row per series.
- **BREAKING** (write-side, intentional): `PUT /api/admin/events/:id/publish` and `PUT /api/admin/events/:id/reject` reject requests targeting an `exception` or `addition` document with HTTP 400 and a clear error message directing the caller to the series master.
- Leave the publish/reject cascade (`cascadeStatusUpdate`) untouched — the master-level approval already propagates correctly to children.
- **Share the event-list projection** between `getUnifiedEvents` (Calendar) and `GET /api/events/list` so Calendar, Approval Queue, My Reservations, Admin Browse, and Search all receive identical event shapes. Fixes a drift bug where `/api/events/list` stripped the top-level `recurrence` field (plus `statusHistory`, `categories`, `isAllowedConcurrent`, and several `graphData.*` subfields), causing the recurrence pattern to render empty in the review modal opened from Approval Queue or My Reservations.
- **Share the exception enrichment logic** between `POST /api/events/load` (Calendar) and `GET /api/events/list` (Approval Queue, My Reservations, Admin Browse, Search) via a new `enrichSeriesMastersWithOverrides` helper in `exceptionDocumentService.js`. Fixes a second drift bug where Approval Queue / My Reservations review modals showed "Exceptions (0)" while the Calendar modal showed "Exceptions (1)" for the same series master. Helper includes a fallback that reads top-level denormalized fields when the nested `overrides` object is empty, so legacy-shaped exception docs surface too.

## Capabilities

### New Capabilities
- `pending-queue-scoping`: Defines which event documents are eligible to surface in the Approval Queue and My Reservations list/count endpoints, and which documents are eligible as targets for the publish and reject endpoints. Codifies the "only the master is approvable" invariant at both the read and write layer.

### Modified Capabilities
<!-- None. No existing spec in openspec/specs/ covers approval queue or events-list scoping. -->

## Impact

- **Affected endpoints**:
  - `GET /api/events/list?view=approval-queue` (backend/api-server.js:7003)
  - `GET /api/events/list?view=my-events` (backend/api-server.js:6975)
  - `GET /api/events/list/counts?view=approval-queue` (backend/api-server.js:7358)
  - `GET /api/events/list/counts?view=my-events` (backend/api-server.js:7339)
  - `GET /api/events/list` projection (backend/api-server.js:7206) — shared with `getUnifiedEvents`
  - `PUT /api/admin/events/:id/publish` (backend/api-server.js:18983)
  - `PUT /api/admin/events/:id/reject` (backend/api-server.js:19515)
- **Affected collections**: `templeEvents__Events` (read-only query changes; no schema migration).
- **No frontend changes required**: the UI already renders whatever rows the list endpoint returns. Removing children from the payload automatically removes them from the queue and My Reservations.
- **Tests**: new integration tests covering (a) approval-queue/my-events list + counts excluding exception/addition docs, (b) publish/reject returning 400 when targeting a child, (c) existing master-level cascade behavior still green.
- **No impact** on: calendar rendering (uses a different query path), delta sync, SSE payloads, exception-document CRUD endpoints, or the `cascadeStatusUpdate` behavior.
