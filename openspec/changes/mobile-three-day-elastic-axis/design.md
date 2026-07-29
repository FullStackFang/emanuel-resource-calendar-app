## Context

`MobileThreeDay` renders three day columns over a uniform 52px/hour, 24-hour
grid. `layoutDayEvents` groups overlapping events into maximal clusters and
splits the column width equally among a cluster's members. Both rules are
correct on the desktop calendar they were derived from and both fail on a phone:

- **Horizontal.** 390px minus the 28px hour gutter is 362px across three columns
  (~120px each). A three-way cluster leaves each member 40px, of which the 3px
  rail and 8px of padding consume 11px. ~28px of text at 10px DM Sans is about
  five characters.
- **Vertical.** 24 uniform hours give the 4-9 PM window — where essentially every
  collision in this building occurs — 260px of the grid's 1256px.

The view is otherwise sound: the string-based `minutesFromDateTime` parse (never
`new Date()`), the start-day clamping, the all-day chip row, the current-time
indicator, and the density tiers all stay.

Two constraints arrive from `mobile-day-navigation` (commit `3c19acd`):

1. A horizontal swipe on `.mobile-calendar-view` steps `selectedDate` by one day,
   which shifts the 3-day window by one column.
2. `useHorizontalSwipe` exposes `axisRef`, and the established contract is that
   every behavior bound to that subtree reads it and defers. Pull-to-refresh in
   `MobileAgenda` is the existing precedent.

## Goals / Non-Goals

**Goals:**

- Every event visible in the grid carries a legible title at 390px, including
  under three-way and four-way concurrency.
- Pixels are allocated in proportion to density rather than uniformly.
- Cross-day comparison survives: a given clock time sits at the same Y in all
  three columns.
- Stepping a day does not visually displace the events already on screen.
- The grid remains a *grid* — ordered by time, scannable vertically, with the
  current-time indicator meaningful.

**Non-Goals:**

- Pinch-to-zoom the time axis. Considered and deferred; it competes with the
  swipe hook's multi-touch bail and is much harder to test.
- Rotating the axis (time on X) or keying rows by room. Both were prototyped and
  rejected: each requires horizontal scrolling on the exact subtree that
  `useHorizontalSwipe` now owns.
- Any change to `MobileAgenda`, `useMobileEvents`, `eventTransformers`, the
  detail sheet, the fetch window, or query keys.
- Dark mode. The project is light-mode only.

## Decisions

### D1. One elastic scale, derived from the union of the three visible days

Each hour `h` gets a height from the maximum concurrency observed in that hour
across all three columns:

| max concurrency in hour | height |
|---|---|
| 1 | 52px (`HOUR_HEIGHT`, unchanged) |
| 2 | 74px |
| 3 or more | 96px |
| 0, isolated | 20px |
| 0, in a run of 2+ | the run totals 26px, split evenly |

Concurrency is computed per column and then maxed, not computed over the pooled
events — three events at 9 AM on three different days are three separate
single-booking hours, not a three-way overlap.

Keeping `c = 1` at exactly 52px is deliberate: the ordinary hour renders
identically to today, so the change reads as the dense hours expanding rather
than as a wholesale rescale.

*Alternatives considered.* **Per-column scales** would optimise each day
independently but destroy the ability to read across columns, which is the only
reason the 3-day view exists. **A fixed operating-hours profile** (collapse
12a-6a always, 52px until 4 PM, 96px after) is stable across swipes and needs no
anchoring machinery, but it is wrong on the days that do not match the profile —
a Sunday morning religious-school rush would still be crushed.

Net effect on total height, measured against a representative Wed/Thu/Fri: about
1030px versus today's 1256px. The grid gets **shorter** while the dense hours get
close to twice the height.

### D2. Positioning via a piecewise-linear `minutesToY`, with an inverse

`buildTimeScale(columns)` returns `{ hourHeights: number[24], offsets:
number[25], totalHeight, gapRuns }`, where `offsets[h]` is the cumulative top of
hour `h`. Then:

```
minutesToY(scale, minutes) = GRID_TOP_INSET
                           + scale.offsets[hour]
                           + (minutes % 60) / 60 * scale.hourHeights[hour]
```

`yToMinutes(scale, y)` is its inverse over the 24-entry `offsets` array. Both are
pure and exported, which is what makes the geometry testable without a render —
the same property the current `layoutDayEvents` has and the reason its tests can
assert exact pixels.

`layoutDayEvents(events, scale)` takes the scale as a parameter rather than
reading a module constant. Its density tier is then computed from the *rendered*
height, so tiers become a function of density-adjusted geometry: a one-hour event
in a contended hour is 96px and reads `tall`, while the same event in a quiet
hour is 52px and also reads `tall`. The tier thresholds themselves do not move.

### D3. Scroll is anchored to clock time across a scale change

A swipe changes the window, which changes the union, which changes the scale.
Without compensation a block at 4 PM jumps to a new Y under the user's finger.

On a scale change:

1. `anchorMinutes = yToMinutes(previousScale, scrollTop)` — captured before the
   new scale is applied.
2. `scrollTop = minutesToY(nextScale, anchorMinutes)` — applied in a layout
   effect, before paint.

The previous scale is held in a ref. If the anchor time lands inside a collapsed
run under the new scale, `minutesToY` still returns a valid position inside the
band; no special case is needed.

This machinery is reused for the initial scroll (D6) and for expand (D5).

### D4. Overlap handling is tiered, not uniform

- **Cluster of 1** — full column width, as today.
- **Cluster of 2** — split 50/50, as today. At 60px wide the block now has 74-96px
  of height to wrap into, which is the difference between three legible lines and
  one truncated one.
- **Cluster of 3 or more** — a **stack**: one bordered container spanning the
  cluster's time envelope, containing one full-width row per event with a
  category dot, the title, and `time · room`. Rows are ordered by start. When the
  envelope cannot fit every row at `STACK_ROW_HEIGHT`, it renders as many as fit
  and a final `+N more` row.

The trade is explicit: inside a 3+ cluster, individual events lose their exact
vertical extent and keep only the cluster envelope. Titles become readable in
exchange. This is the correct trade at 40px of available width, where the
alternative preserves a duration nobody can read the label of.

*Alternative considered.* Outlook-style cascading offsets (each overlapping event
inset and drawn on top) preserve duration for all members, but the topmost event
is still only ~40px wide, so it solves the wrong half of the problem.

### D5. Tap-to-expand is one state with two triggers

`expandedRange: { fromHour, toHour } | null`.

- Tapping a **stack** sets the range to its cluster's hour span.
- Tapping a **gap band** sets the range to that empty run.
- Tapping either again clears it. Only one range is expanded at a time.

Hours inside an expanded range render at `EXPANDED_HOUR_HEIGHT` (168px), enough
for a stack to show every row without a `+N more`, and enough for a collapsed
empty run to become a bookable-looking span. Neighbouring hours keep their
natural heights and the grid simply grows; the D3 anchor holds the expanded
range's start at its previous position, so nothing jumps.

*Alternative considered.* Compressing neighbours to hold total height constant
avoids growth entirely, but it means tapping one region silently degrades
another, and a user who expands 4-9 PM would find the morning unreadable without
knowing why.

Motion: the state change is wrapped in `document.startViewTransition` when the
API exists and `prefers-reduced-motion: reduce` is not set. Otherwise the state
changes instantly. The feature is fully functional with no transition — the
transition is the polish, not the mechanism.

`expandedRange` is cleared whenever `selectedDate` changes: after a swipe the
hour range refers to a window that is no longer on screen.

### D6. Initial scroll targets the day's first event

`INITIAL_SCROLL_HOUR = 9` is replaced by the earliest hour carrying an event in
the three-day window, falling back to 9 AM when the window is empty. With the
elastic axis the pre-dawn hours cost ~26px total, so opening at the first real
event no longer hides anything the user might scroll up for.

### D7. Blocks get a full tinted border; the time returns at `tall`

`blockStyle` changes from `border-left: 3px solid <c>` over `<c>14` (8%) to
`border: 1px solid <c>B3` over `<c>1F` (12%). This returns 3px of text width per
block, removes the side-stripe treatment, and reads as a more deliberate object.
The all-day chips follow the same rule so the two rows stay one system.

The existing rule "never render the start time as text" is **narrowed, not
reversed**: the time range renders on `tall` blocks only. The rule exists because
on a 26px block the time line consumed the only line the title had — which is
still true, and short/med blocks still omit it. But a non-linear axis makes
vertical position a weaker statement of duration, and `tall` blocks in dense
hours are now 96px+, where a 8.5px time line costs nothing. The `aria-label`
continues to carry the time in every tier, unchanged.

### D8. Expand defers to the swipe axis lock

`MobileThreeDay` gains an optional `axisRef` prop, passed from
`MobileCalendarTab` from the same `useHorizontalSwipe` call that feeds
`MobileAgenda`. Both the expand handler and `onEventTap` return early when
`axisRef.current === 'x'`, so a 60px horizontal drag that happens to end over a
block steps the day and does nothing else. The prop is optional so the component
still renders standalone in tests.

## Risks / Trade-offs

- **Block heights change under the finger on every swipe** → D3 anchors the
  *viewport* to clock time, which removes the jump for the region being looked
  at. Individual block heights still change when the concurrency profile of an
  hour changes between windows. Accepted: the alternative is a fixed profile that
  is wrong on the days that matter most.
- **The vertical axis no longer encodes duration linearly** → D7 restores an
  explicit time range on `tall` blocks, which is where the distortion is largest.
  Short blocks keep the aria-label. Users who need exact durations have the
  detail sheet.
- **A 3+ cluster hides individual extents** → the stack header states the cluster
  envelope, every row states its own `time · room`, and tapping expands to the
  full list. The information is one tap away rather than absent.
- **One busy day inflates the scale for its two quiet neighbours** → intentional,
  and the cost is bounded: the quiet day gets taller rows, not distorted ones,
  and all three still share an axis. A per-column scale would be worse.
- **View Transitions has no Firefox support for cross-document, and the
  same-document API is recent** → feature-detected. There is no visual or
  functional dependency on it.
- **The test file is rewritten, not extended** → this is the largest single risk
  to correctness, because the existing pixel-exact assertions are the only thing
  standing between a timezone regression and a grid that is silently an hour off.
  Mitigation: the new assertions stay pixel-exact against `buildTimeScale`
  outputs rather than relaxing to tolerances, and `buildTimeScale` /
  `minutesToY` / `yToMinutes` get direct unit tests independent of any render.
  Baseline the mobile suites before and after per CLAUDE.md, since the suite is
  red on main.

## Migration Plan

Frontend-only and self-contained; there is no data migration and no rollout
gate. The view is reachable only through the mobile calendar tab's `3 Day`
segment, and the preference already persists per user in `localStorage` under
`mobile-calendar-view`. Rollback is a revert of the single commit.

## Open Questions

- Should an expanded range persist across a view switch (`3 Day` → `Agenda` →
  `3 Day`)? Currently it does not — the component unmounts. Leaving it that way
  unless on-device use argues otherwise.
- `EXPANDED_HOUR_HEIGHT = 168px` is derived from four `STACK_ROW_HEIGHT` rows
  plus the header, which covers the worst cluster in the sample data. A five-way
  cluster would still truncate. Deferring a dynamic value until on-device
  verification shows whether five-way clusters actually occur.
