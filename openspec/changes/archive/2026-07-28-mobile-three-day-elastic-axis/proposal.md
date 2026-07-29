## Why

The 3-day grid is illegible at Temple Emanuel's real evening density, and the
cause is arithmetic rather than styling. On a 390px phone the grid has 362px for
three day columns (~120px each). `layoutDayEvents` splits a column equally across
an overlap cluster, so two concurrent events get 60px and three get 40px; after
the 3px rail and 8px of horizontal padding a three-way overlap leaves roughly
28px of text width, about five characters at the current 10px type. Concurrency
is not an edge case here — this is a room-reservation calendar where four rooms
booked at 7 PM is an ordinary Wednesday.

The vertical axis compounds it. A uniform 52px/hour spends 21% of the grid's
height on the 4-9 PM window where every collision happens, and the other 79% on
hours that are usually empty, including a midnight-to-6 AM stretch that is empty
every single day.

## What Changes

- **BREAKING (internal geometry)**: the uniform `HOUR_HEIGHT` scale is replaced
  by an **elastic time axis**. Each hour's rendered height is derived from the
  maximum concurrency observed in that hour across the three visible days; runs
  of two or more empty hours collapse into a single labelled rule. All three
  columns share one scale, so cross-day comparison is preserved.
- Block positioning moves from `GRID_TOP_INSET + minutes/60 * HOUR_HEIGHT` to a
  piecewise-linear `minutesToY()` mapping built from the per-hour heights.
- **The scroll position is anchored to clock time across a window change.** A
  swipe steps the day, which changes the three-day union, which changes the
  scale. Without compensation a block at 4 PM visibly jumps. After a scale
  rebuild the scroll offset is re-solved so the time at the top of the viewport
  is unchanged.
- Overlap handling becomes tiered rather than uniform: clusters of two still
  split the column (now with enough height to wrap), clusters of three or more
  render as a **stack** — one bordered container spanning the cluster's time
  envelope, listing each event on its own full-width row with title, time, and
  room, plus a `+N more` row when the envelope cannot fit them all.
- **Tap-to-expand**: tapping a stack, or the gap band, expands that time range
  in place; neighbouring hours compress to make room. Driven by the View
  Transitions API where available, with an instant state change as the fallback
  and under `prefers-reduced-motion`.
- The expand gesture defers to the existing swipe axis lock. `MobileThreeDay`
  gains the `axisRef` prop `MobileAgenda` already receives, so a horizontal drag
  that ends over a block cannot also expand it.
- **BREAKING (visual)**: event blocks and all-day chips move from a 3px
  `border-left` category rail over an 8% wash to a full 1px category-tinted
  border over a 12% wash. This returns 3px of text width per block and removes
  the side-stripe treatment.
- Initial scroll changes from a fixed 9 AM to the first hour of the day that
  carries an event, falling back to 9 AM on an empty window.

## Capabilities

### New Capabilities
- `mobile-three-day`: the 3-day time grid's layout contract — the elastic time
  axis, empty-run collapsing, the overlap tiering rules, scroll anchoring across
  a window change, tap-to-expand, and the block density/colour treatment.

### Modified Capabilities
<!-- None. `mobile-day-navigation`'s swipe and axis-lock requirements are
     consumed unchanged; this change adds a second consumer of `axisRef` rather
     than altering the gesture contract. `mobile-agenda` is untouched. -->

## Impact

- `src/components/mobile/MobileThreeDay.jsx` — `layoutDayEvents` gains scale
  awareness; new `buildTimeScale()` and `minutesToY()` pure functions; new stack
  rendering branch; expand state.
- `src/components/mobile/MobileThreeDay.css` — hour-line, gap-band, stack, and
  block-colour rules.
- `src/components/mobile/MobileCalendarTab.jsx` — passes `axisRef` to
  `MobileThreeDay` (one prop; the agenda call site is unchanged).
- `src/__tests__/unit/components/mobile/MobileThreeDay.test.jsx` — the block
  position, initial scroll, three-way split, and rail colour assertions are
  pinned to the constants this change replaces and are rewritten against the new
  mapping. The exactness is retained: a grid drawn an hour off still looks like a
  valid calendar, so the new assertions stay pixel-exact rather than tolerant.
- No backend, API, schema, or query-key change. `useMobileEvents`,
  `eventTransformers`, and the detail sheet are untouched.
- No new dependencies. View Transitions is used through feature detection only.
