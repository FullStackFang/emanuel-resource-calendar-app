# Sync Health Hardening and Reconcile — Proposal

## Why

The Sync Health report (shipped 2026-07-27) has seven verified defects — including two critical ones: deleted exception/addition children are invisible to the failed-deletion check (the exact `additions` bug class the report was built to catch), and every run reads essentially the whole events collection. And the report is read-only: admins can see 46 never-linked events, stale series, and surviving Outlook entries, but fixing any of them requires ad-hoc scripts. This change hardens the report and adds safe, per-event reconcile actions to the report page.

## What Changes

**Report hardening (7 verified review findings):**

- Fix the deleted-docs query so child docs tracked via `graphEventId` (not `graphData.id`) feed the failed-deletion check (`shouldNotBeInOutlook`).
- Push `calendarOwner` scoping and a field projection into the Mongo queries instead of fetching whole documents and filtering in JS.
- Fix the dead Graph retry predicate (`err.statusCode` vs. the `err.status` that `graphApiService` actually throws) — here and in `backfill-addition-graph-events.js` — and make `graphApiMock` throw production-shaped errors so tests cannot re-hide the bug.
- Scope the retry circuit breaker so Graph throttling cannot open the shared breaker that gates Cosmos retries (fixed together with the predicate, which currently masks it).
- Derive the reconciliation bar's `outlookOnly` segment from the `untracked` findings array instead of `outlookFound − matched` arithmetic, so failed deletions stop being summarized as "not managed by this app".
- Add a loud guard when an app-side date resolves to `null` (protects against the in-progress `calendarData` removal silently blanking dates).
- Remove stale per-run React Query cache entries when a new Run Check starts.

**Reconcile actions (v1 scope of the approved design at `docs/superpowers/specs/2026-07-27-sync-health-reconciliation-design.md`):**

- New admin-only two-phase API: `POST /api/admin/sync-health/reconcile/plan` and `.../apply`, with a stateless `expectedState` fingerprint handshake — apply re-observes reality and refuses (`409 STALE_FINDING`) if anything moved since planning.
- `shouldNotBeInOutlook` → delete the surviving Outlook occurrence/event (server-enforced `confirmIrreversible`, series-master-id guard, attendee warning, pre-delete snapshot in the audit trail).
- `untethered` → three actions: link to an existing matching Outlook event (duplicate guard probes candidates first), archive in app, or publish to Outlook now (single-instance only; requires explicit override when a duplicate candidate exists).
- "Fix…" panel per event row in `SyncHealthReport.jsx`: renders the server plan verbatim, in-button confirmation, scoped refresh after apply.
- Audit trail entry (`templeEvents__EventAuditHistory`, `source: 'SyncHealthReconcile'`) for every apply; `statusHistory[]` push and SSE broadcast for Mongo-writing actions.

**Explicitly out of scope:** series-master republish (v1.5), `missingFromOutlook` actions and bulk category reconcile (v2), untracked-event adoption, and the one-time bulk cleanup of the 46 legacy untethered docs (script-only, blocked on a product decision: archive vs. publish).

## Capabilities

### New Capabilities

- `sync-health-report`: the app-vs-Outlook diff report — data gathering scope and correctness (deleted-child linkage, owner-scoped projected queries), diff semantics, retry/breaker behavior, and summary-bar accuracy. (The report exists in code but has no spec; this spec captures its corrected contract.)
- `sync-health-reconcile`: safe remediation of report findings — the plan/apply handshake, per-category actions and their guards, permissions, audit, and UI flow.

### Modified Capabilities

_None — no existing spec in `openspec/specs/` covers sync health._

## Impact

- **Backend:** `backend/services/syncHealthService.js` (queries, projection), new `backend/services/syncReconcileService.js` + pure `backend/utils/syncReconcilePlan.js`, `backend/utils/retryWithBackoff.js` (breaker scoping), `backend/api-server.js` (two new routes; republish core extracted for reuse), `backend/backfill-addition-graph-events.js` (predicate fix), `backend/__tests__/__helpers__/graphApiMock.js` (production-shaped errors).
- **Frontend:** `src/utils/syncHealthGrouping.js` (bar derivation), `src/components/SyncHealthReport.jsx` (Fix panel), `src/queries/keys.js` usage (stale key cleanup).
- **API surface:** two new admin-only endpoints; no changes to existing endpoint contracts.
- **Data:** no schema changes; writes go through existing OCC (`conditionalUpdate`), `statusHistory[]`, and audit collections. Graph deletes are irreversible — mitigated by fingerprint re-verification, `confirmIrreversible`, and audit snapshots.
- **Tests:** new Jest unit suite for the pure plan module, integration suites for both endpoints (via `createAppForTest`), regression tests for each hardening fix, Vitest coverage for the Fix panel.
