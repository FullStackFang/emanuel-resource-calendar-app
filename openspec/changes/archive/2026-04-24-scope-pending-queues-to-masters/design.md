## Context

The app uses an "Exception-as-Document" architecture (completed 2026-04-16): when a user modifies a single occurrence of a recurring series, the override is persisted as a separate `templeEvents__Events` document with `eventType: 'exception'` (override on a scheduled occurrence) or `eventType: 'addition'` (ad-hoc occurrence outside the recurrence pattern). An addition inherits its master's status and `roomReservationData` at creation time (`backend/utils/exceptionDocumentService.js:_insertOccurrenceDocument`, lines 159-196), producing denormalized snapshots that index well and survive master deletion with a cascade.

That denormalization is load-bearing for the calendar rendering and cascade flows, but it also means any Mongo query that filters on `status`, `isDeleted`, and `roomReservationData` alone — without scoping by `eventType` — will return children alongside the master. Two such queries exist today:

- `GET /api/events/list?view=approval-queue` and its counts endpoint (backend/api-server.js:7003, 7358).
- `GET /api/events/list?view=my-events` and its counts endpoint (backend/api-server.js:6975, 7339).

When a pending series master has any child override, the approval queue shows N+1 rows (master + children), the badge counts are inflated, and an approver can approve a child from the UI. The publish and reject endpoints have no guard against that: `publish` only blocks `eventType === 'occurrence'` (line 19020), and `reject` has no eventType guard at all. The cascade (`cascadeStatusUpdate` at publish/reject sites) only fires when the *master* is the target, so approving a child flips just that child's status and leaves the master stuck in `pending`.

Write-side cascades (publish at line 19301, reject at line 19613) are already correct when the target is a `seriesMaster`. The invariant we need to codify is "the master is the unit of approval, and children are not independent queue items."

## Goals / Non-Goals

**Goals:**
- Remove `exception` and `addition` documents from the Approval Queue list and counts so approvers see one row per pending series.
- Remove them from the My Reservations list and counts so requesters see one row per pending series.
- Reject publish/reject API calls that target a child document, with a clear 400 error directing callers to the series master.
- Preserve the existing cascade contract unchanged: approving the master still propagates status + `reviewedBy` + `reviewNotes` to every non-deleted child.

**Non-Goals:**
- Changing how children are stored or denormalized (no schema changes, no migration).
- Changing how children render on the Calendar view. The calendar uses a different code path (recurring expansion + exception merging), not `GET /api/events/list`, and must continue to display occurrence-level overrides.
- Unifying the `my-events` status $or collision with a deleted filter (separate pre-existing concern).
- Changing the `occurrence` eventType guard semantics — kept as-is and extended, not replaced.

## Decisions

### 1. Exclude children via a negative `eventType` filter rather than a positive whitelist

**Decision:** Add `eventType: { $nin: ['exception', 'addition'] }` to the approval-queue and my-events list/count queries.

**Alternatives considered:**
- **Positive whitelist**: `eventType: { $in: ['seriesMaster', 'singleInstance', null] }`. Rejected because existing events predate the eventType field and may have `eventType` absent; matching on `null` is fragile in MongoDB (`null` matches both missing and explicit-null fields, but behavior interacts with indexes in surprising ways). The negative filter is explicit about what we're excluding and requires no assumptions about legacy documents.
- **Strip children in application code after fetch**: Rejected — breaks pagination (page size would be inconsistent), inflates the `approval-queue` 1000-doc cap, and offers no benefit over filtering at the query layer.

### 2. Return 400 (not 403) when publish/reject targets a child

**Decision:** Use HTTP 400 with an error message like `"Cannot publish an exception or addition document independently. Publish the series master at /api/admin/events/<masterId>/publish."` and include a `code: 'INVALID_TARGET_EVENT_TYPE'` field so the frontend can branch without parsing text.

**Rationale:** 403 implies an authorization failure; this is an input-shape error. 400 with a machine-readable code mirrors the existing occurrence guard's pattern at line 19020. It also leaves the existing 403 (`Approver access required`) unambiguous for role-based rejection.

### 3. Keep the cascade unchanged

**Decision:** Do not modify `cascadeStatusUpdate`, the publish cascade call at line 19301, or the reject cascade call at line 19613. The cascade already does the right thing when the master is the target.

**Rationale:** The write-side invariant is already enforced via the cascade; the bug is that the read side leaks children as independent targets. Fixing the read side plus the input guard is sufficient.

### 4. Co-locate the input guard with the existing `occurrence` guard

**Decision:** Extend the existing check at line 19020 (publish) to `['occurrence', 'exception', 'addition'].includes(event.eventType)` and add a symmetric check to the reject endpoint immediately after the status check at line 19548.

**Rationale:** Keeps the guard near the other input-validation checks, single place to audit, and the error shape is already established by the occurrence guard.

## Risks / Trade-offs

- **Risk:** A client that cached the child's `_id` and tries to publish it will now see a 400 where previously it got a 200 (with a broken state).
  **Mitigation:** The frontend currently never targets a child for publish/reject because child docs don't surface as distinct review modals (confirmed via `EventReviewExperience` entry points). The fix is a strict improvement over the current broken behavior; no rollout coordination needed.

- **Risk:** The `$nin` filter could interact with existing Cosmos DB indexes and degrade query performance.
  **Mitigation:** The approval-queue and my-events queries already filter on `status`, `isDeleted`, and `roomReservationData.requestedBy.email` — all of which are existing index targets. `eventType` is a low-cardinality field and `$nin` on a small enum is cheap at the RU level. Verify with an `explain()` run against the Cosmos instance if we see a regression, but not expected.

- **Trade-off:** The negative filter adds a dependency on the eventType enum staying small. If a future eventType is added (e.g., `hold`), the list views will include it by default. Documenting this in the spec (scenario: unknown eventType is included) keeps the intent explicit.

- **Trade-off:** Approvers lose the ability to "see" child docs via the queue. This is by design — children are only visible through the master's recurrence view — but it's worth calling out so support/triage knows where to look when debugging a stuck child.

## Migration Plan

No data migration required. The change is purely query-scoping + input validation.

**Deployment:**
1. Deploy backend with the new filters and guards.
2. Invalidate the server-side `countsCache` (existing mechanism at line 5653) to avoid stale inflated counts in the first 60 seconds.
3. No frontend deploy needed — the UI already renders whatever the list returns.

**Rollback:** Revert the PR. No state to unwind. Children re-appear in the queue; the write-side guards come back off.

## Open Questions

- Do we want to surface a "this series has N per-occurrence overrides" badge on the master row in the Approval Queue, so approvers know children exist before they approve? **Deferred** — out of scope for this fix. Track separately if approvers request it.
