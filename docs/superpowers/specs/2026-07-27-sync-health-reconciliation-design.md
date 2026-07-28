# Sync Health Reconciliation — Design

**Status:** Proposal (architect-reviewed, awaiting user decisions in §9)
**Date:** 2026-07-27
**Builds on:** `2026-07-27-sync-health-report-design.md` (v1 deferred remediation; this is that deferred work)

## Key discovery

The codebase already contains most of the repair mechanics; this design wraps them in a
safe workflow rather than building new sync code:

- `POST /api/admin/events/:id/republish` (api-server.js ~22385) — targeted republish with
  OCC, existing-link acknowledgement, statusHistory, SSE.
- `recover-untethered-publishes.js` and `backfill-addition-graph-events.js` — script
  precedents (incl. `--clean-orphans` orphan backstop).
- `syncRecurrenceExclusionsToGraph` (api-server.js ~2253) — exactly the mechanism for
  excluded-date findings.

## 1. Recommended shape: hybrid, biased toward the report page

**Per-finding-group actions live on the Sync Health report page** (admin-only), each backed
by a server-side **plan → apply** handshake. **Bulk legacy cleanup stays script-only** (the
46 untethered "Hold"/"Do not book" docs are a one-time data decision, not a recurring
workflow). Rationale: the report already groups findings into the correct unit of action
(one event/series = one fix); scripts require env access and leave no UI-visible audit
trail; but bulk UI actions on day one would put a "delete 46 things" button next to real
production data before the process has earned trust.

## 2. Per-category remediation action matrix

| Finding | Action | Writes to | Blast radius | Reversible? | Phase |
|---|---|---|---|---|---|
| **untethered** | **A. Publish to Outlook now** — create Graph event (series if master), persist `graphData.{id,iCalUId}` | Graph create + Mongo | 1 Outlook event, or whole series + N exclusion deletes + M child-doc events for masters | Yes (delete created event; ids recorded in `createdGraphEventIds`) | v1 single-instance; v1.5 seriesMaster |
| | **B. Link to existing Outlook event** — adopt a probed same-title/same-date *untracked* candidate; set `graphData.id` only | Mongo only | 1 doc | Yes (unset link) | v1 |
| | **C. Archive in app** — status change off `published` (soft-archive), statusHistory push | Mongo only | 1 doc (+cascade for masters) | Yes (restore flow exists) | v1 |
| **missingFromOutlook** (whole series stale: all dates missing AND `getEvent(storedGraphId)` 404s) | **A. Recreate in Outlook + relink** — force republish: fresh series, exclusions synced, child docs re-synced, relink | Graph create + Mongo | Whole series in Outlook | Yes-ish (delete new series; old link was already dead) | v2 |
| | **B. Accept Outlook, unpublish/archive in app** | Mongo only | 1 doc + children | Yes | v2 |
| **missingFromOutlook** (partial: series alive, some dates gone — someone deleted occurrences in Outlook) | **Accept Outlook: record exclusion in app** — add date to `recurrence.exclusions[]` | Mongo only | 1 date | Yes (restore-occurrence flow exists) | v2 |
| | *Restore occurrence in Outlook: NOT offered* — Graph occurrence cancellations are sticky; infeasible | — | — | — | never |
| **missingFromOutlook** (child addition/exception doc unlinked/dead) | **Recreate standalone event** — `buildGraphEventDataFromRecord(child)` → create → persist `graphEventId` (backfill-addition precedent) | Graph create + Mongo | 1 event | Yes | v2 (script exists today) |
| **shouldNotBeInOutlook** | **Delete the Outlook occurrence/event** — `deleteCalendarEvent(owner, null, graphId)` per instance | Graph only (+audit) | 1 occurrence/event per instance | **NO — Graph deletes are final** | **v1 (ship first)** |
| **untracked** | **None.** "Adopt into app" is out of scope (an import feature, not reconciliation). Optional later: "acknowledge/hide" list. | — | — | — | deferred |

Guard baked into the delete action: the diff only ever emits calendarView instance ids for
`shouldNotBeInOutlook`, but apply must still `getEvent()` and **abort if
`type === 'seriesMaster'`** — deleting a master id would destroy an entire series.

## 3. Safety mechanisms (the heart)

### 3.1 Two-phase plan/apply, stateless handshake
- **`plan`** re-observes reality *fresh* (never trusts the report the admin is looking at):
  refetches the Mongo doc(s), probes Graph narrowly (single `getEvent`, or a 1-day
  `calendarView` slice). Returns an ordered op list in human-readable + machine form, plus
  an **`expectedState` fingerprint** — the exact observations the plan depends on.
- **`apply`** takes `expectedState` back verbatim, **re-observes a second time,
  deep-compares, and 409s (`STALE_FINDING`) with the fresh observation if anything
  moved** — before any write. No server-side plan storage: stateless, restart-safe, works
  with multiple admins. Soft `expiresAt` (10 min) forces a re-plan.

Fingerprint contents per category:
- *untethered:* `{ mongoId, _version, status: 'published', graphDataId: null, eventType, title }`
  — apply aborts if someone published/linked/edited it meanwhile.
- *missingFromOutlook:* `{ mongoId, _version, storedGraphId, missingDates[], masterProbe: 'notFound' }`.
- *shouldNotBeInOutlook:* `{ graphId, subject, dateKey, graphType, seriesMasterId }` **plus
  the app-side justification**: `{ masterMongoId, _version, exclusionDatePresent: true }` or
  `{ deletedDocMongoId, isDeleted: true }`. The shipped finding carries only
  `{graphId, subject, date, reason}` — apply must re-derive *why* deletion is justified
  (exclusion still recorded / doc still deleted), not merely that the Outlook item exists.
  If an admin un-deleted the doc between report and click, apply aborts.

### 3.2 Duplicate-creation guard (untethered publish)
Before proposing "Publish to Outlook", plan probes the mailbox's calendarView on the
event's date(s) for **untracked** entries whose subject matches `buildGraphSubject(...)`
output (normalized; the `[Hold]` prefix rule matters for exactly the legacy population in
question). If candidates exist, the plan's *recommended* action flips to **Link to
existing** with the candidates listed; a create is then only allowed with an explicit
`allowDuplicate: true` override, and the API returns `422 DUPLICATE_CANDIDATE` without it.
This is the specific guard against re-pushing "Hold Streicker" onto a calendar that
already shows it.

### 3.3 Idempotency
Every apply is a safe re-run: Graph delete returning 404 → success (`alreadyGone`);
republish when `graphData.id` is now set → `EXISTING_GRAPH_LINK` (existing endpoint
behavior); exclusion-add when the date is already excluded → no-op success;
link-to-existing when already linked to that id → no-op.

### 3.4 Write ordering + compensation
Follow the publish endpoint's proven order: **OCC-guarded Mongo state change first where
applicable, Graph create second, Mongo link persist third, compensating Graph delete on
link failure** (pattern at api-server.js ~21944–22150, incl. the full-object `graphData`
`$set` that defends against the null-parent dotted-path Cosmos defect). All Mongo writes
via `conditionalUpdate()` with `expectedVersion` + `expectedStatus`; created Graph ids
always pushed to `roomReservationData.createdGraphEventIds` so
`recover-untethered-publishes.js --clean-orphans` remains the backstop.

### 3.5 Audit trail
Every apply writes one `auditService.recordEvent()` entry
(`templeEvents__EventAuditHistory`) with `source: 'SyncHealthReconcile'`,
`changeType: action`, and metadata `{ findingType, calendarOwner, graphIdsCreated/Deleted,
expectedStateHash, actorEmail }`. Status-changing actions also push `statusHistory[]`
(existing `buildStatusHistoryEntry`). Graph deletes — the irreversible ones — additionally
log the full pre-delete `getEvent` snapshot into the audit metadata, which is the only
"undo reference" that will ever exist for them.

### 3.6 Scope, rate limits, rollback
- **v1 scope: one finding-group (one event/series) per request.** A series fix may fan out
  to N sequential Graph ops — run them with `withGraphRetry` (same predicate as
  syncHealthService) and report per-op results; no parallel Graph writes. Bulk per-category
  is v2 and inherits the backfill scripts' batch-25 / 1s-delay discipline.
- **Rollback:** Mongo-only actions reverse via existing restore flows; Graph creates
  reverse via delete of recorded ids; Graph deletes do not reverse — hence they get the
  strongest fingerprint, the type-check, an attendee check (plan surfaces
  `attendees.length > 0` as a warning: deleting sends cancellations), and per-instance
  granularity.
- **Permissions:** report stays admin+approver; **all reconcile endpoints are admin-only**
  (matches the republish endpoint's gate).

## 4. API design

Two thin routes, generic across categories (per-action endpoints would multiply the
fingerprint/stale/audit boilerplate by eight):

```
POST /api/admin/sync-health/reconcile/plan
  { calendarOwner, findingType, action, target: { mongoId?, graphId?, dates? }, window }
  → 200 { action, ops: [{op, description, direction, irreversible}], expectedState,
          recommendation?, candidates?, warnings[], expiresAt }

POST /api/admin/sync-health/reconcile/apply
  { calendarOwner, findingType, action, target, expectedState, allowDuplicate?, confirmIrreversible? }
  → 200 { results: [{op, status: 'done'|'alreadyDone'|'failed', graphId?}], refreshedFinding }
  → 409 STALE_FINDING { observed }   // reality changed since plan
  → 409 VERSION_CONFLICT             // OCC loss mid-apply (orphan id reported, publish-endpoint style)
  → 422 DUPLICATE_CANDIDATE { candidates }
```

`confirmIrreversible: true` is required for any plan containing a Graph delete — the
server refuses without it, so the UI confirm step is enforced, not decorative.

## 5. Where logic lives

- **`backend/utils/syncReconcilePlan.js` (new, pure — sibling of syncHealthDiff.js):**
  `buildPlan(findingType, action, observation)` → ops or `{abort, reason}`;
  `fingerprintOf(observation)`; `verifyExpectedState(expected, observed)` → list of drifts.
  No I/O; every decision rule (duplicate-candidate matching, master-type guard,
  justification re-derivation) is unit-tested here.
- **`backend/services/syncReconcileService.js` (new, injected deps like syncHealthService):**
  `observe()`, `planReconcile()`, `applyReconcile()` taking
  `{eventsCollection, graphApi, auditService}` — the same injection pattern that lets the
  test harness's graphApiMock work.
- **Reuse, don't fork:** untethered/stale republish delegates to the existing republish
  core — extract the body of `POST /api/admin/events/:id/republish` into the service so
  both routes share it. Excluded-date deletes reuse the targeted-delete mechanics of
  `syncRecurrenceExclusionsToGraph`; recurring-master republish needs
  `syncRecurrenceExclusionsToGraph` + `syncExceptionDocumentsToGraph` +
  `materializeAdditionDocuments` post-create — the first two live inline in api-server.js
  today, so v1.5 includes extracting them into `backend/utils/graphSeriesSync.js`
  (mechanical move, no behavior change).
- Routes in api-server.js stay thin: auth gate, arg validation, delegate, map service
  errors to status codes.

## 6. UI flow

- In `SyncHealthReport.jsx`, each `EventRow` in a critical section gains a **"Fix…"**
  affordance (rendered only for admins, only for categories with shipped actions). Click
  expands an inline panel listing the available actions with their direction ("creates 1
  Outlook event", "changes only this app's record", "permanently deletes 3 Outlook
  entries").
- Choosing an action calls `/plan` and renders the returned op descriptions + warnings
  verbatim (the server's words, not client-side prose — one source of truth for what will
  happen). Duplicate candidates render as a pick-list under "An Outlook event that matches
  already exists — link to it instead?".
- Apply uses the existing **in-button confirmation pattern** (first click →
  "Confirm — cannot be undone" for irreversible plans), then `showSuccess`/`showError`
  toasts. No browser dialogs.
- Post-action: invalidate the sync-health react-query key **scoped to that calendarOwner**
  and re-run the check for that mailbox only; `STALE_FINDING` errors toast "This finding
  changed since the report ran — refreshing" and trigger the same refresh. SSE broadcasts
  from Mongo-writing actions keep other admins' views honest.

## 7. Phasing

- **v1 (small, genuinely safe):** (1) `shouldNotBeInOutlook` per-event delete — smallest
  and most mechanical (4 live instances today), full fingerprint + justification re-check +
  type guard + confirmIrreversible; (2) untethered **Mongo-only** actions: link-to-existing
  and archive-in-app; (3) untethered **single-instance** publish via the extracted
  republish core + duplicate guard. Plan/apply plumbing, pure module, audit, and UI panel
  all land here.
- **v1.5:** untethered **seriesMaster** publish (requires the graphSeriesSync extraction so
  exclusions/children sync on create — the current republish endpoint doesn't do this,
  which would otherwise immediately manufacture new `shouldNotBeInOutlook` findings).
- **v2:** `missingFromOutlook` stale-series recreate + accept-Outlook actions (incl.
  exclusion-add for partial gaps); bulk "reconcile all in category" with a server-planned
  review table and batch-25/1s pacing.
- **Script-only, indefinitely:** mass archive/publish of the 46-item legacy backlog (run
  once after the user decides §9 Q1 — possibly via a temporary bulk mode of
  `recover-untethered-publishes.js`); `backfill-addition-graph-events.js` remains the
  child-doc backstop; `--clean-orphans` remains the orphan backstop.

## 8. Testing plan

**Unit (Jest, pure — `syncReconcilePlan.test.js`):** plan construction per
category/action; fingerprint round-trip; `verifyExpectedState` catching each drift class
(_version bump, graphData appeared, exclusion removed, doc un-deleted, Outlook item type
changed to seriesMaster, subject changed); duplicate-candidate matcher incl. `[Hold]`
prefix normalization; abort when justification can't be re-derived.

**Integration (Jest via `createAppForTest` + graphApiMock — NOT testApp.js):**
- *Stale-abort:* plan → mutate doc (`_version` bump / set `graphData.id` / un-delete) or
  mutate mock calendarView → apply → assert 409 `STALE_FINDING` and **zero** graph-mock
  write calls.
- *Duplicate guard:* seed an untracked same-subject/same-date mock event → plan recommends
  link; apply-create without `allowDuplicate` → 422; link path writes only Mongo.
- *Irreversible gate:* delete plan without `confirmIrreversible` → 400; with it → mock
  `deleteCalendarEvent` called with the fingerprinted id; second apply (mock returns 404)
  → `alreadyDone`.
- *Master-id guard:* mock `getEvent` returns `type: 'seriesMaster'` → apply aborts.
- *OCC mid-apply:* concurrent `_version` bump after Graph create → 409 `VERSION_CONFLICT`
  + compensating delete invoked (publish-endpoint parity).
- *Audit + statusHistory:* entry in `templeEvents__EventAuditHistory` with expected
  metadata; statusHistory push on archive; SSE broadcast asserted.
- *Non-admin:* approver token → 403 on both routes.

**Frontend (Vitest):** Fix button gated by role and by category; plan panel renders server
descriptions/warnings/candidates; in-button confirm sequence; `STALE_FINDING` triggers
scoped query invalidation.

## 9. Risks & open questions (user decisions)

1. **The 46 legacy untethered docs:** push to Outlook, or bulk-archive?
   Recommendation: **archive** — republishing would flood the shared calendar with
   years-old "Hold"/"Do not book" entries and trigger the duplicate guard constantly.
   Needs a call on which status "archive" maps to (existing soft-delete/`isDeleted`
   restore flow vs. a new `archived` status).
2. **Outlook deletes may send cancellations** if the out-of-band event has attendees
   (app-created events don't; hand-recreated ones might). Plan surfaces attendee count as
   a warning — is that sufficient, or should attendees hard-block the UI delete
   (script-only)?
3. **Duplicate probe matching strength:** subject+date only (proposed) vs.
   subject+date+start-time. Looser finds more real duplicates but risks linking to the
   wrong same-named event on a busy day.
4. **"NS Pick Up" specifically:** the stale-series recreate (v2) will re-create from *app*
   state; if someone also fixed data in the recreated Outlook series out-of-band, that
   data loses. (App is source of truth per CLAUDE.md — assumed acceptable.)
5. **Untracked adoption** stays out of scope — confirm.
6. Cosmos has no multi-doc transactions here — a crash between Graph create and Mongo link
   is still possible; the design's answer is `createdGraphEventIds` + idempotent re-apply
   + the recovery script, not atomicity. Acceptable residual risk?

## Critical files for implementation

- `backend/api-server.js` — publish ~21675, republish ~22385,
  `syncRecurrenceExclusionsToGraph` ~2253, sync-health route ~12244 (extraction sources +
  new routes)
- `backend/services/syncHealthService.js` — injection pattern, targeted re-observation reuse
- `backend/utils/syncHealthDiff.js` — fingerprint/date-key primitives; model for the new
  pure `syncReconcilePlan.js`
- `backend/utils/graphEventBuilder.js` — shared payload construction for all create paths
- `src/components/SyncHealthReport.jsx` — Fix panel, plan preview, confirm + refresh flow
