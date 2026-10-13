## Context

`templeEvents__Events` holds two documents per Resource Scheduler-imported event with the same `eventId`: a sandbox copy (`calendarOwner: templeeventssandbox@emanuelnyc.org`, no `graphData.id`) and a production copy (`templeevents@emanuelnyc.org`, Outlook-linked). The import ran into both calendars; `eventId` was assumed unique and is not.

Flow and failure before this change:
1. Submit: `useReviewModal.jsx` sent `currentItem.eventId || currentItem._id`. `resolveEventForEditRequest` tried `_id` (fails on a string) then `findOne({ eventId })`, which returned the sandbox copy. The request stored `eventObjectId` = sandbox `_id`; `proposedChanges` was a delta against the sandbox `calendarData`.
2. Approve: `findOne({ eventId: editRequest.eventId })` → sandbox copy again. Client `eventVersion` came from `GET /events/<production _id>/version`. Write 1 flipped the request to `approved`; Write 2 `conditionalUpdate` on the sandbox doc with production's version. Mismatch (any production save since import) → 409 `partialFailure`, request approved, nothing else written, no audit, no log (409 is handled; Sentry `beforeSend` drops `statusCode < 500`). Match (both v1) → sandbox copy updated, audit written, Outlook untouched.
3. Hydration and the reject-email lookup had the same `eventId` fallback. The approval queue joins by `eventId` under a `calendarOwner` filter, which is why the production event wore the pending badge for a sandbox-anchored request.

Measured scope (read-only, 2026-10-13): 178 approved requests; 53 affected on 35 events — 50 returned 409 and wrote nothing, 3 silently wrote the sandbox copy. Of the 35 events: 16 upcoming with values not yet in production, 5 already carry every proposed value (fixed by hand), 5 have a deleted production copy, 9 are past. Two Fable reviews shaped this design.

## Goals / Non-Goals

**Goals:**
- Every endpoint that acts on an edit request acts on the document the request was submitted against.
- A stale version never leaves a request `approved` with an unchanged event.
- The existing 53 records go back through the real approval path, with every write recorded with its BEFORE state and reversible.

**Non-Goals:**
- Removing or re-keying the sandbox duplicates (separate change; it is the only fix that makes `eventId` unique again).
- `calendarOwner`-scoping `findExceptionForDate` / `resolveSeriesMaster` (occurrence-scoped requests on duplicated series stay ambiguous; none are affected today, and the script marks them `manual`).
- Compensating a Write-2 conflict by reverting Write 1 (see D4).
- A script that applies approved changes to events itself (see D5).

## Decisions

**D1 — Target identity is the document `_id` (`eventObjectId`); `eventId` stays a denormalized join key.** `_id` is what OCC keys on, what the client fetches the version for, and what audit `reservationId` records; it is already stored on every request since the collection cutover. (`eventId`, `calendarOwner`) was considered: semantically right but has no uniqueness guarantee either and would need a backfill. Legacy requests without `eventObjectId` keep the `eventId` lookup (`findEditRequestTarget`). For `thisEvent` scope, `eventObjectId` is the series master, as submit already stores it.

**D2 — Submit sends `eventObjectId` explicitly; the resolver prefers it.** The frontend keeps sending `eventId` (list joins depend on it) and adds `eventObjectId: currentItem._id`. `resolveEventForEditRequest(identifier, eventObjectId)` uses the explicit id first, then the legacy behaviour, so the contract no longer depends on identifier shape. The pre-c6dcaf9 code had `_id` first; that flip had no stated functional reason.

**D3 — OCC pre-check before Write 1, zero writes on mismatch.** Mirrors the OCC-first pattern the admin save path adopted (SCG-13): read the target's `_version` (the master's for occurrence scope) and if a non-null client `eventVersion` differs, return `buildVersionConflictBody()` with the request untouched. Write 2 keeps its `conditionalUpdate` gate as the real guard; a 409 there is now a true race.

**D4 — No compensation for the residual race; record it honestly.** Reverting Write 1 would bump the request `_version` twice (stale `editRequestVersion` on the client), opens a second-approver window, and adds a failure mode of its own. Instead: `logger.error`, `Sentry.captureMessage`, an `edit-request-approval-split` audit entry carrying both versions and the proposed changes, and the `partialFailure` body with a message that tells the approver to apply the change directly. The frontend prefers the server's message. Revisit compensation only if the residual ever fires.

**D5 — Existing records are re-opened, not re-applied.** The stored `proposedChanges` were diffed against the SANDBOX copy while the user looked at the production copy, so a field the user changed back to the sandbox value was dropped and a field equal to production but different from sandbox was included; the original form payload is not stored anywhere. A script cannot reconstruct intent, and a scripted apply would need the approve handler's apply core extracted from ~20 module-private closures. Re-opening instead re-points the group at the production copy and sets the newest request back to `pending` with the chronological union of the group's `proposedChanges` (later value wins per field, fields already equal to production dropped, contact fields from the newest). Approving it in the app runs the real conflict check against the production calendar, the Outlook PATCH, the audit entry and the email, with a human looking at the proposed-vs-current values. Older requests in the group stay `approved` and are marked `merged-into`.

**D6 — Outcomes that are only marked.** `past-skipped` (production end date before today in New York), `already-in-production` (every non-contact proposed value already equals production), `production-deleted` (no live production copy; the request keeps its sandbox anchor), `manual` (occurrence-scoped, or more than one live production copy). Re-pointing `eventObjectId` to production happens for `reopened`, `merged-into`, `already-in-production` and `past-skipped` so hydration and the queue show the right event.

**D7 — Every write is reversible and findable.** Each touched request gets `repair: { script, runAt, operator, outcome, reason, fromEventObjectId, toEventObjectId, before: { status, eventObjectId, reviewedBy, reviewedAt, reviewNotes, proposedChanges, baselineSnapshot, _version }, mergedFrom | mergedInto, disagreements }` and `$inc _version`; a re-opened request also gets a `statusHistory` entry with `changedBy: 'reopen-misrouted-edit-requests'`. One `edit-request-repaired` audit entry per request mirrors the marker. `--revert` restores `before` for any request whose status still matches what the script left (a re-opened request that was since approved or rejected is skipped and listed), pulls the script's `statusHistory` entry, stamps `repair.revertedAt`, and writes `edit-request-repair-reverted`. Selection is `{ status: 'approved', eventObjectId ∈ sandbox ids, 'repair.script': { $exists: false } }`, so a re-run is a no-op. The update filter repeats the `$exists: false` guard so two concurrent runs cannot double-write.

**D8 — Script conventions.** `--dry-run` writes nothing and prints the plan (and `--out` JSON); `--verify` reports requests still anchored and re-opened requests awaiting approval; batches of 25 with a 1s delay; `retryWithBackoff` on every Cosmos call; progress bar only. The script never requires `api-server.js` and never writes to `templeEvents__Events` or to Outlook.

## Risks / Trade-offs

- [Unfaithful stored deltas re-opened as proposals] → the approver sees proposed-vs-current in the modal and can edit or reject; nothing is applied unattended. Groups where an earlier approval silently wrote the sandbox copy (3) carry polluted later deltas; the published review page lists them.
- [`partialFailure` contract change] → the frontend branch is kept for the residual case; the spec scenario is updated; the two legacy tests that asserted the split-brain as intended behaviour are rewritten (ERG-17 and the 'partial failure' describe).
- [Script run before the deploy] → the OLD approve path would route a re-opened request back to the sandbox copy and split it again. Tasks 4.1/4.2 order the deploy first.
- [Re-opened request on an event edited by hand since] → `baselineSnapshot` is rebuilt from production at re-open time, so hydration's `baselineShifted` is honest from then on.
- [`GET /events/:id/version` keeps an `eventId` fallback] → latent only; the frontend sends `_id` everywhere. Left in place and noted.
- [Occurrence-scoped requests on duplicated series remain ambiguous after D1] → none affected today; script marks `manual`; follow-up change.

## Migration Plan

1. Deploy backend + frontend (D1-D4). Nothing in the code change depends on the script.
2. `cd backend && node reopen-misrouted-edit-requests.js --dry-run --out <dir>` → compare with the published review page.
3. `node reopen-misrouted-edit-requests.js` → 16 requests return to `pending`; `--verify` shows `stillAnchoredUnrepaired: 0`.
4. Approvers work the queue. `--verify` shows `reopenedAwaitingApproval` falling.
5. Rollback: `git revert` the code commit; `node reopen-misrouted-edit-requests.js --revert` restores every request not acted on since.

## Open Questions

- Whether the 5 events whose production copy was deleted should have the deletion revisited (product decision).
- Whether `attendeeCount: 50` on several 2028 B/M requests is a real request or a form default (the approver will see it as a proposal).
- Disposition of the sandbox duplicates (separate change).
