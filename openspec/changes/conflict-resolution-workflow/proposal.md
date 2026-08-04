# Conflict resolution workflow

## Why

`recurring-publish-conflict-blocking` made the recurring conflict check
blocking: a series with a conflicted occurrence now gets a 409 instead of
publishing into a double-booking. That closed the incident, but it left the
approver at a dead end. The panel names the problem and offers nothing to do
about it, so the only paths out are to abandon the review or to force-override
as an admin — which is the double-booking the change was written to prevent.
The panel is also still dressed as the advisory notice it used to be, a green
or amber banner with a checkmark, which reads as information rather than as a
blocker.

Two smaller defects on the same surface are folded in because they are one
review-modal pass: the reassign picker is trapped in one column of a two-column
grid with an internal scrollbar, and the clergy summary renders only when
clergy are assigned, so an unassigned event is indistinguishable from one that
failed to load.

## What Changes

- **The conflict panel becomes a resolution surface.** The banner is replaced
  by an occurrence strip — one square per occurrence, so "which weeks are bad"
  is answerable without expanding anything — and clicking a conflicted square
  or date row opens a single inline drawer with the blocking event's full
  detail and its actions.
- **Two ways out of a conflict, from inside the drawer.** `Open blocking event`
  swaps the modal to that event so it can be moved; `Skip this date instead`
  excludes the occurrence from the series, which resolves the conflict without
  touching anyone else's booking.
- **Navigation gains a way back.** Opening a blocking event currently would be
  a one-way trip; there is no navigation stack anywhere in `useReviewModal`. A
  single-entry origin is recorded and a return bar renders at the top of the
  modal.
- **`navigateToEvent` learns a fallback.** It fetches
  `/api/room-reservations/:id`, which requires `roomReservationData` to exist.
  The conflict query matches published events synced from Outlook, which have
  no reservation block, so without a fallback to `GET /api/events/:id` the new
  action 404s on real data.
- **Conflict records carry the requester name.** They currently carry title,
  times, rooms, and status only. Who booked the blocking event is the fact that
  decides whether an approver can move it.
- **The reassign picker is rebuilt as a collapsed full-width combobox.** It
  spans the whole submitter grid, and the result list is capped rather than
  scrolled, so the scrollbar stops existing rather than being hidden.
- **The clergy summary is always rendered**, in the Submitter Information grid,
  showing N/A when nothing is assigned.

No breaking changes. New-browser-tab deep links for events were considered and
are explicitly out of scope: no route currently opens an event, so it is its
own change.

## Capabilities

### New Capabilities

- `conflict-resolution-actions`: what an approver can do about a conflicted
  occurrence from within the panel — open the blocking event, skip the date —
  including the `recurrence.exclusions` write path and the requester identity
  the drawer needs.
- `modal-return-navigation`: recording where a modal navigation came from and
  rendering the way back, so leaving the series review to fix a blocker is a
  round trip rather than a departure.
- `submitter-clergy-summary`: an always-present clergy display in the Submitter
  Information grid that distinguishes "nobody assigned" from "not shown".

### Modified Capabilities

- `recurring-conflict-visibility`: the presentation requirement changes from a
  status banner with an expandable list to an occurrence strip with a single
  resolution drawer, and the blocked state must read as a verdict rather than
  an advisory. Requirement "Per-occurrence conflict panel in the reservation
  form" is amended. Fetch stability and calendar-owner scoping are unaffected.
- `event-reassignment`: the requirement "Reassign control on the Additional
  Information tab" is amended for presentation only — collapsed at rest,
  full-width when open, capped result list with no internal scroll. The
  transfer semantics, permission gate, cascade, and audit behavior are
  unchanged.

## Impact

**Frontend**
- `src/components/RecurringConflictSummary.jsx` / `.css` — rebuilt around the
  strip and drawer.
- `src/hooks/useReviewModal.jsx` — origin ref, return context, and the
  `navigateToEvent` fetch fallback.
- `src/components/shared/ReviewModal.jsx` / `.css` — the return bar.
- `src/components/shared/ReassignOwnerControl.jsx` / `.css` — collapsed
  combobox; removes the `inset 3px 0 0` selected-row side-stripe, which the
  project design brief rejects.
- `src/components/RoomReservationFormBase.jsx` — clergy cell in the Submitter
  Information grid; the reassign control moves to a full-width grid cell.
- `src/components/RoomReservationForm.css` — full-span grid cell.

**Backend**
- `checkRecurringRoomConflicts()` in `backend/api-server.js` — requester name
  on both conflict push sites.
- A skip-occurrence write path onto `recurrence.exclusions`, reusing the
  exclusion maintenance that already runs on occurrence delete.

**Unaffected**
- The 409 contract from `recurring-publish-conflict-blocking`, including
  `conflictTier`, `canForce`, `forceField`, and the flattened `hardConflicts`
  shape. The force-publish affordance is untouched.
- Reassignment API semantics, and the Additional Information clergy control.
