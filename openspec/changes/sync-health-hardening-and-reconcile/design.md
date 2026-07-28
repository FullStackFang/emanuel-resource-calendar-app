# Sync Health Hardening and Reconcile — Design

## Context

The Sync Health report compares the app's expected published instances against Outlook's
`calendarView` per mailbox and buckets discrepancies into four finding types
(`untethered`, `missingFromOutlook`, `shouldNotBeInOutlook`, `untracked`). An external
review verified seven defects in the shipped report (see proposal), and the approved
reconciliation architecture lives at
`docs/superpowers/specs/2026-07-27-sync-health-reconciliation-design.md`. This change
implements the fixes plus reconciliation v1.

Key existing machinery reused rather than rebuilt:

- `POST /api/admin/events/:id/republish` (api-server.js ~22385) — targeted republish with
  OCC, existing-link acknowledgement, statusHistory, SSE.
- `graphRequest` in `graphApiService.js` — already retries 429/503 internally with
  Retry-After support (this is why the broken outer retry predicate went unnoticed).
- `exceptionDocumentService.js` — children carry `graphEventId` with `graphData: null`
  (the shape the deleted-docs query currently misses).
- `recover-untethered-publishes.js --clean-orphans` — orphan backstop for interrupted
  publishes; reconcile keeps feeding `createdGraphEventIds` so it stays effective.

## Goals / Non-Goals

**Goals:**

- The failed-deletion check detects deleted exception/addition children still on Outlook.
- Report queries are owner-scoped and projected at the database, not filtered in JS.
- Graph retries actually fire; Graph throttling cannot open the Cosmos circuit breaker;
  `graphApiMock` cannot re-hide either bug.
- The summary bar cannot disagree with the finding sections it summarizes.
- Admins can fix `shouldNotBeInOutlook` and `untethered` findings from the report page via
  a plan → apply handshake that refuses to act on stale findings, never creates
  duplicates silently, and audits every write.

**Non-Goals:**

- Series-master republish (v1.5 — needs exclusion/child sync extraction first).
- `missingFromOutlook` actions, bulk per-category reconcile (v2).
- Adoption of untracked Outlook events into the app (an import feature).
- Bulk cleanup of the 46 legacy untethered docs (one-time script, pending the
  archive-vs-publish product decision).
- Field-level drift comparison (title/time on matched pairs).

## Decisions

### D1 — Deleted-docs query matches both linkage shapes

`syncHealthService.js` deleted-docs filter becomes
`$or: [{ 'graphData.id': {...} }, { graphEventId: { $exists: true, $ne: null } }]`.
Alternative (normalizing children to carry `graphData.id`) rejected: it would touch the
exception-document architecture for a one-line query fix.

### D2 — Owner scoping and projection at the database

Both `.find()` calls take the `calendarOwner` filter (when scoped) and a projection of
only the fields `buildAppSide` / `localDateOf` / `buildSeriesAwareDateRangeClause` read.
Case-insensitivity: match with `$in` over the distinct stored casings discovered via a
cheap `distinct('calendarOwner')` (rejected: `$regex` with `i` — collation/regex support
on Cosmos is unreliable, and `distinct` is a single indexed round-trip). Unscoped runs
still fetch all owners but with the projection applied.

### D3 — Fix the retry predicate AND drop the outer Graph retry breaker coupling together

Predicate reads `err.status ?? err.statusCode` (fixed in `syncHealthService.js` and
`backfill-addition-graph-events.js`). Because `graphRequest` already retries transient
statuses internally, the outer `retryWithBackoff` adds value only for network errors —
but its breaker is a process-wide singleton shared with Cosmos callers. Decision:
`retryWithBackoff` accepts an injectable breaker (`options.breaker`), defaulting to the
existing singleton; Graph callers pass a dedicated Graph breaker instance. Alternative
(remove the outer wrapper for Graph entirely) rejected: ETIMEDOUT/ECONNRESET on the
fetch itself is not retried by `graphRequest`, and the wrapper covers it. Network-error
shape must be verified against undici (`err.cause?.code`) and the predicate written to
match reality, with `graphApiMock` throwing that exact shape.

### D4 — Production-shaped mock errors via a shared builder

`graphApiService` gains an exported `buildGraphError(status, message, graphError)` used
at its own throw site; `graphApiMock` imports the same builder. A mock that constructs
its own error object is how finding #3 stayed hidden — sharing the constructor makes
mock/reality drift structurally impossible.

### D5 — Summary bar derives from finding arrays, not count arithmetic

`syncHealthGrouping.js` computes `outlookOnly = untracked.length` (instances) and keeps
`appOnly`/`matched` from counts. Entries consumed by the deleted-doc and exclusion passes
are real problems listed in `shouldNotBeInOutlook`; they must not be summarized as
"not managed by this app". Deriving from the same arrays the sections render removes the
possibility of disagreement.

### D6 — Two-phase plan/apply with a stateless fingerprint handshake

Two generic admin-only routes (`/plan`, `/apply`) rather than per-action endpoints
(which would multiply fingerprint/stale/audit boilerplate by eight). `plan` re-observes
Mongo + a narrow Graph probe and returns ordered ops + an `expectedState` fingerprint;
`apply` re-observes again, deep-compares, and returns `409 STALE_FINDING` before any
write if reality moved. No server-side plan storage: stateless, restart-safe,
multi-admin-safe; soft `expiresAt` (10 min) forces a re-plan. Fingerprints include the
app-side JUSTIFICATION for destructive ops (exclusion still recorded / doc still
deleted), not merely the Outlook item's existence.

### D7 — Guards on the irreversible path (Outlook deletes)

Server requires `confirmIrreversible: true` for any plan containing a Graph delete (the
UI confirm is enforced, not decorative). Apply `getEvent()`s the target and aborts if
`type === 'seriesMaster'` (deleting a master destroys the whole series). Plan surfaces
`attendees.length > 0` as a warning (deletes send cancellations). The full pre-delete
`getEvent` snapshot goes into the audit metadata — the only undo reference that will
ever exist. Delete of an already-gone event (404) reports `alreadyGone` success
(idempotent re-run).

### D8 — Duplicate guard before untethered publish

Plan probes the mailbox calendarView on the event's date for untracked entries whose
subject matches the normalized `buildGraphSubject(...)` output (subject+date; start-time
matching deferred — looser matching finds the real legacy duplicates, and the admin
picks from listed candidates rather than auto-linking). If candidates exist the
recommended action flips to link-to-existing; create requires `allowDuplicate: true`
or the API returns `422 DUPLICATE_CANDIDATE`.

### D9 — Logic placement mirrors the report's proven layering

Pure decision module `backend/utils/syncReconcilePlan.js` (`buildPlan`, `fingerprintOf`,
`verifyExpectedState` — no I/O, fully unit-testable, sibling of `syncHealthDiff.js`).
Orchestration in `backend/services/syncReconcileService.js` with injected
`{eventsCollection, graphApi, auditService}` (same injection pattern that makes
`graphApiMock` work). The single-instance publish path reuses the extracted republish
core from the existing endpoint — extract, don't fork. Routes in `api-server.js` stay
thin.

### D10 — Archive action maps to the existing soft-delete flow

"Archive in app" uses the existing `isDeleted`/restore machinery with a distinct
`statusHistory` reason (`'Archived via sync-health reconcile'`) rather than a new
`archived` status — a new status would ripple through every status filter in the app for
no v1 benefit. Revisit if the legacy-bulk decision lands on archive.

### D11 — Null-date guard, not a calendarData migration

`localDateOf` logs at error level (with mongoId) and the instance is surfaced in the
calendar's `error` field when a date resolves `null`. Migrating off `calendarData` here
is rejected: that refactor is in progress elsewhere; this change just makes the failure
loud instead of silent, and these call sites go on that refactor's checklist.

### D12 — Stale query-key cleanup on new run

`SyncHealthReport.jsx` calls `queryClient.removeQueries({ queryKey: keys.syncHealth.all(),
predicate: <not the new key> })` when Run Check mints a new version. Keeps the deliberate
"new key per run forces refetch" behavior while capping growth at one retained result.

## Risks / Trade-offs

- [Graph deletes are irreversible] → strongest fingerprint + justification re-check,
  server-enforced `confirmIrreversible`, series-master guard, attendee warning,
  pre-delete snapshot in audit.
- [Crash between Graph create and Mongo link persist] → publish-order parity
  (Mongo state → Graph create → link persist → compensating delete on failure), ids
  recorded in `createdGraphEventIds`, idempotent re-apply, recovery script backstop. No
  multi-doc transactions on Cosmos; residual risk accepted.
- [Fixing D1 grows the shouldNotBeInOutlook bucket] → intended (previously invisible
  real problems), but ship the D5 bar fix in the same release so the summary stays
  truthful as counts move.
- [D2 projection misses a field some helper reads] → integration test runs the full
  report against seeded fixtures and asserts finding parity with an unprojected run.
- [Duplicate probe (subject+date) links the wrong same-named event on a busy day] →
  admin explicitly picks from listed candidates; no auto-link.
- [Owner `$in` casing set drifts] → casings come from `distinct()` at request time, not
  a hardcoded list.

## Migration Plan

No data migration. Deploy backend + frontend together (the bar fix and reconcile UI read
new response fields). Rollback = redeploy previous build; new endpoints are additive and
unused by any other caller. The `retryWithBackoff` breaker change is
backward-compatible (defaults to the existing singleton).

## Open Questions

- Legacy 46 untethered docs: archive vs. publish (product call; script-only, out of this
  change's scope but D10's status choice should be revisited when decided).
- Attendee-bearing Outlook deletes: warning only (current design) vs. hard-block in UI.
