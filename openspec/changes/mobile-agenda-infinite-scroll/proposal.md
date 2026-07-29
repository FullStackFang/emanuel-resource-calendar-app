## Why

The mobile agenda dead-ends. It renders exactly the days in
`getWeekRange(selectedDate)` — the Sunday of the selected week through 13 days
later — and scrolling to the bottom of that list produces nothing further. From
today the reader can reach roughly three days back and ten days forward before
the list simply stops, with no affordance explaining why.

The cap is structural, not a data problem. `getWeekRange` serves two purposes at
once: it is both the fetch window and the rendered day list. The window only
extends when `selectedDate` moves outside it, and scrolling deliberately never
writes `selectedDate` — the scroll spy writes `visibleDate` only, precisely so
that scroll and scroll-into-view cannot drive each other. That split is correct
and stays, but it left scrolling as the one navigation gesture that cannot
extend the range: the reader must tap the strip, use the date picker, or swipe.

## What Changes

- The agenda's **rendered day range becomes its own state**, decoupled from the
  fetch window. Scrolling within a threshold of either end appends another two
  weeks at that end, without bound.
- **Scroll-driven extension is a third signal** alongside selection intent and
  scroll observation. It writes only the rendered range — nothing that consumes
  the rendered range causes a scroll, so no feedback loop is introduced.
- **Backward extension preserves scroll position.** Prepending day sections
  above the viewport would otherwise displace what the reader is looking at.
- **Fetches cover only the uncovered span.** Today an extension refetches the
  entire new 14-day window including days already held; with an unbounded range
  that would re-request an ever-growing span on every extension. Gap-only
  fetching also removes an existing inefficiency: crossing a Sunday currently
  refetches all 14 days to gain 7 new ones.
- **A distant jump resets rather than unions.** Selecting a date months away
  must not render (or fetch) every intervening day. Contiguous movement extends;
  disjoint movement replaces.
- The 3-day grid is untouched — it renders three columns off `selectedDate` and
  never consumed the rendered range.

## Capabilities

### New Capabilities

None. This extends existing behavior rather than introducing a new surface.

### Modified Capabilities

- `mobile-agenda`: the "Data loading with incremental range" requirement
  currently ties range growth to week-strip navigation alone. It gains
  scroll-driven extension in both directions, unbounded growth, gap-only
  fetching, scroll-position preservation on backward extension, and the
  disjoint-jump reset rule.
- `mobile-day-navigation`: its "Scroll observation does not move the fetch
  window" scenario asserts that scrolling changes neither the loaded event range
  **nor the rendered day list**. That is exactly what this change reverses. The
  scenario narrows to what it was actually protecting — scrolling must not move
  the *focused day* (`selectedDate`), because that is what would close the
  feedback loop. Range growth was never the hazard.

## Impact

- `src/hooks/useMobileEvents.js` — takes a range rather than a date; fetches
  uncovered spans instead of whole windows; exposes an extension-in-flight flag.
  `getWeekRange` stays exported and unchanged.
- `src/components/mobile/MobileCalendarTab.jsx` — owns the new rendered-range
  state, the contiguous-extend / disjoint-reset rule, and the extend callback.
- `src/components/mobile/MobileAgenda.jsx` — end-proximity detection folded into
  the existing rAF-throttled scroll handler; layout-effect scroll anchoring on
  backward extension; a loading affordance at the extending end.
- `src/components/mobile/MobileAgenda.css` — the loading affordance.
- Tests: `useMobileEvents.test.jsx`, `MobileAgenda.test.jsx`,
  `MobileCalendarTab.test.jsx`. Several existing `useMobileEvents` cases assert
  the whole-window refetch behavior and will be rewritten, not merely extended.
- No backend, endpoint, schema, or query-key change. `POST /events/load` is
  called with the same body shape, only narrower ranges.
