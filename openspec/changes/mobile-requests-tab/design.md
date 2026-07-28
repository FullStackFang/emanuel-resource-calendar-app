## Context

The mobile shell (`MobileApp.jsx`) renders three tabs. Only `calendar` has real
content; `my-events` and `chat` return a hard-coded "Coming soon" block. That
placeholder is not an oversight — it is a shipped requirement in
`openspec/specs/mobile-app-shell/spec.md`.

The App Store / Play Store plan is still live, which makes the placeholder a
liability rather than a neutral gap: an app whose only signed-in capability is a
read-only calendar is the standard Apple guideline 4.2 rejection.

Existing pieces this change builds on, all already shipped:

- `MobileEventCard.jsx` (42 lines) — status dot, time, title, location line
- `MobileEventDetail.jsx` (285 lines) — the read-only bottom sheet
- `STATUS_MAP` in `mobileConstants.js` — status → color for all five statuses
- `deriveListLoadingState()` — the tested definition of first-load vs silent refresh
- `EmptyStateRefreshButton` — the standard blank-state recovery affordance
- `GET /api/events/list?view=my-events`, its `/counts` sibling, and
  `DELETE /api/admin/events/:id` — all already scope to the requester

## Goals / Non-Goals

**Goals:**

- Replace the `my-events` placeholder with a real, useful view at the lowest
  possible cost — no new endpoints, no data-model change.
- Give staff away from a desk the answer to "did my request go through?"
- Clear the Apple 4.2 "minimum functionality" bar with a genuine signed-in
  capability.
- Establish the naming and permission-gating pattern the later Approvals tab
  will slot into.

**Non-Goals:**

- The Approvals tab. Deferred to its own change (see Decision 5).
- The five-step reservation request wizard. Cut, not deferred.
- Any editing on mobile.
- Guest mode and the public events endpoint — separate capability.
- Push notifications.

## Decisions

### Decision 1: Build the tab rather than delete it

The alternative considered was deleting `my-events` and `chat` outright, leaving
a single-view mobile app. Rejected because the store plan is live: removing the
tab does not simplify the app so much as remove the reason it can exist in a
store at all.

The cost comparison is what settles it. Requests is a card list plus a detail
sheet plus one button, against an endpoint that already exists, rendered by two
components that already exist. It is the cheapest item in the mobile backlog.

### Decision 2: Label it `Requests`, not `Queue`

`Queue` was the initial proposal. Rejected on a direct collision:

- `Navigation.jsx:150` labels the approver's desktop nav link **"Approval Queue"**
- `Navigation.jsx:41` fetches counts with `view=approval-queue`
- `ReservationRequests.jsx` ships `patchApprovalQueueLists()` in production

In this codebase and in every user's existing mental model, "queue" names the
approver's inbox. It is also semantically inverted: a queue holds work waiting
on *you*, while this tab holds work waiting on *someone else*.

`Requests` keeps the succinctness that motivated `Queue` while pairing with a
future `Approvals` tab as two halves of one workflow — the request you made, the
approvals you owe. Alternatives `My Requests` (unambiguous, but the only
two-word label in the bar) and `Reservations` (most faithful to the data model,
but widest, and without "My" it reads as *all* reservations) were considered and
set aside.

### Decision 3: Change the label, not the identifier

The tab id stays `my-events`. Renaming it would cascade into `view=my-events`,
`keys.events.list({ view: 'my-events' })`, the counts endpoint, and three
existing test suites, for zero user-visible benefit.

This is worth stating as a requirement rather than leaving as an implementation
habit, because the natural instinct when relabeling is to rename everything.

### Decision 4: Extend the existing bottom sheet; do not build a second detail view

`openspec/specs/mobile-event-detail/spec.md` already establishes the detail view
as a bottom sheet — max 85dvh, drag-to-dismiss, read-only. Requests reuses it
with reservation-specific sections appended, rather than introducing a
full-screen push navigation for the same job.

Consequence: the sheet's "all fields are read-only" requirement must be modified
rather than merely extended, since withdraw is its first mutating action. The
modification keeps read-only for *fields* while permitting a status action, and
adds an explicit scenario that no edit affordance exists on any viewport — so
the boundary is spec'd rather than assumed.

The status timeline is the one element that is genuinely better on a phone: a
tall narrow viewport suits a chronology, where the desktop modal buries
`statusHistory[]`.

### Decision 5: Phase Approvals separately

Requests ships first, alone. Approvals gets its own change once Requests has run
on a real device.

Rationale: Requests needs no new endpoints and no new interaction patterns,
while Approvals needs mobile treatments for conflict presentation, forced-reason
rejection, and OCC recovery. Bundling them would gate a one-day change behind a
multi-day one.

When Approvals is specced it should be **triage, not adjudication** — who asked,
what, when, where, does it collide; approve and reject-with-reason; anything
requiring a change sends the user to desktop. It should reuse
`useEventReviewExperience` / `useCurrentUserGates` rather than the desktop
`EventReviewExperience` component.

### Decision 6: A mobile 409 is a message, not a dialog

The desktop `ConflictDialog` has three modes and renders a field-level diff. It
earns that complexity on a wide screen. On a phone the honest response to
`409 VERSION_CONFLICT` is "this request was already handled", close the sheet,
refetch the list.

Knowing which desktop affordances *not* to port is most of what makes the small
screen work.

### Decision 7: Cut the request wizard

Five steps, room feature filters, availability checking, capacity math, and
marker advisories. This is the piece that genuinely does not fit a phone, and
nobody composes a room request on one. The mobile Calendar can deep-link to the
desktop form instead. Removing it from scope also removes the
`mobile-reservation-request` capability drafted in the publishing proposal.

## Risks / Trade-offs

**Naming inversion in existing code** → `ReservationRequests.jsx` is the
*approver* component while `MyReservations.jsx` is the requester's. A new
component labeled `Requests` that is in fact the requester's view walks straight
into that trap. Mitigation: name the component `MobileRequests.jsx`, and carry a
header comment stating which side it serves.

**Modifying a read-only requirement** → adding withdraw to a sheet whose spec
says "all fields are read-only" risks the next contributor reading that as
permission to add editing. Mitigation: the modified requirement keeps the
read-only language for fields and adds an explicit "no edit affordance"
scenario.

**Empty-state flash** → this is the exact bug class the loading-primitives
convention exists to prevent, and a new list view is where it recurs.
Mitigation: bind `loading = isFirstLoad` from `deriveListLoadingState()`, never
`query.isLoading`, and lock it with a `firstPaint` test mirroring the three
existing suites.

**Two tabs may look sparse** → most users lack `canApproveReservations`, so the
common case is a two-tab bar. Accepted: two honest tabs beat three where one is
dead. The bar reflows to equal widths.

**Withdraw is destructive and now one tap closer** → mitigated by the in-button
confirmation standard with no auto-reset, the same pattern used everywhere else
in the app, plus a required reason.

## Migration Plan

No data migration. Deployment is a frontend-only change.

Rollback is a revert: the placeholder branches are deleted in one commit, so
restoring them restores prior behavior exactly. No backend or schema state is
touched, so a rollback cannot strand data.

## Open Questions

None blocking. The withdraw reason's input treatment (free-text vs. a short
preset list) is left to implementation; the spec requires only that a reason is
sent.
