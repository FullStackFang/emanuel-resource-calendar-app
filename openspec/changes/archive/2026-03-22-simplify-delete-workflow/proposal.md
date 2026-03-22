## Why

The event removal workflow has two overlapping statuses — `cancelled` and `deleted` — that do essentially the same thing (soft-remove with restore). `cancelled` is owner-only, pending-only, requires a reason. `deleted` is admin-only, any status, no reason required. Both are restorable via `statusHistory[]`. This redundancy adds state machine complexity, extra UI states, and extra test surface for no meaningful UX benefit. The audit trail in `statusHistory` already captures who did it, why, and when.

Additionally, only admins can delete events. Approvers — who can publish and reject — cannot remove a published event they accidentally approved or that needs to come down. They must escalate to an admin for what is ultimately a reversible soft-delete.

## What Changes

- **Remove `cancelled` status**: Collapse into `deleted`. The cancel endpoint is removed; its functionality merges into the delete path. Existing `cancelled` events migrated to `deleted`.
- **Expand approver delete permissions**: Approvers can delete their own events (any status) and any published event (to take down live events). They still cannot delete other people's pending/rejected/draft events — only admins can do that.
- **Require reason when owner deletes own pending event**: Preserves the UX intent of the old cancel flow (requester explains why they're withdrawing).
- **Notification on third-party delete**: When an approver/admin deletes someone else's event, the requester receives a notification.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `event-delete`: Approver role gains delete access (own events any status + any published event). Reason required when owner deletes own pending. Notification sent on third-party deletes.
- `event-status-machine`: `cancelled` status removed. State machine simplifies to: draft | pending | published | rejected | deleted.

## Impact

- **Backend**: `api-server.js` (delete endpoint permission change, cancel endpoint removal), `permissionUtils.js` / `authUtils.js` (no change — uses existing `canApproveReservations`), email notification on third-party delete
- **Frontend**: `MyReservations.jsx` (cancel button becomes delete, remove cancelled tab/filter), `ReviewModal.jsx` (cancel action removed, delete button for approvers), `EventManagement.jsx` (no change — already has delete), `ReservationRequests.jsx` (delete button for approvers on published events)
- **Database migration**: `status: 'cancelled'` → `status: 'deleted'` for existing events, rename `cancelReason`/`cancelledAt`/`cancelledBy` fields in `roomReservationData`
- **Tests**: Cancel-specific tests rewritten as delete tests, new tests for approver delete permissions and scoping
