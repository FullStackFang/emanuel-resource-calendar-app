## Context

Three write paths can change a published event's recurrence, and only one of them tells Outlook everything:

| Path | Master PATCH | New additions | New exclusions | Removed exclusions |
|---|---|---|---|---|
| `PUT /api/admin/events/:id` (Save) | yes, PRE-write (~27541) | materialize + sync, post-write (~28152) | **no** | restore block (~27163) |
| `PUT /api/edit-requests/:id/approve` | **no** | **no** | **no** | blocked at submit; **approverChanges bypass the guard** |
| `DELETE /api/admin/events/:id` thisEvent | n/a | n/a | cancels instance | n/a |

Publish and the restore endpoints call `syncRecurrenceExclusionsToGraph` once, right after creating the Graph series, so exclusions present *at publish time* are honoured. Nothing honours an exclusion added *after* publish except the single-occurrence Delete route, which is a different UI gesture from editing the Recurrence tab.

The approval handler's doc comment records the intent ("Graph sync: deferred to Phase 1c follow-up (legacy endpoint still handles)"). The legacy `publish-edit` endpoint no longer exists; `src/services/editRequestsApi.js` documents its removal. The sync was never ported.

**Save's Graph block is pre-write.** The PATCH at ~27541 runs before `conditionalUpdate` at ~28090; the PATCH response is merged into the same write (`updateOperations.graphData = {...event.graphData, ...graphSyncResult}`, ~27919), and `graphSynced` is returned at ~28244. A 409 on the Mongo write can therefore leave Graph already patched. That is a pre-existing latent bug; this change does not reorder Save, but documents it (D1).

**Approval's `finalChanges` is a delta, not a form.** `POST /api/edit-requests` (~25025-25101) builds `proposedChanges` as changed-fields-only. Save receives the whole processed form. A payload builder fed the delta alone would skip recurrence alignment when only time-of-day changed (→ `ErrorOccurrenceTimeSpanTooBig`), drop room changes silently (locations come from a DB lookup at ~26854 that produces `processedLocationsArray`, not from `updates`), build partial offsite strings, and mis-detect `[Hold]` subjects. The builder must therefore take the **effective post-write state** plus a set of changed field names (D1).

The approval handler's occurrence-scoped branch writes `occurrenceOverrides[]` on the master. That array is a dead shape: the renderer reads exception/addition child documents (`enrichSeriesMastersWithOverrides`), and 0 production masters carried a non-empty array on 2026-07-27. Approvals since then have been writing to it, so the count must be re-measured before deploy (N4). An approved single-occurrence edit request currently disappears from both the app and Outlook.

Save's cascade to children (~27559 `exceptionEventIds`, ~27609 `occurrenceOverrides`) also reads dead shapes. Real children are exception/addition documents with `graphEventId`.

The sync health report (`services/syncHealthService.js`, `utils/syncHealthDiff.js` ~289) already classifies an excluded date still present in Outlook as `shouldNotBeInOutlook` and would have flagged the live incident any day since April. It runs only when an admin opens the page.

Functions the sync needs (`syncExceptionDocumentsToGraph` ~2451, `syncRecurrenceExclusionsToGraph` ~2299, `buildOffsiteGraphLocation` ~2196, `buildGraphSubject` ~243, the `findGraphOccurrenceForDate` wrapper ~2258) are private to `api-server.js`. A `services/` module cannot `require` them without a cycle; `republishCore` and `syncHealthService` solve this with injected deps.

Constraints inherited from the 2026-07-27 recurrence fixes (memory `recurrence-graph-sync-gaps`): one child document per date; select added dates by `occurrenceDate` not `eventType`; never compare a bare `YYYY-MM-DD` against a parsed date-time; ask Graph for instance times in the event's zone (`findGraphOccurrenceForDate`); await per-occurrence Graph sync because it persists `graphEventId`; `locationDisplayNames` is sometimes an array and sometimes a `'; '` string.

## Goals / Non-Goals

**Goals:**
- An approved edit request on a published event produces the same Outlook state an admin Save of the same changes would.
- A newly added exclusion on a published series cancels its Graph instance from every path that can add one, and a date with a child document is cancelled by soft-deleting the child and deleting its standalone Graph event.
- Occurrence-scoped approvals produce an exception child document and a patched Graph instance, with the master's OCC contract, response `eventVersion`, and SSE payload intact.
- One shared payload builder and one shared post-write recurrence reconciler, so Save and approval cannot drift again.
- Historical exclusion drift is repaired by a script; the sync health check runs on a clock with a lease.

**Non-Goals:**
- Making Graph sync transactional with the Mongo write. Save is already best-effort/non-fatal; approval follows the same rule.
- Reordering Save's pre-write PATCH. Documented as a latent bug; its own change.
- Changing conflict-detection policy, OCC, email, or audit semantics beyond what D3 names.
- Un-cancelling a Graph instance when an exclusion is removed (Plan 3; `restoreGraphOccurrence` comment). Approval gains the same `EXCLUSION_REMOVAL_NOT_SUPPORTED` guard submit has, so `approverChanges` cannot smuggle a removal through.
- Deleting the standalone Graph event when a date is removed from `recurrence.additions[]`. Unconfirmed gap (S11); task 0.2 verifies and records it in the proposal as a follow-up, not in this change.
- Repairing historical *field* drift (titles, times) from past approvals. The sync health report surfaces those; the admin re-saves.
- A general job scheduler.

## Decisions

### D0. Probe Graph's recurrence-PATCH behaviour before committing to a delta rule

Outlook is documented to discard instance cancellations and modifications when a series' recurrence is rewritten, and Save already sends `graphUpdate.recurrence` on every recurring save. If that holds, any approval or save that changes pattern or range silently un-cancels every earlier exclusion and stales every child's `graphEventId`.

**Choice:** Task 0.1 is a sandbox probe against the test mailbox: create a series, cancel one instance, PATCH the master with (a) an identical recurrence and (b) a changed `range.endDate`, then list instances. The result is recorded in this file under Open Questions and selects between two rules in D2:
- Cancellations survive: cancel only `exclusionsAdded` (the delta).
- Cancellations are reset: when `recurrence.pattern` or `recurrence.range` changed, cancel the **full** exclusion list and re-sync every child document; otherwise the delta.
The reconciler takes a `recurrenceRewritten` boolean so both rules are one code path with one flag.

### D1. Two shared pieces, injected deps, Save's order preserved

**Choice:** New `backend/services/publishedMasterGraphSync.js` exporting:

- `buildMasterPatch({ effective, changedFields, event, deps })` — the payload logic currently at ~27300-27530, moved verbatim and then made to read from `effective` (the post-write document merged with any pending `graphData` fallbacks) instead of from `updates`. `changedFields` gates which keys are emitted (so an unchanged title is not re-sent) and recurrence alignment uses `effective.recurrence` whenever the master is the target, not `changes.recurrence`. Location fields come from a `resolveLocations(effective.locations)` dep that wraps the DB lookup at ~26854.
- `reconcilePublishedSeries({ event, updatedEvent, editScope, recurrenceRewritten, deps })` — post-write for both callers: `materializeAdditionDocuments`, sync of children with no `graphEventId`, cascade of master title/time/location/category changes to children that **do** have a `graphEventId` (replacing Save's dead `exceptionEventIds` / `occurrenceOverrides` cascade), and exclusion handling per D2. Never throws; returns `{ synced: [{kind, date, graphId}], failed: [{kind, date, error}], cancelledExclusions: [{date, graphId}], materialized: [dates] }`.

`deps` is one object: `{ graphApi, collection, logger, syncExceptionDocumentsToGraph, syncRecurrenceExclusionsToGraph, findGraphOccurrenceForDate, buildGraphSubject, buildOffsiteGraphLocation, resolveLocations }`. api-server builds it once after DB connect. Tests inject `graphApiMock` and stubs.

**Save keeps its order:** pre-write `buildMasterPatch` + PATCH (so `graphData` merges into the same write as today), post-write `reconcilePublishedSeries` replacing the block at ~28150-28188. **Approval:** post-Write-2 `buildMasterPatch` + PATCH, persist the PATCH response into `graphData` with a plain `updateOne` (no `$inc _version`, see D4), then `reconcilePublishedSeries`.

**Alternative rejected:** one helper that "replaces both blocks". Impossible without reordering Save, and reordering Save is a behaviour change this proposal does not want to carry.

**Alternative rejected:** copy the Save block into approval. That is how the two paths diverged the first time.

**Refactor safety:** name-level pass/fail diffs only protect what is already asserted, and Save's suites mostly assert Mongo state. Task 1.2 therefore adds a **characterization suite on HEAD** that snapshots the exact `updateCalendarEvent` payload and call order for a Save input matrix (hold subject; offsite; rooms changed; rooms cleared → "Unspecified"; recurrence changed and aligned; recurrence removed → `null`; body formats; categories fallback; `thisEvent` unresolved instance → skipped; Graph throw followed by the Mongo write still happening; 409 after Graph, documented as current behaviour) plus `graphSynced` and the `graphData` merge. The extraction must leave every snapshot byte-identical. The by-name baseline is widened to every suite that touches Save's Graph path (S5 list) and the diff is a script, not eyeballing.

### D2. Exclusion handling: delta or full per D0, append not overwrite, child-aware

**Choice:** Add `exclusionsAdded(oldR, newR)` to `utils/recurrenceCompare.js` (set difference, string-normalised, deps-free). `syncRecurrenceExclusionsToGraph` is refactored to `(calendarOwner, calendarId, seriesId, dates, timeZone, deps)`: it takes the date list, resolves each via `findGraphOccurrenceForDate` (timezone-aware, ±1 day window), and returns `{ cancelledOccurrences, notFound, failed }`. The four existing callers (draft submit ~16805, owner restore ~17240, admin restore ~17492, publish ~23829) pass the full list and `createdEvent.start?.timeZone`. **This is a fix for those callers, not a no-op**: they gain the `Prefer: outlook.timezone` header and the widened window. Their tests assert the new request shape.

`graphData.cancelledOccurrences` is written with `$addToSet: { $each }`, never `$set`, so publish-time entries survive a later save. The four existing `$set` writers are left alone (they run on a freshly created series where the array is empty) but noted.

**Excluded date that has a child document:** `findGraphOccurrenceForDate` only sees instances, so an addition's standalone event would never be found. The reconciler checks `findExceptionForDate` first; if a live child exists, it soft-deletes the child (`softDeleteException`) and deletes the child's `graphEventId` event, then does not look for an instance. Mirrors what the single-occurrence Delete route already does for children (~28434-28530).

**Retry:** parity with Save, which calls `graphApi.updateCalendarEvent` with no `withGraphRetry`. The reconciler does not retry either; a 503 is one failed entry, not a backoff sleep inside the approval request (and inside ERG-7).

### D3. Occurrence-scoped approval: pre-flight before Write 1, exception document, master `_version` bump

**Choice:** Before Write 1, the handler runs a pre-flight for `thisEvent` requests: `resolveSeriesMaster` (400 `InvalidEventType` if the target is not a master), `validateOccurrenceDateInRange`, build `overrideData` via `extractOverrideData(finalChanges)` with recurrence keys stripped, and the DATE_IMMUTABLE check. Any failure returns 400 **before** the request is flipped to approved, so the new failure modes cannot produce a split-brain. `finalChanges.startDateTime` / `startDate` that disagree with `occurrenceDate` are rejected the same way (today `extractOverrideData` silently drops them).

The conflict pre-check becomes a **whole-state** check on the merged effective occurrence: `mergeDefaultsWithOverrides(master, {...existing?.overrides, ...overrideData}, dateKey)` supplies the dates, times and rooms. Not `checkOccurrenceConflictDelta`: approve/publish/restore keep the whole-state rule per CLAUDE.md. This also fixes the pre-existing bug where a rooms-only occurrence request was checked against the series' first date.

Write 2 for `thisEvent` becomes two writes: `findExceptionForDate` → `updateExceptionDocument` / `createExceptionDocument` on the child, then a `conditionalUpdate` on the master with `expectedVersion: eventVersion`, `$set: { lastModifiedDateTime, lastModifiedBy }` and a `statusHistory` entry `Occurrence <date> edited via approved request`. The master write keeps the OCC contract (`partialFailure` / `compensationRequired` on a stale `eventVersion`), supplies `updatedEvent` for the response's `eventVersion` and the SSE payload, and is the version bump the renderer's cache keys on. The response additionally carries `exceptionDocId`.

Graph: if `master.graphData.id`, resolve the instance with `findGraphOccurrenceForDate`, PATCH it with the same occurrence payload Save's `thisEvent` branch builds (~26800-26845, including the `[Hold]` rule), persist `graphEventId` on the child. Unresolvable instance → child still written, no master PATCH, `graphSync.failed` names the date.

**Fixtures:** `createPublishedEvent` defaults to `singleInstance` with `graphData: {}`. The occurrence tests need a series master with `recurrence` and `graphData.id`; `eventFactory` gains or reuses a `createPublishedSeriesMaster` helper.

### D4. Non-fatal, recorded, before `res.json`, version-neutral follow-up writes

**Choice:** Graph sync runs after Write 2 commits and before `res.json`, so the response carries `graphSync: { synced, failed, cancelledExclusions }` and the approver's toast can say "approved; Outlook update failed" instead of lying by omission. Graph failure never un-approves.

All follow-up persistence by the sync (`graphData` merge, `graphData.cancelledOccurrences`, `graphEventId` on children) uses plain `updateOne` with **no `$inc _version`**, matching Save's restore block (~27273), so the `eventVersion` already captured from Write 2 stays correct. After the sync the handler re-reads the master once for the SSE `event` payload. The `edit-request-approved` audit entry gains `metadata.graphSync` with the same summary.

**Alternative rejected:** fire-and-forget after `res.json`. The response would then report success for a sync that may be failing, and the per-occurrence `graphEventId` persistence must be awaited.

### D5. Repair script mirrors `backfill-addition-graph-events.js`

**Choice:** `backend/backfill-exclusion-graph-cancellations.js`. Scope: `eventType: 'seriesMaster'`, `status: 'published'`, `isDeleted != true`, `'recurrence.exclusions.0': {$exists: true}`, `'graphData.id': {$exists: true}`. Per master, per exclusion: if a live child exists for the date, soft-delete it and delete its `graphEventId` event; else `findGraphOccurrenceForDate` with the master's stored timezone (printed per lookup in `--dry-run`); if found, delete and `$addToSet` `{date, graphId}` into `graphData.cancelledOccurrences`. Not found = already cancelled = skip. `--dry-run` lists would-cancel; `--verify` reports exclusions still resolvable in Graph (should be 0). Batched 25, 1s between batches, `withGraphRetry`, progress bar. Masters without `graphData.id` are reported and skipped. The script is standalone and may run before the deploy.

### D6. Scheduled sync health run: leased timer, persisted summary, nav badge

**Choice:** `backend/services/syncHealthScheduler.js` with `start({ runCheck, store, intervalMs, logger, now })` / `stop()`. api-server starts it from `startServer` (not module load, not `setDatabase`, so `createAppForTest` leaks no handle; additionally skipped when `NODE_ENV === 'test'`), controlled by `SYNC_HEALTH_INTERVAL_MINUTES` (default 360, `0` disables), timer `.unref()`'d.

**Lease, not just a timer.** The store is one `templeEvents__SystemSettings` document `_id: 'sync-health-latest'` (the collection is keyed by `_id`, as `'calendar-settings'` and `'email-settings'` are). Each tick, and once ~60s after boot, the scheduler attempts `findOneAndUpdate({ _id, $or: [{ nextRunAt: { $lte: now } }, { nextRunAt: { $exists: false } }] }, { $set: { nextRunAt: now + interval, leasedBy: instanceId } })`. Only the winner runs the check. This solves both the multi-instance duplicate run and the "deploys restart the app more often than the interval, so the first tick never fires" problem in one write.

On completion the winner `$set`s `{ ranAt, window, counts, degraded, durationMs, error: false }`. On failure it `$set`s `{ error: true, errorAt, errorMessage }` and **leaves the previous `counts` and `ranAt` in place**, so the badge does not vanish during an outage.

New `GET /api/admin/reports/sync-health/latest` (same `isAdmin || canApproveReservations` gate as the report) returns the document or `{ latest: null }`.

**Badge** = `missingFromOutlook + shouldNotBeInOutlook + failedDeletion`. `untracked` and `untethered` are excluded: `untracked` is chronic by the design's own account and a permanent badge trains people to ignore it; `untethered` has its own reconcile flow. The frontend query uses `staleTime` 5 min and `refetchInterval` 15 min since no SSE carries scheduler results. `SyncHealthReport.jsx` shows "Last automatic run: <time>" or "No automatic run yet", plus an error line when `error` is true.

## Risks / Trade-offs

- [Extraction changes Save's Graph payload] → characterization snapshots on HEAD must stay byte-identical; widened by-name baseline; scripted diff. Save refactor and approval wiring are separate tasks and separate commits.
- [D0 shows cancellations are reset by a recurrence PATCH] → `recurrenceRewritten` flag switches the reconciler to full-list cancel + child re-sync; the repair script's `--verify` then also runs after any such save in the manual check.
- [Approval now makes Graph calls, lengthening latency] → same as Save today; response carries the outcome. A 40-addition series could approach the frontend request timeout; measured in 7.3.
- [Exclusion cancel on an already-cancelled date] → `findGraphOccurrenceForDate` returns null; treated as done, not an error.
- [Occurrence approval fixtures] → new series-master fixture; the two existing array-asserting tests are rewritten against it.
- [Scheduler lease on a clock-skewed instance] → lease window equals the interval; skew of minutes cannot double-run.
- [Scheduled run hits Graph throttling] → existing Graph breaker/retry; the summary records `error: true` with the last good counts retained.
- [`graphData` read for logic] → the moved builder still falls back to `event.graphData.categories` / `.location` / `.start.timeZone` for unchanged fields and the timezone. Pre-existing invariant-1 violation, carried verbatim and marked `// TODO graphData-read` so the calendarData-removal refactor finds it.

## Migration Plan

1. Run D0's sandbox probe; record the result here.
2. Run `node backfill-exclusion-graph-cancellations.js --dry-run` against production (independent of the deploy), review (expect the 10/14 instance of `evt-request-1780078660390-6l4gmxc9j`), apply, `--verify`. Also run the N4 count of masters with non-empty `occurrenceOverrides[]` and record it.
3. Deploy backend with `SYNC_HEALTH_INTERVAL_MINUTES` unset (scheduler off).
4. Open Sync Health, confirm the excluded-date `shouldNotBeInOutlook` count is 0.
5. Set `SYNC_HEALTH_INTERVAL_MINUTES=360`, restart, confirm the boot tick populates `sync-health-latest` and the badge renders.
6. Rollback: revert the deploy; the repair script's cancellations stand. Scheduler disables with the env var alone.

## Implementation notes (2026-10-08)

- **D2 child rule amended.** An `exception` child with NO `graphEventId` still has its series instance in Outlook, so the instance lookup runs for it too (an `addition` has no series instance). Found by the production repair: Kaiserman 11/19 was excluded, its unlinked exception child was soft-deleted, and the instance stayed. Locked by BXC-5 and PMS-11.
- **Sync Health missed 10 of the 70 repaired dates.** 9 were beyond the default window (30 days back / 180 ahead; the latest was 2027-05-28). 1 (the Kaiserman case) had a live child on an excluded date, which the report treats as an expected event rather than drift.

- **Exclusion timezone source.** The four create-path callers pass the zone they SENT (`graphEventData.start.timeZone`), falling back to `createdEvent.start.timeZone`. `createCalendarEvent` sends no `Prefer: outlook.timezone`, so the real create response reports UTC — the zone that shifts evening occurrences onto the next day. The Graph mock echoes the request, which is why tests cannot tell the two apart.
- **D0 pending; conservative rule shipped.** Save re-sends Graph recurrence on every recurring save, so Save passes `recurrenceRewritten = true` whenever its PATCH carried recurrence and re-cancels the FULL exclusion list. Approval sends recurrence only on a pattern/range change and uses the delta otherwise. An already-cancelled date resolves to no instance, so the full-list rule costs lookups, never a wrong delete. Once 0.1 shows cancellations survive, Save can switch to the delta by changing the flag at its one call site.
- **Occurrence approval write order.** The master `conditionalUpdate` runs BEFORE the child write (design said child first), so a stale `eventVersion` writes nothing, preserving the existing "event unchanged on 409" contract.
- **`failedDeletion` is not a report category.** Failed deletions are `shouldNotBeInOutlook` entries with reason `deleted in app but still in Outlook`; the scheduler splits them out so `shouldNotBeInOutlook + failedDeletion` never double-counts.
- **Save cascade.** The dead `exceptionEventIds` / `occurrenceOverrides` cascade was removed; `reconcilePublishedSeries` cascades to children that have a `graphEventId`, re-merging each child's overrides over the new master. Child documents' denormalized fields are NOT rewritten (pre-existing; out of scope).
- **deps** are built per call (`getPublishedMasterSyncDeps()`), not once at connect, so they always carry the graph service and collection tests swap in.
- **SRC-3 needle.** The spec's `graphUpdate.recurrence = buildGraphRecurrence(` never existed verbatim; the test asserts on the expressions Save actually used.

## Open Questions

- **D0 result (fill in after task 0.1):** does a recurrence PATCH on a Graph series master reset instance cancellations? Identical recurrence: ___. Changed range: ___.
- **S11 (answered 2026-10-08, task 0.2):** NO. Nothing deletes the standalone Graph event, or even the `addition` child, when a date leaves `recurrence.additions[]`. `reconcileOccurrenceOverrides` soft-deletes only orphaned `exception` children, and its Graph cleanup reads `orphan.graphData.id`, which children never carry (they store `graphEventId`, and `graphData` is null), so that cleanup never fires either. `findOrphanedOverrides` is imported by api-server but never called. Recorded as a follow-up in proposal.md.
- `graphSync.failed` surfaces as a `showWarning` toast in `ReviewModal` (matches the `attachmentWarning` precedent); confirm the copy.
- Interval default of 6 hours: fine for drift measured in weeks. Revisit if same-day detection is expected.
