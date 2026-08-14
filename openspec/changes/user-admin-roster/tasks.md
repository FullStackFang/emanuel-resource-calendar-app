## 1. Baseline and tokens

- [x] 1.1 Record the pre-change baseline: run `npm run test:run -- UserAdmin` and `npm run lint` on the touched files, and note the counts. Main is red, so a count is the only way to tell a new failure from an inherited one.
- [x] 1.2 Add `--color-success-200`, `--color-warning-200`, `--color-info-200`, and `--color-error-200` to `src/styles/design-tokens.css`, each interpolated between its ramp's existing 100 and 400 stops (D8).
- [x] 1.3 Visually confirm the four new stops resolve on ReservationRequests: its `.rr-status-badge` borders should now render a faint tint instead of nothing. This is the intended side effect, not a regression.

## 2. Filter and sort utilities

- [x] 2.1 Write `src/__tests__/unit/utils/userFilterUtils.test.js` first, covering: substring search across `displayName` / `email` / `title`, case-insensitivity, department and role-type filters, the three activity buckets, filter composition, and each sort order. Tests fail at this point.
- [x] 2.2 Create `src/utils/userFilterUtils.js` exporting `deriveRole(user)`, `filterUsers(users, criteria)`, `sortUsers(users, sortBy)`, and the activity-bucket predicate. Pure functions, no React (D4).
- [x] 2.3 Compute the activity thresholds once per filter pass from a single `Date.now()` read rather than per row (D3).
- [x] 2.4 Move `deriveRole` out of `UserAdmin.jsx` into this module so the tab counts and the row badges provably use one definition. Keep its current fallback chain exactly (`effectiveRole` → `role` → `isAdmin` → `permissions.canViewAllReservations` → `viewer`).
- [x] 2.5 Run `npm run test:run -- userFilterUtils` and iterate until green.
- [x] 2.6 Mutation-check one filter: break the activity threshold comparison and confirm a test fails. Restore.

## 3. Query migration

- [x] 3.1 Add a `users` resource to `src/queries/keys.js` with `all()` and `list()`, following the file's own header convention. `list()` takes no scope: there is one users list (D6).
- [x] 3.2 Replace the `useEffect` + `fetch` in `UserAdmin.jsx` with `useQuery` on `keys.users.list()`, enabled on `apiToken`.
- [x] 3.3 Bind loading through `deriveListLoadingState(usersQuery)` with no `countsQuery` and no `enabled` override. Bind `loading` to `isFirstLoad`.
- [x] 3.4 Convert create, update, and delete to mutations that invalidate `keys.users.list()` on success rather than hand-patching the cache.
- [x] 3.5 Remove `setLoading(true)` from the save, create, and delete paths. Per-action progress is the button's own state, not a page-level flag.
- [x] 3.6 Apply the `.is-refreshing` dim to the roster while `isSilentRefreshing`, keeping the header, tabs, and filter bar mounted throughout.

## 4. Roster layout

- [x] 4.1 Add a `.ua-row-grid` class in `UserAdmin.css` carrying the shared `grid-template-columns`, and apply it to both `.ua-roster-head` and `.ua-row` (D1).
- [x] 4.2 Replace the `.users-grid` tile markup with roster rows: person cell (avatar, name, email, "You" marker), role badge, department, org role, title, last activity, actions.
- [x] 4.3 Remove `preferences.defaultView` and `preferences.startOfWeek` from the row entirely.
- [x] 4.4 Restyle the role badges onto the `-50` background / `-200` border / 6px `-500` dot recipe (D8).
- [x] 4.5 Replace the hardcoded hex in the department and role-type badge rules with tokens. These were flagged in review at `UserAdmin.css:1241,1243` and `:1352-1379`.
- [x] 4.6 Render absent department, org role, and title as explicit placeholders rather than blank cells.
- [x] 4.7 Show last activity as a relative phrase over an absolute timestamp, with never-signed-in distinguished from a stale date.
- [x] 4.8 Delete the now-unused `.users-grid` and `.user-card*` rules. Remove only what this change orphaned.
- [x] 4.9 Add the responsive rules: drop org role and title below 1100px, collapse to a stacked reading order below 720px.

## 5. Role tabs

- [x] 5.1 Replace the three stat cards with tabs for Everyone, Administrators, Approvers, Requesters, Viewers, using the `.em-tabs` underline recipe (D2).
- [x] 5.2 Compute tab counts from the full directory via `deriveRole`, not from the filtered set, so counts stay stable while filters narrow the rows.
- [x] 5.3 Delete the `stats` memo and the `.user-stats` / `.user-stat-card` CSS it fed.

## 6. Filter toolbar

- [x] 6.1 Import `./shared/FilterBar.css` in `UserAdmin.jsx` and build the toolbar against its `rr-*` classes, matching how `MyReservations.jsx` and `ReservationRequests.jsx` use it. Author no new toolbar CSS.
- [x] 6.2 Add the search input with its clear button, wired to search across name, email, and title.
- [x] 6.3 Add Department and Org role selects populated from `useDepartments()` and `useRoleTypes()`, plus the Activity select with the three derived buckets.
- [x] 6.4 Add the sort select: role then name (default), name A to Z, name Z to A, recently active.
- [x] 6.5 Apply the `.active` modifier to any filter group set away from its default.
- [x] 6.6 Add the `Clear` pill and the "N of M" result count inside `.rr-filter-actions`, toggling `.hidden` rather than unmounting so the layout does not shift.
- [x] 6.7 Add match highlighting on the searched substring in name, email, and title, escaping the term before any regex use (D9).

## 7. Inline editor

- [x] 7.1 Add a single `editingId` state. One editor open at a time (D5).
- [x] 7.2 Build the editor as a panel rendered beneath its row, holding a `draft` copy of the account in its own state, initialized when it opens.
- [x] 7.3 Expose display name, email, role, department, org role, and title, with the calendar preferences beneath a subheading marking them secondary.
- [x] 7.4 Wire Cancel to discard the draft with no write to the shared list, and confirm the row is visually unchanged afterwards.
- [x] 7.5 Wire Save to the update mutation, updating from the server response and raising a success toast; on failure raise an error toast and keep the editor open with entered values intact.
- [x] 7.6 Delete `handleInputChange` and the `editingRows` map. The draft-copy editor replaces both, and leaving the mutating writer in place leaves the bug reachable.
- [x] 7.7 Keep role options capped by `getAssignableRoles(callerRole)` and rows gated by `canManageTarget`, both still sourced from `userManagementPolicy.js`.

## 8. States and feedback

- [x] 8.1 Replace the local `error` / `successMessage` state and every `setTimeout` clearing it with `useNotification()` toasts across save, create, and delete.
- [x] 8.2 Delete the `.error-message` / `.success-message` banner markup from the component.
- [x] 8.3 Implement the four-way state split from D7: first load shows a loader and never an empty state; a query error shows a failure message plus a retry; an unfiltered empty result invites creating the first account plus a refresh; a filtered empty result offers to clear filters.
- [x] 8.4 Use `EmptyStateRefreshButton` from `src/components/shared/` for both the failure and genuinely-empty states.
- [x] 8.5 Confirm the failure state never renders the words that claim the directory is empty.

## 9. Delete confirmation

- [x] 9.1 Keep the existing two-step `confirmDeleteId` / `deletingId` pattern and its dismiss control, moving it into the roster row actions.
- [x] 9.2 Confirm the armed state persists until the administrator acts, with no timer reset, and that the confirm colour is `--color-error-500`.
- [x] 9.3 Confirm no delete control renders on the signed-in user's own row or on rows failing `canManageTarget`.

## 10. Tests

- [x] 10.1 Re-selector `src/__tests__/unit/components/UserAdmin.roleCap.test.jsx` against the roster markup. Every existing assertion must survive; weakening one is not an acceptable way to make it pass.
- [x] 10.2 Write `src/__tests__/unit/components/UserAdmin.filters.test.jsx`: role tab narrows the roster, counts stay stable under search, filters compose, clear restores everything, the result count tracks the filtered set.
- [x] 10.3 Write `src/__tests__/unit/components/UserAdmin.firstPaint.test.jsx` mirroring the existing `*.firstPaint.test.jsx` files: no empty state during the `pending && idle` tick, rows preserved during a silent refresh, failure state distinct from empty.
- [x] 10.4 Add a cancel-reverts test: edit three fields, cancel, assert the row shows the original values and no request fired.
- [x] 10.5 Mutation-check the cancel fix by making the editor write through to the shared list, and confirm 10.4 fails. Restore.
- [x] 10.6 Mutation-check the first-paint gate by binding `loading` to `query.isLoading` instead of `isFirstLoad`, and confirm 10.3 fails. Restore.

## 11. Verification

- [x] 11.1 Run the four UserAdmin-related suites plus `userFilterUtils` and confirm all green.
- [x] 11.2 Run the full frontend suite and compare failure count and file list against the 1.1 baseline. Any new failure is this change's to fix.
- [x] 11.3 Run `npm run lint` on every touched file and compare warning counts against the 1.1 baseline.
- [x] 11.4 Confirm no `window.confirm`, no `setTimeout`-cleared banner, and no hardcoded hex remain in `UserAdmin.jsx` or `UserAdmin.css`.
- [ ] 11.5 Manual end-to-end on dev with a live MSAL session: search by title, compose three filters, clear them, sort by activity, open and cancel an edit, save a role change and confirm the toast and the row update, arm and abandon a delete, and confirm an approver sees locked rows and capped role options.
- [ ] 11.6 Manual responsive check at 1100px and 720px.
