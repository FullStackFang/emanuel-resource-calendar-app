# Proposal: Approver Event Reassignment + Clergy on Additional Information Tab

## Why

Assistants rotate which clergy member they support, so responsibility for an
already-submitted event routinely moves from one assistant to another (e.g.
Emily to Jeannette). Today `roomReservationData.requestedBy` — the canonical
ownership field driving My Reservations, withdraw permissions, and notification
routing — can only be set at submission time, so approvers have no way to hand
an event to the new assistant. Separately, approvers reviewing the Additional
Information tab must jump back to the Event Details tab to adjust clergy
assignments, which is where they are already doing this kind of housekeeping.

## What Changes

- New approver-gated endpoint `PUT /api/admin/events/:id/reassign` that
  performs a full ownership transfer: replaces
  `roomReservationData.requestedBy` with the picked user's identity (name,
  email, userId, department, phone), under optimistic concurrency control.
- Ownership transfer is recorded in the event audit history and the **new
  owner only** is notified by email. The original submitter remains visible in
  audit history; the Submitter Information grid shows the current owner.
- Any non-deleted status (`draft`, `pending`, `published`, `rejected`) is
  reassignable.
- New "Reassign" control in the Submitter Information section of the
  Additional Information tab, visible only to users with
  `canApproveReservations`. Target picker lists all registered users (existing
  `GET /api/users`, already approver-gated), excluding the current owner.
  Commit uses the standard in-button confirmation pattern.
- The Additional Information tab also renders the same `⛪ Clergy` button and
  summary row as the Event Details tab (redundant by design), reusing the
  already-mounted `ClergySelectorModal` and the existing
  `assignedRabbi`/`assignedCantor` form state. Saves through the normal form
  flow; no backend change.

## Capabilities

### New Capabilities

- `event-reassignment`: Approver-initiated transfer of event ownership
  (`requestedBy`) to another registered user — endpoint, permission gate, OCC,
  audit trail, new-owner email, and the Additional Information tab UI control.
- `additional-info-clergy`: Redundant clergy assignment access (button +
  summary) on the Additional Information tab, mirroring the Event Details tab
  control and sharing its state.

### Modified Capabilities

<!-- none — no existing spec's requirements change -->

## Impact

- **Backend**: `backend/api-server.js` (new reassign endpoint),
  `backend/services/emailService.js` + `emailTemplates.js` (reassignment
  notification), audit history write via existing
  `templeEvents__EventAuditHistory` pattern, `conditionalUpdate()` from
  `utils/concurrencyUtils.js`.
- **Frontend**: `src/components/RoomReservationFormBase.jsx` (Submitter
  Information section + clergy button/summary on the additional tab), a new
  reassign picker component, `src/hooks/usePermissions.js` consumers
  (no new permission flag — reuses `canApproveReservations`).
- **Data**: no schema change; `roomReservationData.requestedBy` values are
  rewritten in place. Ownership queries (`requestedBy.email`) immediately
  reflect the transfer — the event moves between users' My Reservations lists.
- **Tests**: backend endpoint suite (Jest), frontend component tests (Vitest)
  for gate visibility, picker exclusion, and confirm flow.
