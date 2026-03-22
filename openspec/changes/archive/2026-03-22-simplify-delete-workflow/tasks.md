## 1. Backend: Expand Delete Endpoint Permissions

- [ ] 1.1 Change permission guard in `DELETE /api/admin/events/:id` from `isAdmin()` to scoped logic: admin (any), approver (own any status + any published), else 403
- [ ] 1.2 Add optional `reason` field to delete request body; require it when owner deletes own pending event
- [ ] 1.3 Store reason in `statusHistory` entry when provided
- [ ] 1.4 Write tests: approver deletes own draft, own pending, own published, own rejected (all pass); approver deletes other's published (pass); approver deletes other's pending/draft/rejected (403); admin deletes anything (pass); requester/viewer delete (403)

## 2. Backend: Remove Cancel Endpoint

- [ ] 2.1 Remove `PUT /api/room-reservations/:id/cancel` endpoint from `api-server.js`
- [ ] 2.2 Remove cancel endpoint from `testApp.js` if present
- [ ] 2.3 Remove or rewrite cancel-specific tests to use delete endpoint
- [ ] 2.4 Search codebase for any references to `/cancel` endpoint or `status: 'cancelled'` and update

## 3. Backend: Notification on Third-Party Delete

- [ ] 3.1 After successful delete, if acting user !== `roomReservationData.requestedBy.userId`, send notification email to requester
- [ ] 3.2 Add email template for 'event deleted by admin/approver' notification (include event title, who deleted, reason if provided)
- [ ] 3.3 Write tests: notification sent when approver deletes other's event, no notification when owner deletes own event

## 4. Frontend: Replace Cancel with Delete

- [ ] 4.1 In `MyReservations.jsx`: replace cancel button/action with delete (uses same in-button confirmation pattern, red confirm state)
- [ ] 4.2 In `ReviewModal.jsx`: remove cancel-specific props and logic, wire delete button for pending events (with reason input when owner)
- [ ] 4.3 In `useReviewModal.jsx`: remove cancel handler, update delete handler to accept optional reason
- [ ] 4.4 Remove any 'Cancelled' tab/filter from `MyReservations.jsx` — cancelled events now show under 'Deleted'
- [ ] 4.5 Remove `cancelled` from status badge rendering, CSS classes, and filter logic across all components

## 5. Frontend: Approver Delete Button

- [ ] 5.1 In `ReviewModal.jsx`: show delete button for approvers (not just admins) with correct scoping — own events any status, other's published only
- [ ] 5.2 In `ReservationRequests.jsx` (approval queue): add delete action for approvers on published events if not already present
- [ ] 5.3 Ensure delete button uses existing in-button confirmation pattern (red confirm state, 3s auto-reset)

## 6. Database Migration

- [ ] 6.1 Create `backend/migrate-cancelled-to-deleted.js`: update all `status: 'cancelled'` → `status: 'deleted'` with batch processing, --dry-run, --verify flags
- [ ] 6.2 Migration should also push a `statusHistory` entry noting the migration (changeType: 'migration', reason: 'cancelled status removed')
- [ ] 6.3 Run with --dry-run to verify count, then apply

## 7. Cleanup and Verification

- [ ] 7.1 Search entire codebase for remaining references to 'cancelled' status and remove/update
- [ ] 7.2 Update any status enum/constant arrays to remove 'cancelled'
- [ ] 7.3 Run full backend test suite — verify all pass
- [ ] 7.4 Run full frontend test suite — verify all pass
