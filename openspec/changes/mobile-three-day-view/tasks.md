## 1. Shared foundations

- [ ] 1.1 Extract `src/utils/categoryColors.js` (preset0-24 -> hex map + `buildCategoryColorResolver`) with unit tests covering resolver hits, misses, and empty category list; `Calendar.jsx` untouched
- [ ] 1.2 Extract `src/hooks/useMobileEvents.js` from `MobileAgenda` verbatim (fetch, append/dedupe, range tracking, refresh, error/retry) with behavior-parity unit tests

## 2. Calendar tab restructure

- [ ] 2.1 Create `MobileCalendarTab.jsx` owning `selectedDate`, `activeView` (localStorage `mobile-calendar-view`, default agenda), `selectedEvent`, `useMobileEvents`, `MobileWeekStrip`, and the shared `MobileEventDetail`
- [ ] 2.2 Create `MobileViewSwitcher.jsx` + CSS (segmented control per design tokens, >= 44px targets, own right-aligned row beneath the week strip)
- [ ] 2.3 Slim `MobileAgenda` to a presentational list (props: events/groups/dates, loading, error, onEventTap, onRetry; keep pull-to-refresh) and update `MobileApp`'s calendar case to render `MobileCalendarTab`
- [ ] 2.4 `MobileCalendarTab.test.jsx`: switch without refetch, localStorage persistence, first-time default, week strip drives both views, detail sheet opens from either; existing `MobileAgenda` suites green

## 3. The 3-day grid

- [ ] 3.1 Build `MobileThreeDay.jsx` + CSS: 24h grid at 52px/hour, 44px gutter, hairlines, hidden scrollbars, 8px top inset, initial scroll to 9 AM, sticky day headers, today column tint
- [ ] 3.2 Timed event blocks: local-time positioning, outline-over-13%-wash category styling via the resolver, 9px time + 10px title with ellipsis, pending 0.9 opacity, 20px min height, tap -> detail sheet
- [ ] 3.3 Overlap clusters: side-by-side equal-width split within a cluster
- [ ] 3.4 All-day chip row pinned under the day headers, tappable
- [ ] 3.5 Current-time indicator: today's column only, 1-minute interval update, cleaned up on unmount
- [ ] 3.6 `MobileThreeDay.test.jsx`: column dates from `selectedDate`, block top/height from fixture times, overlap split, all-day row, pending opacity, tap callback, indicator only on today, unknown-category gray

## 4. Verification

- [ ] 4.1 Run the mobile Vitest suites (new + existing 64-test baseline) and fix regressions
- [ ] 4.2 Manual walkthrough at phone viewport via `npm run dev`: switch views, navigate days (strip, chevrons, picker, Today), tap timed and all-day events, verify current-time line and initial scroll
- [ ] 4.3 Suggest the conventional commit message
