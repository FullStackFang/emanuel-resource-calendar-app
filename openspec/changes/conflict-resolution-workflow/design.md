# Design: Conflict resolution workflow

## Context

`RecurringConflictSummary` mounts in `RoomReservationFormBase` below the
SchedulingAssistant whenever an active recurrence has a pattern, a range, and
at least one room. It POSTs to `/rooms/recurring-conflicts` and renders a
banner. Since `recurring-publish-conflict-blocking`, a non-zero
`conflictingOccurrences` also causes `PUT /api/admin/events/:id/publish` to
return 409, so the panel now describes a hard blocker while still looking like
an advisory.

Three facts about the existing code shape this design more than anything in the
mockups:

1. **The panel's fetch effect is keyed on a serialized request signature that
   already includes `recurrence`** (`RecurringConflictSummary.jsx:117`). Any
   change to the recurrence object re-runs the conflict check automatically.
2. **`recurrence.exclusions` already flows through the normal form save path.**
   `PUT /api/admin/events/:id` accepts `updates.recurrence`, detects restored
   dates via `exclusionsRemoved()`, and syncs exclusions to Graph on publish and
   restore. Occurrence delete writes to the same array.
3. **`navigateToEvent(target)` already accepts a bare ID string**
   (`useReviewModal.jsx:472`), cold-fetches it, and swaps modal contents without
   unmounting the portal. What it lacks is any notion of where it came from.

The panel renders while the series is still `pending`. That is the whole point:
the block happens at publish, before any Graph series exists.

## Goals / Non-Goals

**Goals:**
- An approver who hits the block can resolve it without leaving the review, or
  can leave and come back.
- The panel answers "which occurrences" before anything is expanded.
- The blocked state reads as a verdict, not as a notice.
- Skipping a date does not require touching another department's booking.

**Non-Goals:**
- Deep-linking an event to a URL or opening one in a new browser tab. No route
  opens an event today; that is its own change.
- Editing the blocking event inline. Opening it navigates to the real form.
- Changing the 409 contract, the force-publish affordance, or any conflict
  detection semantics. This change adds one field to the conflict payload and
  otherwise consumes what already exists.
- Bulk resolution ("skip all conflicted dates"). Each date is decided on its
  own; a blanket skip is the kind of thing that quietly shrinks a series.

## Decisions

### D1: "Skip this date" is a form-state mutation, not a new endpoint

Adding the occurrence date to `formData.recurrence.exclusions` and marking the
form dirty is the entire mechanism. The existing save path already persists
exclusions and syncs them to Graph, and the panel's signature-keyed effect
re-runs the conflict check the moment the recurrence changes, so the strip
updates with no explicit refetch call.

*Alternatives considered.* A dedicated `POST /api/admin/events/:id/skip-occurrence`
endpoint was the obvious first shape. Rejected: it would write the same field
the form is already holding in memory, so a panel write plus an unsaved form
would immediately disagree about the recurrence, and the next form save would
clobber the panel's write. Reusing the occurrence-delete path was also
rejected — it soft-deletes an exception document and cascades, which is a much
larger action than "this week does not meet."

*Consequence.* A skip is not persisted until the user saves. The panel must not
present it as done. It renders as excluded but pending, and the copy says so.
This is honest and it matches how every other form edit in this modal behaves.

*Consequence.* Skip is unavailable when `fieldsDisabled` is true. A read-only
viewer cannot change the recurrence, so the drawer offers only navigation.

### D2: One drawer open at a time

The drawer is an accordion, not a set of independently expandable rows. A
series with eight conflicted dates would otherwise expand to an unreadable
column inside a modal that already scrolls. Opening a second drawer closes the
first.

### D3: One-entry origin, not a navigation stack

`useReviewModal` records a single `navigationOrigin` when a navigation happens
from the conflict panel: the originating event, its title, and the outstanding
conflict count for the return bar's context line. Navigating again replaces the
origin rather than pushing onto it.

*Rationale.* The workflow is one hop deep: series, blocker, back. A stack would
add unbounded state and a "back through five events" behavior nobody asked for,
in a modal that holds exactly one form. If a genuine multi-hop need appears,
promoting one ref to an array is a contained change.

*Consequence.* Navigating from a blocking event to a third event loses the
series origin. Acceptable, and the return bar disappearing is the honest signal
that it happened.

### D4: `navigateToEvent` falls back rather than switching wholesale

The primary fetch stays `/api/room-reservations/:id`. On 404, it retries
against `GET /api/events/:id` and adapts the result.

*Rationale.* The room-reservations endpoint returns an already-transformed
reservation shape the modal is built around, and it is what the existing
series-master navigation depends on. Switching every navigation to
`/api/events/:id` would change behavior for a path that works today, to fix a
path that does not exist yet.

*Why the fallback is mandatory, not defensive.* `checkRecurringRoomConflicts`
matches published events broadly, including ones synced from Outlook that carry
no `roomReservationData`. The room-reservations endpoint requires that field,
so without the fallback the new action 404s against exactly the kind of
blocking event this workflow exists to surface.

### D5: Navigation respects the existing dirty guard

`ReservationRequests.handleLockedEventClick` already routes a navigation with
unsaved changes through `pendingNavTarget` and `DiscardChangesDialog`. Opening
a blocking event uses the same path.

This matters more here than it does for locked-event clicks, because a user who
just clicked "Skip this date" has a dirty form by construction. Skip and open
are alternative resolutions for one occurrence, not steps in a sequence, and
the guard is what makes choosing the second one after the first non-destructive.

### D6: The conflict payload gains a name, not an identity block

Both push sites in `checkRecurringRoomConflicts` add
`requestedBy: conflict.roomReservationData?.requestedBy?.name || null`. Not the
email, phone, or userId.

*Rationale.* The drawer's question is "can I move this, and whose is it" — a
name answers it. The panel is reachable by any approver for any conflicting
event in the building, which makes it a wider audience than the event's own
review screen; there is no reason for it to be a contact-details disclosure
surface. Events with no reservation block (Outlook-synced) yield `null`, which
the drawer renders as an Outlook badge rather than a name.

### D7: Clergy is read-only in Submitter Information

The Submitter Information grid gets a display-only clergy cell. The editable
control stays where it is, on Additional Information.

*Rationale.* Submitter Information is the read-only facts grid — requester,
submitted, approved by, last updated. The `additional-info-clergy` capability
deliberately allows exactly two clergy controls that share one modal instance
and one pair of form arrays; a third editable entry point would widen that
contract for no stated need. The gap being fixed is a display gap: an
unassigned event currently renders nothing, which is indistinguishable from a
load failure.

The cell renders one chip per person with a role label, and `N/A` when both
arrays are empty.

### D8: The result list is capped, not scrolled

The reassign combobox renders at most five matches and, when more match,
a line stating how many are hidden and that typing narrows them. The list has
no `max-height` and no `overflow`.

*Rationale.* The complaint was the scrollbar, and hiding it with
`overflow: hidden` would silently truncate. A cap plus a count is the same
screen real estate, tells the truth, and makes typing the way forward — which
is what a directory search should reward anyway.

The control also collapses to a link at rest and spans `grid-column: 1 / -1`
when open, so it is not competing for half a grid column while a user reads a
16-person list.

### D9: The strip degrades above a threshold

The occurrence strip is one square per occurrence, wrapping. A weekly series
over three years is 156 squares, which wraps to roughly seven rows.

Squares shrink by one step above 60 occurrences. Above 150, the strip is
replaced by a compact summary line and the conflict list renders on its own.
The strip's value is glanceable position within the series; past a certain
density it stops being glanceable and starts being wallpaper.

## Risks / Trade-offs

- **A skip looks resolved but is not saved.** → The strip's skipped state and
  the drawer copy both say pending until saved, and the publish gate continues
  to reflect the server's view, not the panel's.

- **Skipping every occurrence produces an empty series.** → The panel refuses
  the last remaining occurrence and says so. The recurrence editor remains the
  place to shorten or cancel a series properly.

- **The dirty guard makes "open blocking event" feel obstructive after a
  skip.** → Accepted. Discarding an unsaved exclusion silently would be worse,
  and the dialog names what would be lost.

- **The requester name widens who sees whose booking.** → Names only, and only
  for events that already block the viewer's own publish. An approver who can
  see the conflict can already see the event on the calendar.

- **`/api/events/:id` returns a different shape than the reservation
  endpoint.** → The fallback adapts at the boundary in `navigateToEvent`, so
  every downstream consumer keeps receiving the shape it already handles. The
  adapter is the one place that needs a test for shape parity.

- **The panel becomes a mutation surface.** It used to be pure display. → The
  only mutation is to form state, through the same `setFormData` +
  `setHasChanges` + `notifyDataChange` sequence every other control in the form
  uses. No new persistence path exists to diverge.

## Migration Plan

No data migration, no schema change, no API contract change. `requestedBy` is
an additive field on a response body that is consumed in one place.

Deploy is frontend plus one backend function. Rollback is a revert; a client
running the previous bundle against the new backend simply ignores the extra
field.

## Open Questions

- The exact occurrence-count thresholds in D9 (60 and 150) are chosen from
  layout arithmetic, not from data about real series lengths. Worth revisiting
  once the panel has been seen against the longest series actually in the
  building.
