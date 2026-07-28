## 1. Tab shell and naming

- [x] 1.1 Relabel the `my-events` tab to `Requests` in `MobileBottomTabs.jsx`, keeping the tab id `my-events` unchanged
- [x] 1.2 Remove the `chat` entry from the `TABS` array in `MobileBottomTabs.jsx`
- [x] 1.3 Accept an `canApproveReservations`-style permission input in `MobileBottomTabs.jsx` and filter the rendered tab set by it, so a future Approvals tab is gated without another refactor
- [x] 1.4 Delete the `my-events` and `chat` placeholder branches from `MobileApp.jsx`
- [x] 1.5 Remove the now-unused `.mobile-placeholder-*` rules from `MobileApp.css`
- [x] 1.6 Verify the two-tab bar reflows to equal widths and each tab still meets the 44px minimum touch target — `.mobile-tab { flex: 1; min-height: 44px }` in `MobileBottomTabs.css` needed no change: `flex: 1` divides the bar evenly across whatever tabs survive the permission filter

## 2. Requests list

- [x] 2.1 Create `MobileRequests.jsx` with a header comment stating it is the *requester's* view, to distinguish it from the approver-side `ReservationRequests.jsx`
- [x] 2.2 Wire the TanStack query to `GET /api/events/list?view=my-events&limit=1000&includeDeleted=true` reusing the existing `keys.events.list({ view: 'my-events', includeDeleted: true })` key
- [x] 2.3 Wire the counts query to `GET /api/events/list/counts?view=my-events`
- [x] 2.4 Derive loading primitives via `deriveListLoadingState(query, { countsQuery })` and bind `loading = isFirstLoad` — do not gate on `query.isLoading`
- [x] 2.5 Map every document through `transformEventToFlatStructure()` before render (via the array wrapper `transformEventsToFlatStructure`, which is what the shared cache key's other consumer stores)
- [x] 2.6 Build the status filter row (All, Pending, Published, Rejected, Draft) with counts, and filter the list by the active selection — shipped as a **five-column count ledger**, not a chip row. Five labelled pills with count badges need ~470px of the 351px a 375px phone has, so the first attempt relied on a hidden horizontal scrollbar that concealed two filters. Stacking the count over an uppercase caption fits all five at 320px, promotes the counts (the actual payload of this screen), and avoids the SaaS pill-row pattern PRODUCT.md names as anti-reference #1. Zero-count statuses recede to `neutral-400` rather than disappearing, so the filter set never changes shape.
- [x] 2.7 Render request cards reusing the `MobileEventCard` anatomy plus a status badge, sourcing colors from `STATUS_MAP` — added `showStatus` / `showDate` props to the shared card rather than forking it
- [x] 2.8 Render the empty state only when `!isPending && data.length === 0 && !isSilentRefreshing`, including `EmptyStateRefreshButton` wired to a manual refetch
- [x] 2.9 Create `MobileRequests.css` using existing design tokens only
- [x] 2.10 Mount `MobileRequests` in the `my-events` case of `MobileApp.jsx`

## 3. Detail sheet — reservation context

- [x] 3.1 Extend `MobileEventDetail.jsx` to render a chronological timeline from `statusHistory[]` showing status, timestamp, and actor — required adding `statusHistory` to `eventTransformers.js` (the transformer dropped it; `EVENT_LIST_PROJECTION` already returns it)
- [x] 3.2 Render the rejection reason as an error notice above the timing details when status is `rejected` — sourced from `roomReservationData.reviewNotes`, which is where `PUT /reject` writes the reason
- [ ] 3.3 Render conflicting event title and time range when a rejected request carries conflict details — **BLOCKED, spec scenario removed.** Scheduling conflicts are transient: `checkRoomConflicts()` returns `hardConflicts`/`softConflicts` in a `409 SchedulingConflict` response body and nothing persists them onto the event document. (`conflictDetails` exists only on rsched import staging rows.) A rejected request therefore never carries conflict details, so the guarded render would be permanently unreachable. Persisting a conflict snapshot on reject is the prerequisite — backend work the proposal scoped out ("Backend: none").
- [x] 3.4 Confirm the sheet still honours its 85dvh cap and scrolls internally with the added sections — **the 85dvh cap no longer exists**: the sheet shipped as `position: fixed; inset: 0` (full-screen). Verified the added sections scroll inside `.mobile-detail-scroll` (`flex: 1; overflow-y: auto`) rather than growing the sheet; `mobile-event-detail` spec should drop the 85dvh language when next revised

## 4. Withdraw a pending request

- [x] 4.1 Compute the withdraw gate: viewer is the requester AND status is `pending`; render no action otherwise — email from `useMsal().accounts[0].username` vs `event.requesterEmail`, further gated by `showReservationContext` so the calendar agenda's sheet stays purely read-only
- [x] 4.2 Implement the in-button confirmation state machine — idle → "Confirm withdrawal?" → "Withdrawing..." — with no auto-reset timeout and no `window.confirm()`; the only non-confirming exit is the sheet closing or switching events
- [x] 4.3 Collect a reason and call `DELETE /api/admin/events/:id` with it — reason is required by the UI (confirm button disabled while blank) and sent with `_version` so the server's OCC guard can fire
- [x] 4.4 On success: `showSuccess()` toast, close the sheet, invalidate the Requests list and counts queries
- [x] 4.5 On `409 VERSION_CONFLICT`: show "already handled", close the sheet, refetch — render no field-level diff or conflict dialog
- [x] 4.6 On any other failure: `showError()` toast and return the button to idle so the user can retry

## 5. Tests

- [x] 5.1 `MobileRequests.firstPaint.test.jsx` — no empty-state render during the `pending && idle` tick, mirroring the three existing first-paint suites (MRQ-FP-1..4)
- [x] 5.2 Status filtering narrows the list, and exception/addition children never appear as cards (`MobileRequests.test.jsx` MRQ-1..5)
- [x] 5.3 Empty state renders only on a true resolved-empty result and includes the refresh button (MRQ-6..8; MRQ-8 also locks that a no-match *filter* gets a plain note, not the refresh CTA)
- [x] 5.4 Withdraw is absent for published, rejected, draft, and for another user's request (`MobileEventDetail.withdraw.test.jsx` MW-1..4; MW-4 also covers the agenda entry point)
- [x] 5.5 Withdraw confirm-state transition, disabled-during-call, and success path (toast + list refresh) — MW-5..7, plus MW-10 for confirm-state reset across events
- [x] 5.6 Withdraw 409 path shows the already-handled message and refreshes without a diff view (MW-8; MW-9 covers the non-conflict failure path)
- [x] 5.7 Tab bar renders two tabs without approve permission and does not render a Chat tab (`MobileBottomTabs.test.jsx` MBT-1..4)
- [x] 5.8 Run only the new and directly affected test files; do not run the full suite — **64 passed / 0 failed** across the 7 mobile suites. Directly affected: `MobileEventDetail.test.jsx` needed three new hook mocks (MSAL / authFetch / notifications) added by the withdraw action; `eventTransformers.test.js` shows 3 failures on `department` that are **pre-existing** (verified by `git stash push -- src/utils/eventTransformers.js`: same 3 fail at baseline). `npx vite build` clean.

## 6. Verification

- [ ] 6.1 Verify on a real phone viewport: list, filters, detail sheet, and withdraw round-trip — **NOT DONE.** Needs a signed-in MSAL session against Azure AD plus a live backend, and the withdraw round-trip writes to a real reservation. Left for the user.
- [ ] 6.2 Confirm no empty-state flash on a cold reload of the Requests tab — **NOT DONE on device** (same blocker as 6.1). The behaviour is locked in code by MRQ-FP-1/2 against the exact `pending && idle` tick that causes it.
- [x] 6.3 Confirm `view=my-events` and existing query keys are unchanged by grepping for both after the rename — verified. `view=my-events` still appears in `MyReservations.jsx:164`, `Navigation.jsx:34`, the backend route docs, and four MyReservations test suites; `keys.events.list({ view: 'my-events', includeDeleted: true })` is unchanged in `MyReservations.jsx` and `ReservationRequests.reactQuery.test.jsx`. The only new occurrences are `MobileRequests.jsx` adopting the same identifier.
- [x] 6.4 Update `CLAUDE.md` "Current In-Progress Work" with the shipped state and the deferred Approvals tab
