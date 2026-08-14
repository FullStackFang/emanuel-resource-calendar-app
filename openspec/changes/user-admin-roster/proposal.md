## Why

`/admin/users` renders every account as a 340px tile in a 3-column grid with no search, no filter, no sort, and no pagination. At the current 84 accounts that is roughly 9,900px of page, and finding one person means scrolling. It is also the only list screen in the app using a multi-column tile grid, so it reads as a different application than ReservationRequests, MyReservations, EventManagement, and ConflictReport.

Three defects make it worse than merely tedious. Cancelling an edit does not revert it, because `handleInputChange` mutates the shared `users` array and `Cancel` only flips edit mode. A failed fetch renders "No users yet, create your first user" to an administrator whose directory just failed to load. And every save re-triggers the full-page spinner, because the component has no silent-refresh path.

## What Changes

**Layout**

- Replace the 3-column `.users-grid` tile grid with a single-column roster at ~62px per person. One grid template is shared between a column-header strip and every row, so column labels print once instead of on every card.
- Replace the three non-interactive stat cards (Total / Administrators / Active 30 days) with role tabs that filter, carrying the same counts. Uses the `.em-tabs` underline recipe from EventManagement, which scales past three tabs.
- Move `preferences.defaultView` and `preferences.startOfWeek` out of the roster and into the editor. They are the listed user's own calendar preferences and are never the reason an administrator opens this page.
- Role badges adopt the ReservationRequests badge recipe (`-50` background, `-200` border, `-500` dot, `--radius-full`) so roles read like statuses do elsewhere.

**Filtering and search**

- Add a filter toolbar by importing `src/components/shared/FilterBar.css` and reusing its `rr-*` markup, exactly as MyReservations and ReservationRequests already do. No new toolbar CSS.
- Search matches `displayName`, `email`, and `title`. Selects for Department, Organizational role, and Activity. A sort select. A `Clear` pill and a live "N of M" result count, both in reserved space so nothing shifts when they appear.
- Activity is derived from `lastLogin`, since the user read model has no `isActive` field. Buckets: active within 30 days, dormant 90 days or more, never signed in.
- New `src/utils/userFilterUtils.js` holding the pure filter and sort functions, mirroring the shape of `src/utils/reservationFilterUtils.js`.

**Editing**

- Editing expands inline beneath its row instead of replacing the row's fields. The editor holds a draft copy of the user in its own state; `Cancel` discards the draft and the roster row behind it was never touched. This fixes the cancel-does-not-revert defect structurally rather than by adding a revert path.

**Data layer and feedback**

- Migrate the hand-rolled `useEffect` + `fetch` to TanStack Query, binding `loading` through `deriveListLoadingState()` per the React Query loading primitives convention in CLAUDE.md.
- Add the `.is-refreshing` dim for background refetches so a save no longer blanks the page.
- Split the single empty state into "no accounts match these filters", "the directory is genuinely empty", and "the load failed". The last two render `EmptyStateRefreshButton`.
- Replace the local `error` / `successMessage` banner state and its `setTimeout` clearing with `useNotification()` toasts.

**Tokens**

- Define `--color-success-200`, `--color-warning-200`, `--color-info-200`, and `--color-error-200` in `src/styles/design-tokens.css`. `ReservationRequests.css` already references these for its badge borders and they resolve to transparent today, so this repairs an existing app-wide rendering gap as a side effect.

**Explicitly not changing**

- No backend change. `GET /api/users` returns the entire collection unpaginated with no query-param support, so all filtering, sorting, and searching is client-side.
- `src/utils/userManagementPolicy.js` role-cap gating (`getAssignableRoles`, `canManageTarget`) is kept as-is and keeps being the single source of role math.
- The Add User modal keeps its current structure and fields. Creating an account is a distinct task from navigating the roster.
- The absent optimistic concurrency on `PUT`/`DELETE /api/users/:id` is a real pre-existing gap but is out of scope here.

## Capabilities

### New Capabilities

- `user-roster`: how the user directory is presented, filtered, searched, sorted, and edited at `/admin/users`, including the loading, empty, and failure states and the role-cap gating that shapes which rows are actionable.

### Modified Capabilities

None. No existing spec covers user management.

## Impact

**Frontend, changed**

- `src/components/UserAdmin.jsx` — substantially rewritten: query migration, filter state, roster rendering, inline editor.
- `src/components/UserAdmin.css` — tile-grid rules removed, roster row rules added. Hardcoded hex in the department and role-type badges replaced with tokens.
- `src/styles/design-tokens.css` — four new `-200` stops.

**Frontend, new**

- `src/utils/userFilterUtils.js`
- `src/__tests__/unit/utils/userFilterUtils.test.js`
- `src/__tests__/unit/components/UserAdmin.filters.test.jsx`
- `src/__tests__/unit/components/UserAdmin.firstPaint.test.jsx`

**Frontend, unchanged but depended on**

- `src/components/shared/FilterBar.css`, `src/components/shared/EmptyStateRefreshButton.jsx`, `src/utils/listLoadingState.js`, `src/context/NotificationContext.jsx`, `src/utils/userManagementPolicy.js`, `src/hooks/useDepartments.js`, `src/hooks/useRoleTypes.js`.

**Existing test that must keep passing**

- `src/__tests__/unit/components/UserAdmin.roleCap.test.jsx` — asserts locked rows and capped role options for approvers. Its selectors target the card markup and will need updating to the roster markup, but every assertion it makes must survive.

**Backend**

- None.

**Risk**

- The whole-collection fetch is unchanged, so the page's data volume and cost profile do not move. If the directory grows past a few hundred accounts, client-side filtering over an unpaginated fetch becomes the next bottleneck, and the mitigation is server-side query params on `GET /api/users` following the `page`/`limit`/`search` shape EventManagement already uses.
