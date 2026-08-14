## Context

`UserAdmin.jsx` is 993 lines and predates most of the conventions the rest of the app now follows. It fetches with a hand-rolled `useEffect` (`:135-165`), gates loading on `loading && users.length === 0` (`:396`), keeps `error` and `successMessage` in local state cleared by `setTimeout` (`:266`, `:345`, `:384`), and renders every account into a `repeat(3, 1fr)` tile grid (`.users-grid`). It is the only list screen in the app doing any of those things.

The constraints that shape this design:

- **`GET /api/users` returns the whole collection with no query params** (`api-server.js:14823-14837`). Server-side filtering does not exist and adding it is out of scope, so every filter is a pure function over an in-memory array.
- **The user read model has no `isActive` field** (`USER_READ_FIELDS`, `api-server.js:14791`). Activity must be derived from `lastLogin`.
- **User documents carry no `_version`.** `PUT` and `DELETE /api/users/:id` use plain `updateOne`/`deleteOne` with no optimistic concurrency. Nothing here can offer conflict detection that the backend does not support.
- **`src/components/shared/FilterBar.css` exists with no `.jsx`.** It is a stylesheet imported by `MyReservations.jsx:27` and `ReservationRequests.jsx:48`, each of which hand-builds markup against its `rr-*` classes. There is no shared filter component to reuse, only a shared vocabulary to match.
- **The app has a query key factory** at `src/queries/keys.js` with no `users` resource yet, and `deriveListLoadingState` at `src/utils/listLoadingState.js`.

## Goals / Non-Goals

**Goals:**

- Make one person findable in the directory without scrolling.
- Make the page indistinguishable in style from the app's other list screens.
- Remove three defects: cancel does not revert, a failed load claims the directory is empty, and every save blanks the page.
- Leave role-cap enforcement exactly where it is.

**Non-Goals:**

- Server-side search, filter, or pagination on `GET /api/users`.
- Optimistic concurrency on user writes.
- Reworking the Add User modal beyond wiring its feedback to toasts.
- Bulk actions (multi-select, bulk role change, CSV export). Real needs, separate change.
- Dark mode. PRODUCT.md pins this app to light only.

## Decisions

### D1: Roster rows, not the `.rr-card` shape the rest of the app uses

The house list idiom is a single-column stack of `.rr-card`s whose body is a CSS grid of `minmax()` columns, with an `.rr-info-label` over an `.rr-info-value` in each cell. That is a table that reprints its column headers on every row. For a five-field reservation it reads well. Measured against this directory it costs about 142px per person, which at 84 accounts is roughly 11,900px, worse than the 9,900px the tile grid costs today.

**Decision:** keep that grid, print the labels once. A `.ua-row-grid` class carries the `grid-template-columns`, and both a `.ua-roster-head` strip and every `.ua-row` apply it. Result is ~62px per person.

**Alternatives considered.** A real `<table>` was rejected because no list screen in the app uses one and the semantics buy little here (no colspan, no footer, and responsive collapse is easier with grid). Literal `.rr-card` was mocked up in full and rejected on the density measurement above; it is preserved in the mockup as panel 05 so the tradeoff stays visible rather than asserted.

**Consequence.** This introduces one new layout shape to the app. It is justified only because the directory is the app's densest list; it should not be copied to screens with fewer rows.

### D2: The three stat cards become the role tabs

Total / Administrators / Active-30-days are computed today (`:108-118`) and rendered as three non-interactive cards. The same counts, attached to tabs, both filter and inform. This removes a decorative block and adds a filter in one move rather than adding a fourth thing to the top of the page.

**Tab style:** the `.em-tabs` underline recipe from EventManagement rather than the `.event-type-tabs` pill track from ReservationRequests. Both exist in the app. The pill track is `width: fit-content` and its active state is a gradient fill; it is tuned for three tabs. Five role tabs read better on the underline recipe, which is already horizontally scrollable.

**Counts describe the directory, not the filtered view.** A count that shrinks as you type tells you nothing you cannot already see in the result count, and makes the tabs unusable as a navigation aid.

### D3: Activity buckets derived from `lastLogin`

No `isActive` field exists, and inventing one would be a backend change. Buckets are: active within 30 days, dormant 90 days or more, never signed in. Thirty days matches the existing stat card so the number administrators already recognize does not change meaning. "Never signed in" is deliberately its own bucket rather than folded into dormant, because a provisioned-but-unused account is an administrative loose end and a long-dormant one is a different problem.

**The comparison is computed once per filter pass, not per row.** `Date.now()` is read once and the two thresholds derived from it, so a filter pass over 84 accounts does not allocate 168 `Date` objects.

### D4: A `userFilterUtils.js` of pure functions, mirroring `reservationFilterUtils.js`

`src/utils/reservationFilterUtils.js` exports `filterBySearchAndDate(items, opts)` and `sortReservations(items, sortBy)` and is consumed by two screens. It is reservation-field-specific, so it cannot be reused directly, but its shape is the established one: pure functions over an array, unit-tested without rendering.

New module exports `filterUsers(users, criteria)` and `sortUsers(users, sortBy)`, plus `deriveRole` and the activity-bucket predicate, which the component and the tab counts both need. Putting `deriveRole` here rather than leaving it private to the component means the tab counts and the row badges provably agree.

**Alternative rejected:** a `useUserFilters` hook. The filtering has no lifecycle, no async, and no subscription. A hook would make it harder to test and would hide `useMemo` boundaries that the component should own.

### D5: The editor holds a draft copy

Today `handleInputChange` (`:176`) writes through to the `users` array and `Cancel` (`:707`) only flips `editingRows[userId]`, so abandoned edits stay on screen until reload. Adding a snapshot-and-restore path would fix the symptom.

**Decision:** the editor owns `draft` state, initialized from the row's account when it opens. Nothing outside the editor is written until a save resolves, at which point the server's response is what updates the cache. Cancel discards the draft and there is nothing to restore, because nothing was changed.

**Inline expansion rather than a modal.** The editor opens beneath its own row. The administrator arrived at this row through a search and three filters; a modal that covers the roster loses that context visually and, if it unmounts the list, risks losing it in state too. It also keeps the neighbouring rows available for comparison, which is the common case when adjusting roles across a department.

**Only one editor is open at a time.** `editingId` is a single value, not a map. Two open drafts against a shared cache is a merge problem with no user-visible benefit.

### D6: TanStack Query with a new `users` resource in the key factory

`src/queries/keys.js` gains:

```js
users: {
  all: () => ['users'],
  list: () => ['users', 'list'],
}
```

Extending the factory rather than constructing the key inline is the documented rule in that file's own header comment. `list()` takes no scope because the fetch takes no parameters: there is exactly one users list.

Loading primitives come from `deriveListLoadingState(usersQuery)` with no `countsQuery` and no `enabled` override. The query is enabled as soon as `apiToken` exists; there is no tab or filter that intentionally skips the fetch, so passing a real `enabled` would risk a perpetual spinner for no gain. `loading` binds to `isFirstLoad`; `isSilentRefreshing` drives the `.is-refreshing` dim.

**Mutations invalidate `keys.users.list()`.** Create, update, and delete each invalidate rather than hand-patching the cache. Hand-patching is what produces the class of bug where a list and its counts disagree, and this list is small enough that a refetch is cheap.

**No SSE.** `/api/users` is not part of the SSE event contract and adding it is a backend change. A second administrator's edit stays invisible until a refetch, exactly as today.

### D7: Three empty states, not one

The current predicate is `users.length > 0` (`:484`). It cannot distinguish a failed fetch from an empty directory, which is why a load failure currently reads "No users yet, create your first user."

Split by cause, following the documented empty-state predicate:

| Condition | Renders |
|---|---|
| `isFirstLoad` | loading indicator, never an empty state |
| `isError` | failure message plus `EmptyStateRefreshButton` labelled to retry |
| `!isFirstLoad && !isSilentRefreshing && users.length === 0` | genuinely empty directory, invites creating the first account, plus a refresh control |
| same, but with filters engaged | no matches, offers to clear filters |

The filtered-to-nothing state offers **clear filters** rather than refresh, because refetching is not the recovery action for a filter that excludes everything.

### D8: Role badges adopt the ReservationRequests recipe, and four missing tokens get defined

Role badges become `-50` background, `-200` border, a 6px `-500` dot, `--radius-full`. This is the app's most refined badge treatment and it makes roles read the way statuses read elsewhere.

It also exposes a live defect: `--color-success-200`, `--color-warning-200`, `--color-info-200`, and `--color-error-200` are referenced by `ReservationRequests.css` badge borders but are **not defined** in `design-tokens.css`, which only carries 50/100/400/500/600/700 for those ramps. Those borders currently resolve to transparent everywhere they are used. This change defines the four stops, interpolated between each ramp's existing 100 and 400.

**This is deliberately in scope even though it is not about `/admin/users`.** Defining them is a two-line addition that repairs an existing rendering gap; adopting the recipe here without defining them would ship a fifth broken border.

**It changes pixels on ReservationRequests and MyReservations.** Badge borders that render as nothing today will render as a faint tint. That is the intended appearance those files were written for, but it is a visual change to screens this proposal does not otherwise touch, and reviewers should expect it.

### D9: Match highlighting on searched substrings

When a row survives because of a match in an email or a title rather than the display name, nothing on the row explains why. A single `<mark>` on the matched substring, tinted `--color-accent-200`, answers that. Applied to display name, email, and title, the three searched fields.

**Escaping matters.** The term is used to split strings for rendering, never injected as HTML, and any regex path must escape it. Names in this directory contain regex metacharacters rarely but emails contain `.` universally.

## Risks / Trade-offs

**Client-side filtering over an unpaginated fetch does not scale indefinitely** → At 84 accounts this is not a real cost. Past a few hundred it becomes one, and the mitigation is server-side `page`/`limit`/`search` params on `GET /api/users`, following the shape `EventManagement.jsx` already uses. The filter functions being pure and separately tested means that migration replaces their call site rather than rewriting them.

**The roster is still long when unfiltered** → 84 accounts at 62px is about 5,200px. Better than 9,900px, not short. Filters are what make it short. Pagination was offered and not selected for this change; it remains the obvious next step and the roster shape does not obstruct it.

**Defining the four `-200` tokens changes two screens this change does not otherwise touch** → The change is additive (previously-transparent borders become visible) and restores the appearance those stylesheets were authored for. Flagged for reviewers rather than hidden. If it proves unwelcome, reverting is deleting four lines.

**`UserAdmin.roleCap.test.jsx` targets card markup** → Its selectors will break. Every assertion it makes must survive the rewrite. The rule for this change is that the test file may be re-selectored but not weakened, and the approver-gating assertions must be re-run against the new markup before the change is considered done.

**Rewriting a 993-line component invites scope creep** → The Add User modal is explicitly untouched except for its feedback path. It accounts for roughly 200 of those lines and rewriting it is not required by anything in the proposal.

**One new layout shape enters the app** → Justified by the density measurement, and only here. If it spreads to screens that do not need it, the app gains a second list idiom for no reason. The design doc is the record of why it exists.

## Migration Plan

No data migration and no backend deploy. The change is frontend-only and ships as one unit: a partially-migrated component would have two loading models at once.

Rollback is reverting the commit. The only file changed outside `UserAdmin.*` is `design-tokens.css`, and that change is purely additive.

## Open Questions

- **Should the roster remember filters across navigation?** Not specified. Default is no; filters reset on mount, matching MyReservations and ReservationRequests. Worth revisiting if administrators report re-entering the same filter repeatedly.
- **Does `templeEvents__Users` contain deactivated accounts that should be hidden by default?** The read model has no flag for it, so the roster shows every document. If soft-deleted users exist in the collection, they are visible today too and this change does not alter that.
