## 1. Shared foundations

- [x] 1.1 Extract `src/utils/categoryColors.js` (preset0-24 -> hex map + `buildCategoryColorResolver`) with unit tests covering resolver hits, misses, and empty category list; `Calendar.jsx` untouched
- [x] 1.2 Extract `src/hooks/useMobileEvents.js` from `MobileAgenda` verbatim (fetch, append/dedupe, range tracking, refresh, error/retry) with behavior-parity unit tests

## 2. Calendar tab restructure

- [x] 2.1 Create `MobileCalendarTab.jsx` owning `selectedDate`, `activeView` (localStorage `mobile-calendar-view`, default agenda), `selectedEvent`, `useMobileEvents`, `MobileWeekStrip`, and the shared `MobileEventDetail`
- [x] 2.2 Create `MobileViewSwitcher.jsx` + CSS (segmented control per design tokens, >= 44px targets, own right-aligned row beneath the week strip)
- [x] 2.3 Slim `MobileAgenda` to a presentational list (props: events/groups/dates, loading, error, onEventTap, onRetry; keep pull-to-refresh) and update `MobileApp`'s calendar case to render `MobileCalendarTab`
- [x] 2.4 `MobileCalendarTab.test.jsx`: switch without refetch, localStorage persistence, first-time default, week strip drives both views, detail sheet opens from either; existing `MobileAgenda` suites green

## 3. The 3-day grid

- [x] 3.1 Build `MobileThreeDay.jsx` + CSS: 24h grid at 52px/hour, 44px gutter, hairlines, hidden scrollbars, 8px top inset, initial scroll to 9 AM, sticky day headers, today column tint
- [x] 3.2 Timed event blocks: local-time positioning, outline-over-13%-wash category styling via the resolver, 9px time + 10px title with ellipsis, pending 0.9 opacity, 20px min height, tap -> detail sheet
- [x] 3.3 Overlap clusters: side-by-side equal-width split within a cluster
- [x] 3.4 All-day chip row pinned under the day headers, tappable
- [x] 3.5 Current-time indicator: today's column only, 1-minute interval update, cleaned up on unmount
- [x] 3.6 `MobileThreeDay.test.jsx`: column dates from `selectedDate`, block top/height from fixture times, overlap split, all-day row, pending opacity, tap callback, indicator only on today, unknown-category gray

## 4. Verification

- [x] 4.1 Run the mobile Vitest suites (new + existing 64-test baseline) and fix regressions
- [ ] 4.2 Manual walkthrough at phone viewport via `npm run dev`: switch views, navigate days (strip, chevrons, picker, Today), tap timed and all-day events, verify current-time line and initial scroll
- [x] 4.3 Suggest the conventional commit message

## 5. Block density revision (design.md Decision 7, approved 2026-07-28)

- [x] 5.1 Return a density tier (`short` / `med` / `tall`) from `layoutDayEvents` alongside `top`/`height`, with thresholds as named constants; unit-test the tier boundaries (26px, 34px, 39px, 50px, 52px)
- [x] 5.2 Drop the visible start time from timed blocks; keep it in the `aria-label` and lock that with a test
- [x] 5.3 Replace the block outline with a 3px category rail over an 8% wash; title semibold; apply the same rail to all-day chips
- [x] 5.4 Add the tier CSS: 1/2/2 `-webkit-line-clamp` on the title (9.5px on `short`, 10px otherwise), location line on `tall` only
- [x] 5.5 Narrow the gutter to 28px with compact hour labels (`7a`/`12p`/`12a`); drop the now-illegible `all-day` gutter label
- [x] 5.6 Update the affected `MobileThreeDay` tests (border/background assertions, visible-time assertion) and add tier + clamp coverage; whole mobile suite green
- [x] 5.7 Suggest the conventional commit message for the revision

## 6. Category color fix (found on device, 2026-07-28)

- [x] 6.1 Port the two missing branches of `Calendar.jsx` `getCategoryColor` into `buildCategoryColorResolver`: gray only for uncategorized, stable hashed color for unregistered categories
- [x] 6.2 Reset the default button border on blocks and chips (the rail is the only border)
- [x] 6.3 Amend the spec scenarios and design Decision 5 / risk line, which had codified the gray-everything behavior
- [ ] 6.4 Confirm on device that blocks render in category colors
