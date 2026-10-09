## 0. Probes (answer the open questions before code)

- [x] 0.1 Sandbox probe (test mailbox, live Graph): create a weekly series, cancel one instance, PATCH the master with (a) an identical `recurrence`, (b) a changed `range.endDate`; list instances after each. Record in design.md Open Questions whether cancellations survive. Selects the D2 delta-vs-full rule.
  - Result 2026-10-09: identical recurrence and a range change keep cancellations; a pattern change RESETS them. Details in design.md Open Questions.
- [x] 0.2 Verify S11: grep for any handler that deletes a standalone Graph event when a date leaves `recurrence.additions[]`. Record the answer in design.md and, if it is a gap, add a follow-up line to proposal.md (out of scope here).
- [x] 0.3 Production read-only count of published masters with a non-empty `occurrenceOverrides[]` (N4). Record the number in design.md Context.
  - Result 2026-10-08: 0 published masters with a non-empty `occurrenceOverrides[]`.

## 1. Baseline and failing tests (verification harness before any code moves)

- [x] 1.1 Write `backend/scripts/diff-jest-results.js` (two `--json` outputs in, by-name pass/fail diff out). Write baseline JSON to the scratchpad or `backend/.baseline/` (gitignored), never into `openspec/changes/` (task 7.1's `git stash -u` would carry it).
- [x] 1.2 Capture the Save Graph baseline on HEAD: `cd backend && npm test -- eventUpdate adminOccurrenceEdit recurringConflict saveConflictDelta publishRollback architecturalBugs recurringPublish restoreOccurrence recurrenceRemoval seriesExclusion recurrenceOverrideReconcile approverTimeEdits holdEvent reservationTimes editRequestsApprove --json --outputFile=<baseline-dir>/head.json`
- [x] 1.3 Characterization suite on HEAD: `__tests__/integration/events/adminSaveGraphPayload.char.test.js` snapshotting `getCallHistory('updateCalendarEvent')` payloads and order for the Save matrix (hold subject; offsite; rooms changed; rooms cleared → "Unspecified"; recurrence changed + aligned; recurrence removed → `null`; body formats; categories fallback; `thisEvent` unresolved instance → skipped; Graph throw then Mongo write still happens; 409 after Graph, documented as current behaviour), plus `graphSynced` and the `graphData` merge. All green on HEAD; snapshots committed.
- [x] 1.4 Extend `graphApiMock.getRecurringEventInstances` to accept and record a 6th `timeZone` argument (one line each). Note in the test files that `assertCalled` is whole-object equality, so partial payload assertions use `getCallHistory`.
- [x] 1.5 Add `createPublishedSeriesMaster` to `eventFactory.js` (weekly recurrence, `graphData.id`, `graphData.start.timeZone`) if no equivalent exists.
- [x] 1.6 Write the failing series-level approval tests in `editRequestsApprove.test.js` (ERG-1..10): title/time PATCH; time-only on a series still aligned to range start; room change resolves names; recurrence change aligned; no `graphData.id` → `assertNotCalled`; added date → `createCalendarEvent` + child `graphEventId`; new exclusion → `deleteCalendarEvent` + `$addToSet` record; master title cascades to a linked child; unchanged-recurrence delta → one instance lookup; `approverChanges` removing an exclusion → 400 before Write 1. Confirm all fail on HEAD.
- [x] 1.7 Write the failing Graph-failure/audit tests (ERG-11..13): 503 via `graphApiMock.graphError` → 200 + `graphSync.failed[0].kind === 'master'` + `eventVersion` matches stored; audit `metadata.graphSync`; follow-up writes do not bump `_version`.
- [x] 1.8 Rewrite the two occurrence-scoped approval tests and add the rest (ERG-14..20) against the series-master fixture: pre-flight 400 on a `singleInstance` leaves the request pending; new exception + instance PATCH + master `_version` +1 + response `eventVersion`; existing exception updated in place; stale `eventVersion` → 409 partialFailure; unresolvable instance → `graphSync.failed[{kind:'occurrence'}]`; rooms-only request conflicts on the occurrence date not the series start; `occurrenceOverrides` untouched. Confirm all fail on HEAD.
- [x] 1.9 Source assertion test (N1): `api-server.js` text contains `reconcilePublishedSeries(` ≥ 2 and `buildMasterPatch(` ≥ 2, and no `graphUpdate.recurrence = buildGraphRecurrence(`. Fails on HEAD.

## 2. Exclusion primitives

- [x] 2.1 Add `exclusionsAdded(oldR, newR)` to `backend/utils/recurrenceCompare.js`; unit tests RCX-1..4 (set difference, null sides, non-string normalisation, no input mutation)
- [x] 2.2 Refactor `syncRecurrenceExclusionsToGraph(calendarOwner, calendarId, seriesId, dates, timeZone)` to resolve via `findGraphOccurrenceForDate` and return `{ cancelledOccurrences, notFound, failed }`; update the four callers (draft submit ~16805, owner restore ~17240, admin restore ~17492, publish ~23829) to pass `recurrence.exclusions` and `createdEvent.start?.timeZone`; add/adjust publish tests to assert the `timeZone` and ±1 day window (SX-1). Diff against 1.2.

## 3. Shared module and admin Save refactor (behaviour-preserving for Save)

- [x] 3.1 Create `backend/services/publishedMasterGraphSync.js` with `buildMasterPatch({ effective, changedFields, event, deps })` moved verbatim from ~27300-27530, then switched to read `effective` + `changedFields`; `deps` carries `graphApi, collection, logger, syncExceptionDocumentsToGraph, syncRecurrenceExclusionsToGraph, findGraphOccurrenceForDate, buildGraphSubject, buildOffsiteGraphLocation, resolveLocations`. Mark carried `graphData` reads with `// TODO graphData-read`.
- [x] 3.2 Add `reconcilePublishedSeries({ event, updatedEvent, editScope, recurrenceRewritten, deps })`: materialize additions, sync unsynced children, cascade master changes to children with `graphEventId` (replacing the dead `exceptionEventIds`/`occurrenceOverrides` cascade), exclusion handling per D0/D2 incl. the child-document rule, `$addToSet` cancellations, no retry, never throws, returns `{ synced, failed, cancelledExclusions, materialized }`.
- [x] 3.3 Unit tests for the module with injected `graphApiMock` and stubs (PMS-1..10): payload from effective state for each matrix row; `changedFields` gating; delta vs full exclusions by flag; child-document exclusion; `$addToSet`; cascade to linked children; non-throwing on Graph error.
- [x] 3.4 Admin Save: replace the inline pre-write payload block with `buildMasterPatch` (PATCH stays pre-write, `graphData` merge unchanged) and the post-write ~28150-28188 block with `reconcilePublishedSeries`. Build `deps` once after DB connect.
- [x] 3.5 Run the 1.3 characterization suite: every snapshot identical. Run the 1.2 command to `after-extract.json`; `diff-jest-results` must show only the new SX/REX tests changing state. Paste the diff summary into this file.
  - Result (2026-10-08): characterization 14/14 snapshots identical; `diff-jest-results after-2.2.json after-extract.json` over the 1.2 list (+eventPublish, draftSubmit, ownerRestore, eventAdminRestore): 228 passed / 78 failed both sides, 0 regressed, 0 fixed, 0 added, 0 removed. vs HEAD: 0 regressed; added = SX-1 (pass) + ERG-1..20 (18 red until section 4).
- [x] 3.6 Admin Save exclusion tests (REX-1..5): new exclusion cancels and records; earlier cancellations preserved; already-gone instance no-op; lookup carries timezone + window; excluded added date soft-deletes child and deletes its event.

## 4. Approval handler

- [x] 4.1 Add the `EXCLUSION_REMOVAL_NOT_SUPPORTED` guard on `finalChanges` before Write 1 (mirror ~24965).
- [x] 4.2 Occurrence pre-flight before Write 1: `resolveSeriesMaster`, `validateOccurrenceDateInRange`, `extractOverrideData` with recurrence stripped, DATE_IMMUTABLE on disagreeing `startDate`/`startDateTime`. Whole-state conflict check on `mergeDefaultsWithOverrides(master, {...existing?.overrides, ...overrideData}, dateKey)` (not `checkOccurrenceConflictDelta`).
- [x] 4.3 Occurrence Write 2: `findExceptionForDate` → `updateExceptionDocument`/`createExceptionDocument`; then `conditionalUpdate` on the master (`expectedVersion: eventVersion`, `lastModified*`, `statusHistory`), preserving the `partialFailure` 409 path; response carries `eventVersion` and `exceptionDocId`.
- [x] 4.4 Occurrence Graph: resolve instance, PATCH with Save's `thisEvent` payload rules, persist `graphEventId`; unresolvable → `graphSync.failed`.
- [x] 4.5 Series-level: after Write 2, `buildMasterPatch` + PATCH + plain `updateOne` of the `graphData` merge (no `$inc`), then `reconcilePublishedSeries` with `recurrenceRewritten` = pattern/range changed; re-read master for the SSE payload; attach `graphSync` to the response and to the audit entry's `metadata`.
- [x] 4.6 Update the handler doc comment (remove "legacy endpoint still handles").
- [x] 4.7 Run `editRequestsApprove.test.js` and the 1.9 source assertion: ERG-1..20 green, existing cases unchanged.
- [x] 4.8 Frontend: `useReviewModal` approval success shows `showWarning` when `graphSync.failed` is non-empty ("Approved. Outlook update failed for N item(s); re-save to retry."); test in `useReviewModal.*.test.jsx`.

## 5. Repair script

- [x] 5.1 Write `backend/backfill-exclusion-graph-cancellations.js` per D5 (child-document rule first, `findGraphOccurrenceForDate` with the master's timezone printed in `--dry-run`, `withGraphRetry`, batch 25 / 1s, progress bar, `$addToSet`, `--dry-run`, `--verify`, skip-and-report untethered masters).
- [x] 5.2 Unit test the script's planning/apply functions with an injected collection + `graphApiMock` (BXC-1..4: dry-run lists with timezone and deletes nothing; apply deletes and appends; child-document case; second run no-op).
- [x] 5.3 Run `--dry-run` against production; confirm the 10/14 instance of `evt-request-1780078660390-6l4gmxc9j` is listed with timezone `America/New_York`; apply; `--verify` reports 0; confirm in Outlook the series now starts 10/21. (Independent of the deploy.)
  - Result 2026-10-08: dry run listed 70 dates across 26 series (Cady 10/14 in `America/New_York`); 1 untethered master skipped. Apply cancelled 70, but --verify then reported 1: Kaiserman 11/19 had an UNLINKED exception child, so deleting the child left the series instance. Fixed in the script and in reconcilePublishedSeries (BXC-5, PMS-11), re-applied (1 more), --verify 0, Sync Health excluded-date findings 0. Outlook visual check of the Cady series still to do.

## 6. Scheduled sync health run

- [x] 6.1 Create `backend/services/syncHealthScheduler.js` with `start({ runCheck, store, intervalMs, instanceId, logger, now })` / `stop()` implementing the lease on `_id: 'sync-health-latest'`; unit tests with fake timers + `jest.setSystemTime` (SHS-1..6: boot tick acquires and runs; held lease skips; interval 0 disables; failing tick sets error fields and keeps last counts; next tick runs after failure; `stop()` clears).
- [x] 6.2 Wire in `startServer`: `SYNC_HEALTH_INTERVAL_MINUTES` (default 360), skip under `NODE_ENV === 'test'`, `unref()`; `store` backed by `systemSettingsCollection`. Assert `createAppForTest` creates no timer (SHS-7).
- [x] 6.3 Add `GET /api/admin/reports/sync-health/latest` with the report's gate; integration tests SHL-1..3 (403 for requester, `latest: null`, returns persisted summary).
- [x] 6.4 Frontend: `useSyncHealthLatest` under `keys.syncHealth.latest` (`staleTime` 5 min, `refetchInterval` 15 min); nav badge = `missingFromOutlook + shouldNotBeInOutlook + failedDeletion`; "Last automatic run" / "No automatic run yet" / error line in `SyncHealthReport.jsx`; tests SHB-1..4.
- [x] 6.5 Document the env var in `backend/.env.example` and the CLAUDE.md in-progress section.
  - No `backend/.env.example` exists in the repo; the variable is documented in CLAUDE.md only.
- [x] 6.6 Close the classifier blind spot found by 5.3 (Kaiserman 11/19): in `diffCalendar`, a live exception/addition child on a date its master excludes is not an expected event; a surviving Outlook instance (by series date or the child's own Graph ID) is reported in `shouldNotBeInOutlook` as `excluded date has a live override child`; no finding when Outlook already dropped the date. Test-first in `syncHealthDiff.test.js` (4 cases, 3 red before the fix).

## 7. Verification and close-out

- [x] 7.1 Full backend baseline by stash: `git stash push -u` → run the 1.2 list → `git stash pop` → run; `diff-jest-results`; no regressions beyond the documented red set.
  - Measured against the HEAD baseline captured in 1.2 (same list + editRequestsCreate, syncHealth): 0 regressed, 0 fixed; 324 passed / 60 failed vs 227 / 60. All 99 added tests pass.
- [x] 7.2 Frontend `npm run test:run`; compare to the documented baseline (11 failed / 4 files).
  - 11 failed / 4 files, identical to the baseline. Three route suites that render Navigation needed a useSyncHealthLatest mock (no QueryClient in their harness).
- [x] 7.3 Manual on dev (live MSAL, sandbox mailbox): as requester submit an edit request excluding one date and adding one on a published series; as approver approve; confirm the excluded date is gone and the added date exists in Outlook; approve an occurrence-scoped title change and confirm one instance renamed; note approval latency on the largest series available.
  - Passed 2026-10-09 (Stephen): excluded date gone and added date present in Outlook; occurrence title change renamed one instance; Cady series starts 10/21. Approval latency not recorded.
- [x] 7.4 If 0.1 showed cancellations reset: approve a range change on a series with a pre-existing exclusion and confirm the exclusion is still cancelled afterwards.
  - Not needed: 0.1 showed a range change does not reset cancellations. Only a pattern change does, and approval already re-cancels the full list for that.
- [x] 7.5 Open Sync Health after 5.3 and 6.2; confirm the excluded-date `shouldNotBeInOutlook` count is 0, the last-run line populates, and the badge reflects actionable counts only.
  - Passed 2026-10-09 (Stephen). Last scheduled run: shouldNotBeInOutlook 0, missingFromOutlook 34, failedDeletion 28 (badge 62).
- [x] 7.6 Update CLAUDE.md "Current In-Progress Work" and provide the commit message.
