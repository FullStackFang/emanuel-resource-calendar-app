## Context

`MobileCalendarTab` is the shell that owns `selectedDate`; `MobileAgenda` and
`MobileThreeDay` are presentational renderings of the same in-memory window
(`useMobileEvents`). That structure is what makes day-stepping a single state
change rather than two implementations, and it is why the swipe can bind once
in the shell and cover both views.

Two constraints shape everything below:

1. `MobileAgenda.jsx:55-66` scrolls the picked day into view whenever
   `selectedDate` changes. Any scroll-driven write to that same state is a
   feedback loop.
2. `MobileAgenda.jsx:69-83` already owns the touch pipeline for
   pull-to-refresh. A second, independent touch pipeline on the same subtree
   would let one gesture fire both behaviors.

## Decision 1 — Split selection intent from scroll observation

Two pieces of state in `MobileCalendarTab`:

| State | Written by | Read by |
|---|---|---|
| `selectedDate` | strip tap, date picker, Today, swipe | `useMobileEvents` fetch window, `datesToShow`, 3-day columns, agenda scroll-into-view |
| `visibleDate` | agenda scroll observation; forced to follow `selectedDate` whenever intent changes | week strip only (highlight, displayed week, month label) |

`MobileWeekStrip` receives `visibleDate` as its `selectedDate` prop and
`setSelectedDate` as `onDateSelect`. Because it derives its displayed week from
that prop, scrolling into the following week flips the strip to that week —
which is the point of the feature — and its own prev/next chevrons step
relative to what the user is actually looking at.

**Alternative rejected:** one state plus a suppression flag around the
programmatic scroll. It works, but correctness then depends on the flag being
cleared on every path including interrupted and cancelled scrolls. The split
makes the loop unrepresentable: nothing that `visibleDate` feeds can cause a
scroll.

Forcing `visibleDate` to follow `selectedDate` on intent changes matters for
perceived latency — a tapped day highlights immediately instead of waiting for
the smooth scroll to land and be observed.

## Decision 2 — Axis lock, and the swipe owns the axis

`useHorizontalSwipe` binds to a wrapper enclosing the view area only, not the
week strip. Rules, in order:

1. Bail on `touches.length > 1` — a pinch is not a swipe.
2. On move, once travel exceeds `AXIS_LOCK_TRAVEL` (10px), lock the axis: `x`
   if `|dx| > |dy| * AXIS_RATIO` (1.5), else `y`. The lock holds for the rest
   of the gesture; a gesture that starts vertical can never become a day step.
3. On end, fire only if the axis is `x` **and** `|dx| >= SWIPE_THRESHOLD`
   (60px). Left advances the day, right goes back.

Distance-only, no velocity term: a slow deliberate drag is a legitimate swipe,
and a velocity floor would make the gesture feel unreliable on a list the user
is already touching for other reasons.

The hook exposes its locked-axis ref, and `MobileAgenda`'s existing
`handleTouchEnd` bails when it reads `x`. The 1.5 ratio plus the 60px threshold
already make the two gestures *nearly* disjoint — an 80px vertical pull would
need 120px of horizontal travel to also register as a swipe — but "nearly" is
not a correctness argument, and the guard is three lines.

**Why not two independent handlers:** whichever component sees the touch first
would be deciding on behalf of the other with no shared view of the gesture.
One pipeline, one authority.

## Decision 3 — Scroll spy as a pure function, not IntersectionObserver

The observation is `dayAtScrollTop(sections, scrollTop) -> 'YYYY-MM-DD'`, in
`src/utils/agendaScrollSpy.js`. `MobileAgenda` attaches a passive,
`requestAnimationFrame`-throttled `scroll` listener on its list ref, reads the
`offsetTop` of each day section from the `dateRefs` map it already maintains,
and reports the result up via a new `onVisibleDateChange` prop.

`useStuckHeader.js` uses `IntersectionObserver` for an analogous job, but
`src/test-setup.js:27` stubs that global as a no-op whose callback never fires.
An observer-based spy could not be covered without changing shared test
infrastructure. Extracting the decision as a pure function instead matches the
established convention in this codebase — `layoutDayEvents`,
`shouldVerifyZeroResult`, `deriveListLoadingState` are all the same shape — and
puts the whole behavior under exhaustive unit test without a render.

The spy is agenda-only. In the 3-day grid the vertical axis is hours, so there
is no day to observe.

## Decision 4 — Ignore observations during a programmatic scroll

`scrollIntoView({ behavior: 'smooth' })` emits scroll events for every
intervening pixel. Left alone, tapping a day four sections away would race the
strip through all four days before settling.

A ref holds the target key while a programmatic scroll is in flight;
observations are ignored until the observed key equals it, at which point the
ref clears. Self-clearing on the terminal condition, so an interrupted or
overridden scroll cannot strand the spy — the next intent change overwrites the
target, and a user scroll that never reaches the target is superseded by the
next tap.

## Decision 5 — No animation

A swipe snaps to the new day. Sliding the 3-day grid would require rendering a
fourth, off-screen column and transforming the track, which means the layout
memo in `MobileThreeDay` has to produce columns it does not display. That is a
structural change to earn a transition. Cut, not deferred.

## Risks

- **Accidental day jumps while scrolling the agenda.** Mitigated by the axis
  ratio and threshold; the residual risk is a user who scrolls with a strong
  diagonal. Adjustable via the two named constants without touching logic.
- **Crossing a Sunday shifts the whole window.** `getWeekRange` starts on
  Sunday, so stepping forward across one changes `datesToShow` and re-renders
  all 14 sections while a scroll animation may be running. This is pre-existing
  behavior for a strip tap into a new week, but swipe makes it reachable one
  day at a time, so it needs on-device confirmation.
- **`MobileWeekStrip` is `React.memo`.** `visibleDate` must be state, not a
  value recomputed each render, or the strip re-renders on every scroll frame.
