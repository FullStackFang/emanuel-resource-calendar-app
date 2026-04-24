## 1. Backend query scoping

- [x] 1.1 Add `eventType: { $nin: ['exception', 'addition'] }` to the base query for `view === 'approval-queue'` in `GET /api/events/list` (backend/api-server.js:7003-7028)
- [x] 1.2 Add the same filter to every `countDocuments` call in the `view === 'approval-queue'` branch of `GET /api/events/list/counts` (backend/api-server.js:7358-7403), including the `needsAttentionQuery`
- [x] 1.3 Add the same filter to the base query for `view === 'my-events'` in `GET /api/events/list` (backend/api-server.js:6975-7001)
- [x] 1.4 Add the same filter to every `countDocuments` call in the `view === 'my-events'` branch of `GET /api/events/list/counts` (backend/api-server.js:7339-7356)
- [x] 1.5 Invalidate `countsCache` entry for `approval-queue` (and the per-user `my-events` entries) on deploy / confirm existing invalidation on next write triggers eventual convergence within 60s TTL

## 2. Backend write-side guards

- [x] 2.1 Extend the `eventType === 'occurrence'` check in `PUT /api/admin/events/:id/publish` (backend/api-server.js:19020) to also reject `'exception'` and `'addition'`. Return HTTP 400 with `code: 'INVALID_TARGET_EVENT_TYPE'` and an error message pointing to the series master
- [x] 2.2 Add a symmetric guard to `PUT /api/admin/events/:id/reject` immediately after the status-pending check (backend/api-server.js:19548). Return the same 400 shape for `'occurrence' | 'exception' | 'addition'`
- [x] 2.3 Ensure both guards run BEFORE any Mongo write or side effect (no status change, no Graph call, no audit log insert)

## 3. Mirror guards in test app

- [x] 3.1 Update `backend/__tests__/__helpers__/testApp.js` publish handler to apply the same eventType guard, matching the production response shape
- [x] 3.2 Update the testApp reject handler identically
- [x] 3.3 Update any testApp list/counts handlers for approval-queue and my-events to include the `$nin` filter so integration tests observe production behavior

## 4. Integration tests — read side

- [x] 4.1 New test file `backend/__tests__/integration/events/queueScoping.test.js`
- [x] 4.2 Test QS-1: pending series master with two exception children → `GET /api/events/list?view=approval-queue&status=pending` returns 1 event (master only)
- [x] 4.3 Test QS-2: pending series master with one addition child → approval-queue list returns 1 event
- [x] 4.4 Test QS-3: pending `singleInstance` event → approval-queue list returns 1 event (negative case ensuring filter isn't over-broad)
- [x] 4.5 Test QS-4: legacy pending event with no eventType field → approval-queue list still returns it
- [x] 4.6 Test QS-5: approval-queue counts match list length (pending count = 1 for a master with 2 children)
- [x] 4.7 Test QS-6: needsAttention count does not double-count on children when master + children all carry `pendingEditRequest.status: 'pending'`
- [x] 4.8 Test QS-7: requester's pending series with 3 exception children → `GET /api/events/list?view=my-events&status=pending` returns 1 event
- [x] 4.9 Test QS-8: requester's published series with 2 exception children → `my-events?status=published` returns 1; counts.published === 1

## 5. Integration tests — write side

- [x] 5.1 Test QS-9: `PUT /api/admin/events/<exceptionId>/publish` → 400 with `code: 'INVALID_TARGET_EVENT_TYPE'`, master status unchanged, child status unchanged
- [x] 5.2 Test QS-10: `PUT /api/admin/events/<additionId>/publish` → 400 with `code: 'INVALID_TARGET_EVENT_TYPE'`
- [x] 5.3 Test QS-11: `PUT /api/admin/events/<exceptionId>/reject` → 400 with `code: 'INVALID_TARGET_EVENT_TYPE'`, no state change
- [x] 5.4 Test QS-12: `PUT /api/admin/events/<additionId>/reject` → 400 with `code: 'INVALID_TARGET_EVENT_TYPE'`
- [x] 5.5 Test QS-13: `PUT /api/admin/events/<masterId>/publish` still returns 200 and cascades to children (regression guard — confirm existing cascade unbroken)
- [x] 5.6 Test QS-14: `PUT /api/admin/events/<masterId>/reject` still returns 200 and cascades rejection to children (regression guard)

## 6. Verify existing tests still pass

- [x] 6.1 Run `cd backend && npm test -- recurringPublish.test.js` — 23 pre-existing failures unrelated to this change; RP-21 assertion updated to match new error shape (code/eventType); no new regressions
- [x] 6.2 Run `cd backend && npm test -- exceptionDocumentSave.test.js exceptionDocumentDelete.test.js` — save all pass; delete has 1 pre-existing failure unrelated to this change
- [x] 6.3 Run `cd backend && npm test -- approvalQueueCounts.test.js` — all 9 pass; no fixture creates exception/addition children
- [x] 6.4 Run `cd backend && npm test -- approverAccess.test.js` — all pass

## 8. Shared event-list projection (follow-up fix)

- [x] 8.1 Rename `CALENDAR_VIEW_PROJECTION` → `EVENT_LIST_PROJECTION` at backend/api-server.js:5774 and extend it with the fields the existing `/api/events/list` inline projection had but the calendar projection lacked: `calendarName`, `sourceCalendars`, `lastSyncedAt`, `draftCreatedAt`, `lastDraftSaved`
- [x] 8.2 Update the `unifiedEventsCollection.find(...).project(...)` call in `getUnifiedEvents` (backend/api-server.js:5902) to reference the renamed constant
- [x] 8.3 Replace the inline projection block at backend/api-server.js:7206 in `GET /api/events/list` with `EVENT_LIST_PROJECTION` so all four views (my-events, approval-queue, admin-browse, search) receive the same shape as Calendar
- [x] 8.4 Add regression test QS-15: open the approval-queue list with a pending seriesMaster having recurrence; assert the response event includes `recurrence.pattern.type === 'daily'` and `recurrence.range.startDate` matching the stored document
- [x] 8.5 Add regression test QS-16: open the my-events list with the same seriesMaster; assert the same recurrence fields propagate
- [x] 8.6 Verify the existing `approvalQueueCounts.test.js` and `queueScoping.test.js` suites still pass after the projection change

## 9. Shared exception enrichment helper (follow-up fix #2)

- [x] 9.1 Add `enrichSeriesMastersWithOverrides(collection, events, { log })` helper to `backend/utils/exceptionDocumentService.js`. Uses full-document query (no projection) and falls back to top-level `INHERITABLE_FIELDS` when nested `overrides` is empty/missing
- [x] 9.2 Export the helper from `exceptionDocumentService.js` module
- [x] 9.3 Replace the inline secondary-query enrichment at `backend/api-server.js:7248-7279` (`GET /api/events/list`) with a call to the helper
- [x] 9.4 Replace the inline enrichment at `backend/api-server.js:6481-6531` (`POST /api/events/load`) with a call to the helper; remove the now-dead `...(eventType === 'seriesMaster' && ...)` spread from `transformedLoadEvents.map`
- [x] 9.5 Add unit tests EDS-27 through EDS-34 in `backend/__tests__/unit/utils/exceptionDocumentService.test.js` covering: empty array, no masters, single exception, multiple children, cross-master filter, fallback path, soft-deleted skip, log callback
- [x] 9.6 Add integration tests QS-17 through QS-20 in `backend/__tests__/integration/events/queueScoping.test.js` covering: approval-queue spread, my-events spread, multi-child grouping, legacy-shape fallback
- [x] 9.7 Verify no new regressions in the existing regression batch (recurringPublish, exceptionDocumentSave, exceptionDocumentDelete, approvalQueueCounts, approverAccess, eventById)

## 7. Documentation

- [x] 7.1 Update `CLAUDE.md` "Current In-Progress Work" or move this change under "Completed Architectural Work" on archive
- [x] 7.2 Add a short note to the "Exception-as-Document Architecture" section of CLAUDE.md stating that children are intentionally hidden from approval-queue/my-events and that publish/reject must target the master
