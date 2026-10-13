## 1. Target identity (backend)

- [x] 1.1 Failing suite `editRequestsTargetIdentity.test.js` (ETI-1..8): two docs share an `eventId`; approve/hydration/reject act on `eventObjectId`; stale version refused before Write 1; residual race recorded; explicit `eventObjectId` wins at submit; legacy fallback kept
- [x] 1.2 `findEditRequestTarget(editRequest)` used by approve, hydration and reject; `resolveEventForEditRequest(identifier, eventObjectId)` prefers the explicit id; create endpoint reads `eventObjectId`
- [x] 1.3 OCC pre-check before Write 1 (single and occurrence paths) returning `buildVersionConflictBody()` with zero writes
- [x] 1.4 Residual Write-2 409: `logger.error` + `Sentry.captureMessage` + `edit-request-approval-split` audit entry + message without a re-apply promise
- [x] 1.5 Rewrite the two legacy split-brain assertions (ERG-17 and 'partial failure' describe) and the stale 'supersede sweep' header comment

## 2. Submit identity (frontend)

- [x] 2.1 Failing test `useReviewModal.targetIdentity.test.jsx` (ETI-F1..F2): submit payload carries `eventObjectId` = opened `_id`; partial-failure message no longer promises re-apply
- [x] 2.2 Send `eventObjectId` beside `eventId`; message prefers the server's text

## 3. Re-open script (existing records)

- [x] 3.1 `backend/reopen-misrouted-edit-requests.js`: `--dry-run` / `--verify` / `--revert`, batch 25 + 1s, `retryWithBackoff` reads, progress bar only, `repair` marker with full BEFORE state, `edit-request-repaired` audit per request
- [x] 3.2 Suite `reopenMisroutedEditRequests.test.js` (RMR-1..10): dry run writes nothing; chronological union re-opened against production; already-in-production / past / deleted outcomes; idempotent re-run; revert restores and skips acted-on rows; re-opened request approved through the real endpoint lands on production
- [x] 3.3 Dry run against production and compare with the published review page

## 4. Rollout (manual, production)

- [ ] 4.1 Deploy backend + frontend (the script must NOT run before the deploy: the old approve path would re-route a re-opened request back to the sandbox copy)
- [ ] 4.2 `cd backend && node reopen-misrouted-edit-requests.js` then `--verify`
- [ ] 4.3 Approvers work the re-opened requests from the queue; `--verify` shows `reopenedAwaitingApproval` falling to 0
- [ ] 4.4 Archive this change; update `openspec/specs/edit-request-graph-sync/spec.md` from the delta
