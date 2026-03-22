## Context

The event state machine currently has 6 statuses: `draft`, `pending`, `published`, `rejected`, `cancelled`, `deleted`. The `cancelled` and `deleted` statuses are functionally identical — both are soft-removes restorable via `statusHistory[]`. The only differences are: cancel requires a reason, is owner-only, and only works on pending events. These constraints can be absorbed into the delete flow with conditional logic.

Delete is currently admin-only. Approvers — who can publish and reject events — cannot remove them. This creates an unnecessary escalation path for reversible operations.

## Goals / Non-Goals

**Goals:**
- Remove `cancelled` status entirely, simplifying the state machine to 5 statuses
- Allow approvers to delete their own events (any status) and any published event
- Preserve the cancel UX intent: when an owner deletes their own pending event, reason is required
- Notify requesters when someone else deletes their event
- Migrate existing `cancelled` events to `deleted`

**Non-Goals:**
- Changing the restore workflow (already works for `deleted`)
- Changing admin delete permissions (admins retain full delete on any event)
- Adding a `cancelled` display label in the UI (deleted is deleted)
- Changing the force-restore permission model (stays admin-only)

## Decisions

### 1. Approver delete scope: own events + any published

**Decision**: Approvers can delete:
- Their own events in any status
- Any published event regardless of owner

They cannot delete other people's draft/pending/rejected events.

**Rationale**: Approvers need to take down published events (mistakes, policy changes). Deleting other people's in-progress work (drafts, pending, rejected) would be overreach — those events are still in the requester's workflow. Admins retain unrestricted delete.

### 2. Reason field: required for owner-pending, optional otherwise

**Decision**: When the owner deletes their own pending event (the old 'cancel' flow), a reason is required. For all other deletes, reason is optional.

**Rationale**: Requesters withdrawing their own pending requests should explain why (audit trail, approver awareness). Admin/approver deletes of published events have different context — the reason is useful but not always necessary (e.g., duplicate event cleanup).

### 3. Notification on third-party delete

**Decision**: When an approver or admin deletes an event they don't own, send a notification to the requester.

**Rationale**: The requester should know their event was removed and by whom. Uses existing email notification infrastructure.

### 4. Migration approach for cancelled → deleted

**Decision**: Database migration script converts `status: 'cancelled'` to `status: 'deleted'`. The `roomReservationData.cancelReason` is preserved as-is (not renamed) since `statusHistory[]` already has the authoritative audit trail with the reason.

**Rationale**: Renaming nested fields in Cosmos DB is expensive (unset + set). The cancel fields become legacy but harmless. All new deletes use `statusHistory` for the reason. The migration focuses on the status value which is what queries and UI filter on.

### 5. Delete endpoint absorbs cancel logic

**Decision**: The `PUT /api/room-reservations/:id/cancel` endpoint is removed. The `DELETE /api/admin/events/:id` endpoint gains:
- Approver-level access (via `canApproveReservations` check with scoping logic)
- Optional `reason` field in request body
- Required reason validation when owner deletes own pending event
- Notification trigger when deleter !== owner

**Rationale**: One endpoint, one status, one code path. The permission scoping logic (own events vs published vs everything) lives in the endpoint handler.

## Key Architecture

### Updated State Machine

```
draft → pending → published → deleted
              ↘ rejected  ↗ → deleted
  draft ──────────────────────→ deleted

Restore: deleted → previous status (from statusHistory[])
```

5 statuses: `draft` | `pending` | `published` | `rejected` | `deleted`

### Delete Permission Matrix

```
                    Own Events          Other's Events
                    ─────────────────   ─────────────────
  Viewer            ✗                   ✗
  Requester         ✗                   ✗
  Approver          ✓ (any status)      ✓ (published only)
  Admin             ✓ (any status)      ✓ (any status)
```

### Delete Endpoint Logic (Pseudocode)

```
DELETE /api/admin/events/:id

1. Verify token, fetch user + permissions
2. Fetch event
3. Permission check:
   - isAdmin? → allowed (any event, any status)
   - canApproveReservations?
     - Is owner? → allowed (any status)
     - Event is published? → allowed
     - Else → 403
   - Else → 403
4. Reason validation:
   - Owner deleting own pending? → reason required
   - Otherwise → reason optional
5. Soft-delete:
   - Set status: 'deleted'
   - Push to statusHistory (with reason if provided)
   - If graphData.id exists → delete Graph event
6. Notification:
   - If deleter !== owner → send notification to requester
7. Audit log entry
```
