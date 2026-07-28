## Why

The mobile shell ships three tabs, but two of them (`my-events`, `chat`) render a
hard-coded "Coming soon" placeholder. With App Store and Google Play publishing
still planned, a native app whose only signed-in capability is a read-only
calendar is the textbook Apple guideline 4.2 rejection — and a visible dead tab
is worse than no tab, because reviewers see it.

The cheapest fix is also the most useful one: the question staff actually ask
away from a desk is "did my room request go through?" That answer is a card list
and a read-only detail sheet against an endpoint that already exists.

## What Changes

- **Rename the `My Events` tab to `Requests`.** One word, and it pairs with a
  future `Approvals` tab as the two halves of one workflow. "Queue" was
  considered and rejected: `Navigation.jsx:150` already labels the approver's
  desktop link "Approval Queue", the API view is `view=approval-queue`, and
  `ReservationRequests.jsx` ships `patchApprovalQueueLists()`. In this app
  "queue" means the approver's inbox, and semantically it is inverted — a queue
  is work waiting on *you*; this tab is work waiting on *someone else*.
- **The tab id stays `my-events`.** Only the user-facing label changes. The API
  view parameter, React Query keys, and the three existing test suites that
  assert on `view=my-events` are untouched.
- **Build the Requests view**: a status-filtered card list of the user's own
  reservation requests, reusing the shipped `MobileEventCard` anatomy.
- **Extend the existing event detail bottom sheet** with reservation context
  (status timeline from `statusHistory[]`, rejection reason) and a single
  destructive action: withdraw a pending request.
- **Remove the `Chat` tab.** It has never been more than a placeholder.
- **Gate a future `Approvals` tab on `canApproveReservations`.** Users without
  it see two tabs and the bar reflows — matching how the desktop nav hides the
  Approval Queue link. The Approvals tab itself is out of scope here.
- **No editing on mobile, ever.** Editing an event is what drives approver
  change-tracking and `reviewChanges` emails; that stays on desktop.
- **The mobile reservation request wizard is cut**, not deferred. Nobody
  composes a five-step room request on a phone.

## Capabilities

### New Capabilities

- `mobile-requests`: the requester's own reservation requests on mobile — a
  status-filtered card list scoped by `roomReservationData.requestedBy.email`,
  with shared loading/empty-state conventions.

### Modified Capabilities

- `mobile-app-shell`: the tab set changes from Calendar/My Events/Chat to
  Calendar/Requests (+ Approvals, permission-gated, later). The requirement
  that My Events and Chat render "coming soon" placeholders is removed, and tab
  visibility becomes permission-dependent rather than fixed.
- `mobile-event-detail`: the detail sheet gains reservation-specific content
  (status history timeline, rejection reason) and its first non-read-only
  action — withdraw, shown only for the viewer's own pending request.

## Impact

- **Frontend**: `src/components/mobile/MobileApp.jsx` (both placeholder
  branches deleted), `MobileBottomTabs.jsx` (label, permission gating), new
  `MobileRequests.jsx` + CSS, `MobileEventDetail.jsx` (reservation sections,
  withdraw action), `MobileApp.css` (`.mobile-placeholder-*` removed).
- **Backend**: none. `GET /api/events/list?view=my-events`,
  `GET /api/events/list/counts?view=my-events`, and
  `DELETE /api/admin/events/:id` all exist and already scope by requester.
- **Data model**: unchanged.
- **Shared utilities consumed**: `transformEventToFlatStructure()`,
  `deriveListLoadingState()`, `EmptyStateRefreshButton`, `STATUS_MAP`.
- **Supersedes**: the `mobile-my-events` and `mobile-reservation-request`
  capabilities drafted in `openspec/changes/mobile-app-store-publishing/`.
- **Unchanged**: desktop UI, auth, Graph API integration, guest mode.
