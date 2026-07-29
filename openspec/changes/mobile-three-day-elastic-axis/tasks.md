## 1. Baseline

- [x] 1.1 Record the mobile Vitest baseline before touching anything —
  `npm run test:run -- src/__tests__/unit/components/mobile src/__tests__/unit/hooks/useHorizontalSwipe.test.jsx src/__tests__/unit/utils/agendaScrollSpy.test.js`.
  The suite is red on main, so the pass/fail counts here are what any later
  regression is measured against
- [x] 1.2 Confirm the working tree is clean apart from the openspec artifacts,
  and re-check `git status` immediately before any destructive step (OneDrive
  live-syncs this tree, so snapshots go stale)

## 2. The time scale (pure, test-first)

- [x] 2.1 Write `timeScale.test.js` for `buildTimeScale`: per-column concurrency
  maxed across columns, the 52/74/96 tiers, isolated empty hour at reduced
  height, runs of 2+ collapsing to a fixed total, `offsets` monotonic,
  `totalHeight` equal to the last offset
- [x] 2.2 Write the `minutesToY` / `yToMinutes` round-trip tests, including a
  time inside a collapsed run and the exact hour boundaries
- [x] 2.3 Implement `buildTimeScale`, `minutesToY`, `yToMinutes` as pure exported
  functions and get 2.1-2.2 green
- [x] 2.4 Verify the representative-day height claim from design.md (elastic
  total is shorter than the current 1256px while dense hours roughly double)

## 3. Layout

- [x] 3.1 Rewrite the block-geometry tests in `MobileThreeDay.test.jsx` against
  `buildTimeScale` outputs — keep them pixel-exact, do not relax to tolerances
- [x] 3.2 Change `layoutDayEvents` to take the scale as a parameter and position
  via `minutesToY`; keep the string-based `minutesFromDateTime` parse and the
  later-day clamp exactly as they are
- [x] 3.3 Add the cluster-size branch: 1 full width, 2 split, 3+ returns a stack
  descriptor with its envelope and ordered rows
- [x] 3.4 Tests for the stack descriptor: row order by start, `+N more` count
  when the envelope is short, envelope spans min-start to max-end

## 4. Rendering

- [x] 4.1 Render the gap bands with their range labels, and the hour lines only
  for non-collapsed hours
- [x] 4.2 Render the stack container and its rows (dot, title, `time · room`),
  wiring each row to `onEventTap`
- [x] 4.3 Switch `blockStyle` to the full 1px category border over a 12% wash;
  apply the same treatment to the all-day chips
- [x] 4.4 Render the time range on `tall` blocks only; confirm the existing
  "no time on short/med" tests still pass and the `aria-label` is unchanged in
  every tier
- [x] 4.5 Update `MobileThreeDay.css` — gap band, stack, block border, and the
  header comment block that documents the geometry constants (it currently
  states 52px/hour as fixed and will be wrong)

## 5. Scroll behavior

- [x] 5.1 Test for initial scroll: opens at the earliest event hour, falls back
  to 9 AM on an empty window
- [x] 5.2 Implement the initial scroll from the scale rather than the fixed
  `INITIAL_SCROLL_TOP`
- [x] 5.3 Test the clock-time anchor: with a stubbed `scrollTop`, changing
  `selectedDate` to a window with a different density profile preserves the
  time at the top of the viewport
- [x] 5.4 Implement the anchor in a layout effect holding the previous scale in
  a ref, so it runs before paint

## 6. Expand

- [x] 6.1 Tests for `expandedRange`: tapping a stack expands its hours and drops
  the `+N more` row; tapping again collapses; expanding a second range collapses
  the first; a `selectedDate` change clears it
- [x] 6.2 Implement `expandedRange` and feed it into `buildTimeScale` so the
  expanded hours use `EXPANDED_HOUR_HEIGHT`
- [x] 6.3 Make gap bands expandable through the same state
- [x] 6.4 Wrap the state change in `document.startViewTransition` behind a
  feature check and a `prefers-reduced-motion` check; test that the reduced-motion
  path produces the same DOM without calling the API

## 7. Gesture integration

- [x] 7.1 Pass `axisRef` from `MobileCalendarTab` to `MobileThreeDay`; keep the
  prop optional so the component still renders standalone
- [x] 7.2 Test that `onEventTap` and expand both no-op when
  `axisRef.current === 'x'`, and both fire when it is `null` or `'y'`
- [x] 7.3 Add a `MobileCalendarTab` test that the 3-day view receives the same
  `axisRef` the agenda does

## 8. Verify

- [x] 8.1 Re-run the mobile suites and compare against the 1.1 baseline; no new
  failures
- [x] 8.2 Run the full frontend suite once (`npm run test:run`) and compare
  against the documented main baseline
- [ ] 8.3 On-device: confirm the 4-9 PM window is legible with a 3+ cluster
  present, that swiping does not displace the viewport, and that a diagonal drag
  neither expands a range nor opens a block
- [ ] 8.4 On-device: confirm the expand transition under normal and reduced-motion
  settings, and that the grid is usable with the transition unavailable
- [x] 8.5 Suggest the conventional commit message
