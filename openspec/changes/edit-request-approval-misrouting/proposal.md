## Why

Edit-request approvals are being applied to the wrong document. The Resource Scheduler import created two documents per imported event (a sandbox copy with no Outlook link and a production copy linked to Outlook) sharing one `eventId`, and the edit-request endpoints resolve the target by `eventId` alone. 53 approved requests on 35 production events (2026-06-02 to 2026-10-13) never reached the production event or Outlook, while the approver saw either "approved" or a misleading "modified concurrently, an administrator can re-apply" message for an action that does not exist. Found 2026-10-13 on an event happening that evening.

## What Changes

- Edit-request endpoints resolve the target event by the request's stored `eventObjectId` (document `_id`), never by `eventId` alone: approve, single-request hydration, reject (email payload), and `GET /api/events/:id/version`.
- Submit anchors the request to the document the user actually opened: the frontend sends `_id` first (reverting c6dcaf9's flip to the `eventId` string) and the backend resolver prefers it.
- Approve performs an OCC pre-check against the target document BEFORE Write 1, so a stale `eventVersion` returns 409 with zero writes and the request stays `pending`.
- A residual Write-2 version conflict (true race) is recorded: `logger.error`, an `edit-request-approval-split` audit entry, and a response message that no longer promises a non-existent re-apply action. **BREAKING** for the documented `partialFailure` contract: the common stale-version case no longer produces `partialFailure`.
- New script `backend/reopen-misrouted-edit-requests.js` (`--dry-run`, `--verify`, `--revert`, batched, retried, idempotent) repairs the existing records by handing them back to the approval queue: each affected request is re-pointed to the production copy and the newest per event is set back to `pending` with the chronological union of the group's proposed changes, so approving it in the app runs the real conflict check, Outlook sync, audit and email. Past events, deleted production copies and values already in production are only marked. Every write carries the full BEFORE state on the request and an `edit-request-repaired` audit entry; `--revert` restores it.
- Stale "supersede sweep" header comment on the approve test is corrected.

## Capabilities

### New Capabilities
- `edit-request-target-identity`: an edit request's target is the document `_id` it was submitted against; every endpoint that acts on a request resolves that document and the version check is performed against it before any write.

### Modified Capabilities
- `edit-request-graph-sync`: the "Stale eventVersion is a partial failure, as today" scenario changes — a stale version is now refused before Write 1 with the request left pending; `partialFailure` is reserved for the residual race.

## Impact

- `backend/api-server.js`: `resolveEventForEditRequest`, new `findEditRequestTarget`, `POST /api/edit-requests`, `GET /api/edit-requests/:id`, `PUT /api/edit-requests/:id/reject`, `PUT /api/edit-requests/:id/approve` (OCC pre-check + recorded residual split). `GET /api/events/:id/version` keeps its `eventId` fallback: the frontend only ever sends `_id`.
- `src/hooks/useReviewModal.jsx`: submit payload carries `eventObjectId`; partial-failure message.
- New `backend/reopen-misrouted-edit-requests.js`.
- Tests: new `editRequestsTargetIdentity.test.js` (8), new `reopenMisroutedEditRequests.test.js` (10), two assertions rewritten in `editRequestsApprove.test.js`, new frontend `useReviewModal.targetIdentity.test.jsx` (2).
- Data: 53 `templeEvents__EditRequests` documents gain a `repair` block and are re-pointed to production; the newest per upcoming event returns to `pending`; one `edit-request-repaired` audit entry per request. No event document and no Outlook event is written by the script.
- Out of scope (separate change): disposition of the sandbox duplicates themselves; `calendarOwner`-scoping of `findExceptionForDate` / `resolveSeriesMaster`.
