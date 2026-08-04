# Design: Approver Event Reassignment + Clergy on Additional Information Tab

## Context

`roomReservationData.requestedBy` (name, email, department, phone, userId) is
the canonical ownership field: `/api/events/list?view=my-events` filters on
`requestedBy.email`, withdraw permission for pending requests checks it, and
every notification path (approval, rejection, deletion) routes to it. It is
written once at submission and never editable afterwards.

The Additional Information tab of `RoomReservationFormBase` shows a read-only
"Submitter Information" grid (requester, on-behalf-of, submitted, approved-by,
last-updated). The Event Details tab has a `⛪ Clergy` button opening
`ClergySelectorModal`, which writes the `assignedRabbi` / `assignedCantor`
multiselect arrays; the modal is mounted once at the component root.

Existing write-endpoint conventions this design follows (see the
cancellation-request endpoint around `api-server.js:24404` for the canonical
sequence): `conditionalUpdate()` with `expectedVersion` + `CONFLICT_SNAPSHOT_FIELDS`,
best-effort `auditHistoryCollection.insertOne`, fire-and-forget email via
`emailService`, then `broadcastEventChange` SSE.

## Goals / Non-Goals

**Goals:**

- Let approvers transfer full ownership of an event to another registered
  user, from the Additional Information tab, with audit trail and new-owner
  notification.
- Give approvers clergy-assignment access on the Additional Information tab
  without leaving it (redundant with Event Details by design).

**Non-Goals:**

- No bulk reassignment ("move all of Emily's events") — one event at a time.
  Bulk is a plausible follow-up but needs its own UX.
- No self-service transfer by requesters; the gate is `canApproveReservations`.
- No Graph API sync: `requestedBy` is app-side metadata and appears nowhere in
  the Graph event payload, so reassignment never touches Outlook.
- No change to the on-behalf-of (`contactName`/`isOnBehalfOf`) fields — those
  describe who the event is *for*, not who manages it.
- No new permission flag; reuses `canApproveReservations`.

## Decisions

### D1: Dedicated endpoint, not the form-save path

`PUT /api/admin/events/:id/reassign` with body
`{ targetUserId, expectedVersion }`. Rejected alternative: making
`requestedBy` an editable form field carried by the general
`PUT /api/admin/events/:id` save. Ownership transfer as a save side effect is
invisible, hard to audit/notify from a generic diff, and a stale form could
silently revert a transfer. A dedicated endpoint also scopes OCC conflicts to
the one field being changed.

### D2: Server resolves the target identity

The client sends only `targetUserId`. The server loads the user from
`templeEvents__Users` and builds the new `requestedBy` block (name, email,
department, phone, userId) from that record. Rejected alternative: client
posts a full identity object — that invites typo'd or spoofed emails, and
email is the join key for every ownership query.

### D3: Guards

- 403 unless `canApproveReservations(caller)` (approver or admin).
- 404 if event or target user not found.
- 400 `EVENT_DELETED` if `status === 'deleted'` or `isDeleted`.
- 400 `ALREADY_OWNER` if target email equals current `requestedBy.email`
  (case-insensitive) — mirrors the picker's client-side exclusion.
- 409 via `conditionalUpdate` on version mismatch (standard `VERSION_CONFLICT`
  shape).
- Children (`exception`/`addition` docs) are not independently reassignable:
  400 `INVALID_TARGET_EVENT_TYPE`, same rule as publish/reject. Reassigning a
  series master cascades the new `requestedBy` to every non-deleted child —
  children snapshot the master's `roomReservationData` at creation
  (`exceptionDocumentService.js:181,224`), so without a cascade they would
  keep the stale owner. Same shape as the existing `cascadeStatusUpdate`
  pattern; child updates are plain `updateMany` (children are not
  independently versioned for this field and are hidden from ownership-scoped
  lists anyway).

### D4: Write sequence (mirrors existing endpoints)

1. `conditionalUpdate` `$set`ing `roomReservationData.requestedBy`,
   `lastModifiedDateTime`, `lastModifiedBy`.
2. Best-effort audit entry: `action: 'ownership-reassigned'`, metadata
   `{ from: {name,email}, to: {name,email} }`. Audit failure logs a warning,
   never fails the request.
3. Fire-and-forget `emailService.sendReassignmentNotification(event, newOwner,
   reassignedByName)` — **new owner only** (previous owner rotated off; the
   handoff is coordinated offline). New template in `emailTemplates.js`
   following the existing notification look.
4. `broadcastEventChange` SSE so both users' My Reservations lists refresh
   live (the event appears in the new owner's list and leaves the old one via
   the normal query invalidation).

`statusHistory` is untouched — status does not change; the audit collection is
the record of the transfer.

### D5: UI — Reassign control in Submitter Information

In the Submitter Information grid, the Requester cell gains an approver-only
"Reassign" affordance. Clicking it reveals a searchable user picker
(name + email) fed by `GET /api/users` — already gated to approvers/admins, so
the picker's data source and the button's visibility gate agree. The current
owner is excluded from the list. Commit follows the in-button confirmation
standard: "Reassign" → "Confirm?" (neutral `--color-warning-500`, pulse) →
"Reassigning...", then `showSuccess` toast. On 409 the UI shows a one-line
error and refetches — a full `ConflictDialog` is unnecessary for a
single-field action (same simplification the mobile withdraw flow made).

Visibility uses `canApproveReservations` passed into
`RoomReservationFormBase` from `RoomReservationReview` (which already receives
permission props via `EventReviewExperience`); the derived-flag computation
stays in `EventReviewExperience` per its contract.

The picker fetch happens lazily on first open (not on form mount) so the
approver-gated `/api/users` call never fires for non-approvers or unused
sessions.

### D6: Clergy on the Additional Information tab

Render a second `⛪ Clergy` button plus the existing summary row inside the
Additional Information section, wired to the same `setShowClergyModal(true)`
and the same `assignedRabbi`/`assignedCantor` state. The modal instance stays
single-mounted at the component root, so both tabs cannot drift. Clergy
changes save through the normal form flow — this decision adds zero backend
surface.

## Risks / Trade-offs

- [Old owner keeps an open form referencing an event reassigned away] → next
  save fails OCC (version bumped) or ownership-scoped endpoints 403; both are
  existing, understood failure modes.
- [Target user record missing email] → endpoint 400s
  (`TARGET_USER_INCOMPLETE`) rather than writing an ownership block that no
  query can match.
- [`GET /api/users` returns full read models (heavier than picker needs)] →
  acceptable at this org's user count; a projected picker endpoint is a
  premature optimization.
- [Redundant clergy control confuses users about "where clergy lives"] →
  deliberate and requested; both controls share one state so they can never
  disagree.
- [Reassignment email adds a new template to maintain] → template reuses the
  existing header/footer builders in `emailTemplates.js`.

## Open Questions

None — resolved during brainstorming (full ownership transfer; any registered
user; notify new owner only; any non-deleted status).
