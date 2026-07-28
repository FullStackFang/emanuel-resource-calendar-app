## 1. Swipe gesture

- [x] 1.1 Create `src/hooks/useHorizontalSwipe.js`: named constants
  (`AXIS_LOCK_TRAVEL` 10px, `AXIS_RATIO` 1.5, `SWIPE_THRESHOLD` 60px), multi-touch
  bail, axis lock that holds for the whole gesture, distance-only fire on end.
  Returns `{ handlers, axisRef }` — `axisRef` is what makes the swipe
  authoritative over pull-to-refresh (design Decision 2)
- [x] 1.2 `useHorizontalSwipe.test.js`: horizontal past threshold fires left and
  right; vertical never fires; sub-ratio diagonal never fires; a gesture that
  locks vertical then moves horizontally still never fires; under-threshold
  horizontal does not fire; multi-touch bails; `axisRef` reports the lock

## 2. Scroll spy

- [x] 2.1 Create `src/utils/agendaScrollSpy.js` with pure
  `dayAtScrollTop(sections, scrollTop)`
- [x] 2.2 `agendaScrollSpy.test.js`: scrollTop above the first section; exactly
  on a boundary; between sections; past the last section; empty section list;
  unordered input

## 3. Wire the tab shell

- [x] 3.1 `MobileCalendarTab`: add `visibleDate` state, force it to follow
  `selectedDate` on intent change, bind `MobileWeekStrip` to `visibleDate` +
  `setSelectedDate`
- [x] 3.2 Bind `useHorizontalSwipe` to a wrapper enclosing the view area only
  (not the week strip); `stepDay(delta)` writes `selectedDate`.
  `MobileThreeDay.jsx` is not modified
- [x] 3.3 Pass `axisRef` and `onVisibleDateChange` down to `MobileAgenda`

## 4. Wire the agenda

- [x] 4.1 Add the passive, rAF-throttled `scroll` listener on `listRef`, feeding
  `dayAtScrollTop` from the existing `dateRefs` offsets; report via
  `onVisibleDateChange`
- [x] 4.2 Add the programmatic-scroll target ref: ignore observations until the
  observed key matches the target, then clear (design Decision 4)
- [x] 4.3 Guard `handleTouchEnd` — bail when `axisRef.current === 'x'`

## 5. Component tests

- [x] 5.1 `MobileCalendarTab.test.jsx`: swipe left steps one day forward, swipe
  right one day back; the 3-day grid's leftmost column follows; the strip
  highlights the new day
- [x] 5.2 `MobileAgenda` suite: scrolling into a new day section calls
  `onVisibleDateChange`; observations are ignored while a programmatic scroll is
  in flight; pull-to-refresh does not fire on an `x`-locked gesture; existing
  pull-to-refresh test stays green
- [x] 5.3 Confirm scroll observation does not change `datesToShow` or trigger a
  fetch (the intent/observation split, design Decision 1)

## 6. Verification

- [x] 6.1 Run the mobile Vitest suites and fix regressions; measure the baseline
  first per CLAUDE.md (the suite is red on main)
- [ ] 6.2 On-device: swipe both directions in both views; confirm the strip
  follows agenda scroll including across a month boundary; confirm swiping
  forward across a Sunday (which shifts `getWeekRange` and re-renders all 14
  sections mid-animation) lands correctly — design Risk 2
- [ ] 6.3 On-device: confirm a firm diagonal drag from the top of the agenda
  does not both step a day and refresh
- [x] 6.4 Suggest the conventional commit message
