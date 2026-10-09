## Why

Approved edit requests on published events never reach Outlook. `PUT /api/edit-requests/:id/approve` writes the approved changes to MongoDB and stops; its own doc comment says Graph sync was "deferred to Phase 1c follow-up (legacy endpoint still handles)", but Phase 1c deleted that legacy endpoint (`PUT /admin/events/:id/publish-edit`) and repointed the frontend without porting the sync. Every title, time, room, or recurrence change that goes through the requester-edit workflow is therefore invisible in Outlook until someone happens to re-save the event from the admin form.

A live instance surfaced 2026-10-08: series `evt-request-1780078660390-6l4gmxc9j` (Dr. Alyssa Cady's Class). An edit request approved 2026-07-13 excluded 10/14 and added 12/02. Outlook still shows 10/14; 12/02 only exists in Outlook because the 2026-07-27 added-dates backfill script happened to sweep this master up. There is no equivalent backfill for exclusions, so the asymmetry the user observed ("excluded in the scheduler but not in Outlook") is exactly the shape of the gap.

The sync health report already has a classifier for this ("excluded date still present" -> `shouldNotBeInOutlook`) and its default window has covered 10/14 since April. Nobody ran it. Detection exists; cadence does not.

## What Changes

- **Edit-request approval syncs to Graph.** After Write 2 commits, a series-level approval on a published event PATCHes the Graph master with a payload built from the **post-write effective state** plus the changed-field set (the approval's proposed changes are a delta, not a full form, so a delta-fed builder would drop rooms and mis-align recurring times), persists the Graph response into `graphData` without bumping `_version`, and runs the same post-write series reconciliation admin Save runs: materialize addition documents, sync unsynced children, cascade master changes to linked children, cancel newly excluded dates. Graph failure never un-approves; the response and audit entry carry a `graphSync` summary. Draft/pending events (no `graphData.id`) are unaffected.
- **Shared Graph sync pieces for published masters.** Admin Save's PATCH payload builder and its post-write recurrence block are extracted into `services/publishedMasterGraphSync.js` (`buildMasterPatch`, `reconcilePublishedSeries`, injected deps) and both handlers call them. Save keeps its current pre-write PATCH order; the extraction is proven payload-identical by a characterization snapshot suite captured on HEAD first.
- **Newly added exclusions reach Graph from Save and approval.** Today Save handles exclusions that are *removed* (restore block) and additions that are *added*, but a newly *added* exclusion on a published series is never cancelled in Graph. The reconciler cancels `exclusionsAdded(old, new)` (or the full list when the recurrence pattern/range was rewritten, pending a sandbox probe of Graph's behaviour), appends to `graphData.cancelledOccurrences` rather than overwriting it, and soft-deletes any child document on an excluded date along with its standalone Graph event. The exclusion cancel helper becomes timezone-aware for publish and restore as well.
- **Approval cannot remove exclusions.** The submit path already blocks exclusion removal (`EXCLUSION_REMOVAL_NOT_SUPPORTED`); `approverChanges` currently bypass it. The approve path gains the same guard.
- **Occurrence-scoped approvals write exception documents.** The `thisEvent` branch of the approval handler writes to the legacy `occurrenceOverrides[]` array, which production no longer reads. It now pre-validates before Write 1 (master type, date range, DATE_IMMUTABLE), creates or updates an `exception` child via `exceptionDocumentService`, bumps the master through `conditionalUpdate` so the OCC contract, response `eventVersion` and SSE payload survive, runs a whole-state conflict check on the occurrence's own date (fixing a pre-existing check against the series' first date), and PATCHes that one Graph instance.
- **Repair script for existing drift.** `backend/backfill-exclusion-graph-cancellations.js`: for every published master with `graphData.id`, cancel any Graph instance still present on an excluded date. `--dry-run` / `--verify`, batched, idempotent, same shape as `backfill-addition-graph-events.js`. Runs independently of the deploy. Field-level drift from past approvals (titles, times) is left to the existing sync health report, which already surfaces it.
- **Scheduled sync health run.** A leased timer (lease document in `templeEvents__SystemSettings`, `_id: 'sync-health-latest'`) runs `runSyncHealthCheck` on a cadence and once shortly after boot, persists the latest summary keeping the last good counts through failures, and exposes it so the admin nav can badge the Sync Health link on actionable categories (`missingFromOutlook`, `shouldNotBeInOutlook`, `failedDeletion`). No new detection logic; the existing report runs on a clock instead of on a click.

## Capabilities

### New Capabilities
- `edit-request-graph-sync`: approved edit requests on published events propagate to Outlook (master PATCH, additions, exclusions, occurrence exceptions), non-fatal on Graph failure, with the sync outcome recorded.
- `recurrence-exclusion-graph-sync`: a newly added exclusion on a published series cancels the matching Graph instance from every write path that can add one (admin Save, approval), plus the one-off repair script for historical drift.
- `sync-health-scheduled-run`: the sync health check runs on a schedule, persists its latest result, and the admin UI badges when findings are present.

### Modified Capabilities
- (none; `sync-health-report` requirements are unchanged, the new capability only adds a trigger around them)

## Impact

- `backend/api-server.js`: approval handler (~25621-26006), admin Save handler Graph block (~27380-27720) and post-write recurrence block (~28150-28200); new shared helper extracted from the latter.
- New `backend/utils/recurrenceCompare.js` export `exclusionsAdded` beside `exclusionsRemoved`.
- New `backend/services/graphMasterSync.js` (or similar) holding the shared post-write sync.
- New `backend/backfill-exclusion-graph-cancellations.js`.
- New scheduled runner in `backend/services/syncHealthScheduler.js`; one new read endpoint for the latest summary; `SyncHealthReport.jsx` / nav badge.
- Tests: `editRequestsApprove.test.js` gains Graph-call assertions (via `graphApiMock`); new unit tests for `exclusionsAdded` and the shared helper; the two existing occurrence-scoped approve tests that assert writes to `occurrenceOverrides[]` are rewritten to assert an exception document.
- Data: one production repair run against templeevents@emanuelnyc.org after deploy.

## Follow-ups (out of scope)

- **Removed additions leave Outlook events behind (S11, confirmed 2026-10-08).** Removing a date from `recurrence.additions[]` deletes neither the `addition` child nor its standalone Graph event, and `reconcileOccurrenceOverrides's` orphan Graph cleanup reads `graphData.id` where children store `graphEventId`, so it never fires. Needs its own change.
