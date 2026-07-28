# Tasks — sync-health-hardening-and-reconcile

## 1. Report correctness fixes (highest value, smallest diffs)

- [x] 1.1 Fix deleted-docs query in `syncHealthService.js` to `$or` across `graphData.id` and `graphEventId`; add regression test seeding a deleted addition child whose mock Outlook event survives (asserts it appears in `shouldNotBeInOutlook`) plus a preserved-behavior test for a deleted single instance
- [x] 1.2 Derive `outlookOnly` in `src/utils/syncHealthGrouping.js` from the `untracked` array instead of `outlookFound − matched`; update `syncHealthGrouping.test.js` with the failed-deletion case (1 flagged + 2 untracked → bar shows 2)
- [x] 1.3 Add null-date guard in `syncHealthService.js` (`localDateOf` consumer): error-level log with mongoId and degraded-data indication on the calendar entry; unit test with a document missing all date fields

## 2. Graph retry and breaker fixes

- [x] 2.1 Verify the real network-error shape thrown by `graphRequest` for ETIMEDOUT/ECONNRESET (undici wraps in `TypeError` with `cause.code`) and document it in a comment
- [x] 2.2 Export `buildGraphError(status, message, graphError)` from `graphApiService.js` and use it at the throw site; refactor `graphApiMock` to build all simulated errors with it
- [x] 2.3 Fix retry predicates in `syncHealthService.js` and `backfill-addition-graph-events.js` to read `err.status ?? err.statusCode` plus the verified network-error shape; integration test: mock 429 (production-shaped) → wrapper retries; assert via mock call count
- [x] 2.4 Add injectable breaker to `retryWithBackoff` (`options.breaker`, default = existing singleton, keep `_resetBreakerForTest` behavior); create a dedicated Graph breaker instance used by all Graph retry wrappers; test: Graph 429 burst leaves Cosmos breaker state untouched

## 3. Report query scoping and projection

- [x] 3.1 Add owner scoping to both `.find()` queries in `runSyncHealthCheck` using `$in` over casings from `distinct('calendarOwner')` when a scope is requested
- [x] 3.2 Add a projection covering exactly the fields read by `buildAppSide`, `localDateOf`, and `buildSeriesAwareDateRangeClause` (incl. `graphData.id`, `graphEventId`, `recurrence`, `calendarData.startDateTime`/`endDateTime`, `eventId`, `seriesMasterEventId`, `occurrenceDate`, `isDeleted`, `status`, `eventType`, `calendarOwner`, `eventTitle`, `startDate`)
- [x] 3.3 Parity integration test: seeded fixtures covering all four finding types produce identical findings with and without the projection (import the projection constant; run diff both ways)

## 4. Report cache hygiene

- [x] 4.1 On Run Check, `removeQueries` for prior `syncHealth.report` keys (keep the immediately previous run); Vitest: third run leaves at most two report entries in the cache

## 5. Reconcile pure logic (`backend/utils/syncReconcilePlan.js`)

- [x] 5.1 Implement `fingerprintOf(observation)` and `verifyExpectedState(expected, observed)` returning a drift list; unit tests for each drift class (`_version` bump, `graphData.id` appeared, doc un-deleted, exclusion removed, Outlook probe changed, subject changed, target type became seriesMaster, expired plan)
- [x] 5.2 Implement `buildPlan(findingType, action, observation)` for: shouldNotBeInOutlook delete (with justification re-derivation and attendee warning), untethered link/archive/publish (publish refused for seriesMaster); unit tests per action incl. refusal paths
- [x] 5.3 Implement duplicate-candidate matcher (normalized `buildGraphSubject` output vs untracked entries on the same date, `[Hold]` prefix handling); unit tests incl. no-candidate, one-candidate, hold-prefix cases

## 6. Reconcile service and routes

- [x] 6.1 Extract the republish core from `POST /api/admin/events/:id/republish` into a shared function (behavior-preserving; existing republish integration tests stay green)
- [x] 6.2 Implement `backend/services/syncReconcileService.js` with injected `{eventsCollection, graphApi, auditService}`: `observe()` (targeted Mongo fetch + narrow Graph probe), `planReconcile()`, `applyReconcile()` (re-observe → verify → execute ops in publish-endpoint order with compensating delete; idempotent `alreadyGone`/no-op handling; `createdGraphEventIds` recording)
- [x] 6.3 Add `POST /api/admin/sync-health/reconcile/plan` and `/apply` routes in `api-server.js`: admin-only gate, validation, error mapping (`409 STALE_FINDING`, `409 VERSION_CONFLICT`, `422 DUPLICATE_CANDIDATE`, 400 missing `confirmIrreversible`), audit write, statusHistory push and SSE for Mongo-writing actions
- [x] 6.4 Integration tests (via `createAppForTest` + production-shaped graphApiMock): approver 403; stale-abort for each mutation class with zero graph-mock write calls; delete without `confirmIrreversible` → 400; series-master target aborts; second delete (mock 404) → `alreadyGone`; duplicate guard 422 then link path writes Mongo only; publish OCC-conflict triggers compensating delete; audit entry contents; archive statusHistory + SSE

## 7. Fix panel UI (`SyncHealthReport.jsx`)

- [x] 7.1 Add admin-gated "Fix…" affordance on rows in `shouldNotBeInOutlook` and `untethered` sections; expand to an inline panel listing available actions with direction labels
- [x] 7.2 Wire plan call and render server descriptions/warnings/candidates verbatim; candidate pick-list for link-to-existing
- [x] 7.3 Apply with in-button confirmation (confirm state red for deletes per action-color standard), `confirmIrreversible` sent on second click; `showSuccess`/`showError` toasts
- [x] 7.4 Post-apply and on `STALE_FINDING`: invalidate/re-run the report scoped to that calendarOwner; toast explaining stale refresh
- [x] 7.5 Vitest: Fix button role/category gating; plan panel renders server text; confirm sequence sends `confirmIrreversible`; stale response triggers scoped refresh

## 9. Decision context in the Fix panel (added 2026-07-27 after first real use)

The shipped panel offered archive / link / publish knowing only the event's title, and
rendered "whole series" for every untethered single instance — so an admin had no basis
for choosing and no way to verify the finding.

- [x] 9.1 Add `date` to `untethered` findings in `syncHealthDiff.js` (null for `seriesMaster`); row label falls back to 'no date', reserving 'whole series' for masters
- [x] 9.2 Enrich `observe()` with decision context (end date, locations, categories, requester, createdAt/By, lastModified) and split the day probe into `listOutlookDay` + `filterUntracked`
- [x] 9.3 Context mode: `plan` with no `action` returns `{context, availableActions, observed}` — reads only, no ops, no fingerprint; `apply` still requires an action
- [x] 9.4 Return `dayEvents` (capped 25) + totals on the observation so an admin can see the absence rather than trust the report
- [x] 9.5 `EventFacts` + `OutlookThatDay` render on panel open, before any action is chosen
- [x] 9.6 Tests: backend context mode (3), untethered date (2 updated), frontend facts/day/read-only (4)
- [x] 9.7 Refuse `publish` with `NO_DATE` — `buildGraphEventDataFromRecord` would emit `start: { dateTime: undefined }` and Graph would reject it; archive stays available
- [x] 9.8 Findings carry `location`/`startTime`/`endTime` (`displayFieldsOf`, display-only — matching stays Graph-ID-only); projection extended to match
- [x] 9.9 Report widened to 1500px and rows laid out as columns (Event | When | Time | Where | Type), prose blocks capped at 78ch, columns collapse under 900px
- [x] 9.10 Link candidates surface on panel open rather than after picking an action
- [x] 9.11 Tests: room-alias drift must not produce a finding ('Lowenstein' vs 'Leon Lowenstein'), columns render unopened, candidates shown on open
- [x] 9.12 **Timezone defect (found in live use).** The day probe asked Graph for a UTC day (`00:00Z..23:59Z`), which in Eastern spans 19:00 the previous evening to 18:59 — an evening booking on the target date lands at `01:00Z` the NEXT day and was missed entirely, so its Outlook twin produced no link candidate and the admin was steered toward `publish`, duplicating an event Outlook already had. Now fetches a padded window and narrows with the same Eastern date key the diff uses.
- [x] 9.13 Add `toEasternTimeKey` and return `startTime`/`endTime` on day events in calendar-local wall clock; the panel printed raw UTC (a 17:00 booking showed as 22:00 beside the app's '17:00'). Tests cover EST, EDT, pre-localized input, and the window assertion.

## 10. Batch link (v2 scope, pulled forward)

Link is the only action offered in bulk: Mongo-only, creates nothing, reversible by
unsetting the id. Bulk publish would mint duplicate Outlook events and bulk delete cannot
be undone — neither is exposed at any tier.

- [x] 10.1 `classifyLinkMatch` in the pure module: `confident` requires exactly ONE candidate AND subject + date + start time agreement; everything else is `ambiguous`/`none` with a stated reason (7 unit tests)
- [x] 10.2 Extract `describeDoc` so the batch planner and single-finding observation cannot drift apart
- [x] 10.3 `planBatchLink` — one Graph probe per DISTINCT DATE (not per document), per-row `expectedState`, skips already-linked/unpublished/dateless rows with a reason
- [x] 10.4 `applyBatchLink` — a loop over the ordinary `applyReconcile`, so every row inherits the fingerprint handshake, OCC write, audit entry and SSE broadcast; failures isolated per row; batch-25 / 1s Cosmos pacing; `MAX_BATCH_ROWS` cap
- [x] 10.5 Routes `POST .../reconcile/batch/plan` and `/batch/apply`, admin-only, rejecting selections that omit `graphId` or `expectedState`
- [x] 10.6 Review table UI: confident rows pre-checked, server reason shown per row, tier stripe on the left edge, in-button confirm, scoped re-run after apply
- [x] 10.7 Tests — backend: tier classification end-to-end, one-probe-per-date, stale row skipped while the rest complete, missing-fingerprint 400, approver 403 (6); frontend: pre-selection, reasons rendered, only-checked-rows-sent with fingerprints, disabled at zero, re-run, non-admin (6)

## 8. Verification and docs

- [x] 8.1 Run targeted suites: `npm test -- syncHealthDiff.test.js syncHealth.test.js syncReconcilePlan.test.js syncReconcile.test.js` (backend) and `npm run test:run -- SyncHealthReport syncHealthGrouping` (frontend); fix fallout
- [ ] 8.2 **BLOCKED — needs the user.** Manually verify against the sandbox mailbox: run report, confirm the previously invisible deleted-child findings appear, exercise one archive and one link action end-to-end (verify-app skill). Requires live Graph app credentials and performs writes against a real mailbox, so it was not run unattended.
- [x] 8.3 Update `CLAUDE.md` current-work section and add the report call sites to the calendarData-removal refactor checklist; note the reconcile v1.5/v2 deferrals
