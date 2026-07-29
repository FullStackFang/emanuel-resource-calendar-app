## Context

`getWeekRange(centerDate)` returns the Sunday of that date's week through 13
days later. It is used for two unrelated jobs:

| Consumer | Purpose |
| --- | --- |
| `useMobileEvents` internal effect | what to **fetch** |
| `MobileCalendarTab.datesToShow` | what to **render** |

Because both derive from `selectedDate`, the rendered list is exactly 14 days
and can only move when `selectedDate` moves. Scrolling never moves it:
`mobile-day-navigation` deliberately routes scroll observation into
`visibleDate`, never `selectedDate`, because `MobileAgenda` scroll-into-views on
every `selectedDate` change and the two would drive each other. The result is a
list that dead-ends with no affordance.

Three further properties of the current hook matter to this design:

- **Extension is whole-window.** Crossing a Sunday refetches all 14 days of the
  new window to gain 7 new ones. Harmless at a fixed size; quadratic if the
  range grows.
- **`loadedRangeRef` is a single min/max interval.** Jump three months away and
  it silently claims to cover the intervening gap, so navigating back into that
  gap fetches nothing. A latent bug today; unavoidable to touch here.
- **`fetchingRef` is a hard single-flight.** A second fetch requested while one
  is in flight is dropped with no retry.

## Goals / Non-Goals

**Goals:**

- The agenda extends in both directions as the reader scrolls, without bound.
- No new feedback loop, and the existing intent/observation split survives intact.
- Backward extension does not displace what the reader is looking at.
- Network cost per extension is proportional to the days added, not the days held.
- A far jump neither renders nor fetches the intervening months.
- An extension that fails does not destroy the list the reader already has.

**Non-Goals:**

- Virtualizing or windowing the rendered list. Sections are cheap; if deep
  scrolling ever proves costly that is its own change.
- Extending the 3-day grid. It renders three columns off `selectedDate` and
  never consumed the rendered range.
- Migrating `useMobileEvents` to TanStack Query. Still a separate change.
- A visible "load more" button. The gesture is the affordance.

## Decisions

### D1: The rendered range becomes state in `MobileCalendarTab`, separate from the fetch window

`renderedRange: {start, end}` initialized to `getWeekRange(new Date())`.
`datesToShow` derives from it instead of from `selectedDate`.

This is the change that unpicks the double duty. `getWeekRange` survives
untouched as "the 14-day window around a date" — it just stops being the
rendered list.

*Alternative considered:* keep deriving `datesToShow` from `selectedDate` and
have scroll write `selectedDate`. Rejected — that is precisely the feedback loop
`mobile-day-navigation` was designed to make unrepresentable.

### D2: Scroll extension is a third signal that writes only the rendered range

The state table gains a row:

| State | Written by | Read by |
| --- | --- | --- |
| `selectedDate` | strip tap, picker, Today, swipe | fetch window, 3-day columns, agenda scroll-into-view, `renderedRange` union |
| `visibleDate` | agenda scroll observation | week strip |
| `renderedRange` | `selectedDate` changes, scroll extension | `datesToShow` |

The loop-freedom argument is unchanged in form: **nothing that reads
`renderedRange` causes a scroll.** `datesToShow` only adds sections; the
scroll-into-view effect is keyed on `selectedKey`, which extension never writes.

### D3: Contiguous movement unions; disjoint movement replaces

On `selectedDate` change, compare `target = getWeekRange(selectedDate)` against
`renderedRange`:

- **overlapping** → `renderedRange = union(renderedRange, target)`
- **disjoint** → `renderedRange = target`

Without the disjoint case, picking a date in December from a July session would
render every intervening day and fetch five months. Consecutive 14-day windows
anchored on Sundays overlap by seven days, so ordinary stepping, swiping, and
week-chevron navigation always take the union branch; only a real jump resets.

**Exact adjacency counts as contiguous** (added during implementation). Ranges
are whole-day aligned — start at 00:00:00.000, end at 23:59:59.999 — so a target
beginning 1ms after the loaded end skips no days at all. A naive `target.start >
loaded.end` test calls that disjoint and throws away a range that abuts
perfectly. It is reachable: two windows anchored two Sundays apart touch exactly.
Both the hook and the shell compare with a 1ms tolerance.

The same rule governs `loadedRangeRef`, which **also resets on a disjoint
target** — that is what fixes the min/max bridging bug described in Context.
Events already in memory are kept regardless (the spec requires it, and they are
grouped by date so unrendered days cost nothing).

### D4: Extension fetches only the uncovered span

`coverRange(target)` computes the gaps against `loadedRangeRef` and fetches only
those:

- disjoint → fetch all of `target`, replace the loaded range
- `target.start < loaded.start` → fetch `[target.start, loaded.start)`
- `target.end > loaded.end` → fetch `(loaded.end, target.end]`

Both gaps at once is possible but rare; they are awaited sequentially inside one
`coverRange` invocation so the single-flight guard cannot drop the second. The
single-flight guard moves from `fetchEvents` up to `coverRange` for this reason.

Beyond making unbounded growth affordable, this removes the existing
whole-window refetch on every Sunday crossing.

### D5: Scroll extension commits on success; selection jumps render optimistically

These two look inconsistent and the asymmetry is deliberate.

- A **jump** is stated intent — the reader asked to be at that date, so the day
  sections appear immediately and events fill in behind them. This is today's
  behavior and changing it would make strip taps feel slower.
- A **scroll extension** is not a request to go anywhere. The reader is simply
  reading downward. Growing the list before the data arrives would show fourteen
  days confidently labelled "No events" that may well have events. So the tab
  calls `ensureRange` and commits `renderedRange` only when it resolves
  successfully; a spinner at the extending end covers the wait.

The consequence worth stating plainly: **the rendered range never exceeds the
loaded range in the scroll path**, so there is no optimistic state to roll back
and a failed extension leaves the list exactly as it was.

*Alternative considered:* extend optimistically both ways and roll back on
failure. Rejected — rollback while the reader is mid-scroll would yank content
out from under them, which is worse than a spinner that resolves to nothing.

### D6: The hook keeps `selectedDate` as its declarative trigger and gains one imperative call

`useMobileEvents(selectedDate)` keeps its existing signature and its existing
effect. It gains exactly one method:

- `ensureRange(start, end) → Promise<'covered'|'suppressed'|'error'>`

A three-valued result rather than a boolean because the two failure modes need
different handling: `suppressed` (a fetch was already in flight) should retry
silently on the next scroll, while `error` should offer the reader a retry.
Collapsing them would either nag about a non-problem or swallow a real one.

`refresh` / `retry` now reload the **entire loaded range** rather than
`getWeekRange(selectedDate)`: a reader who has scrolled a month deep and pulls
to refresh must not be left with 14 fresh days and a month of stale ones.

**Revised during implementation.** This decision originally also added
`extending` and `extendError` state to the hook. Both turned out to be
redundant: because the agenda *awaits* `ensureRange`, it already knows an
extension is in flight and already knows which end failed — and the hook does
not, since it has no notion of ends. Two representations of one fact would have
had to be kept in step for no gain, so the affordance state lives solely in
`MobileAgenda` (`busyDirection` / `failedDirection`). The requirement the
original wording protected is unchanged and still enforced in the hook:
`coverRange` is mode-aware and never routes an extension failure into `error`,
so a failed extension cannot swap the list for the full-screen error panel.

*Alternative considered:* make the hook purely declarative by passing the whole
range down as a prop, deleting the `selectedDate` trigger. Cleaner on paper, but
it forces the scroll path back to optimistic rendering (D5) because a prop-driven
hook offers nothing to await. Two triggers with clear owners beat one trigger
with a rollback state machine.

### D7: End proximity folds into the existing rAF-throttled scroll handler

`MobileAgenda.observe()` already runs at most once per frame and already reads
`scrollTop`. It gains:

```
distanceToBottom = scrollHeight - scrollTop - clientHeight
moving down AND distanceToBottom < EXTEND_THRESHOLD_PX  → onExtendRange('future')
moving up   AND scrollTop        < EXTEND_THRESHOLD_PX  → onExtendRange('past')
```

`EXTEND_THRESHOLD_PX = 600` — roughly one viewport, so the fetch is usually done
before the reader arrives.

**Direction of travel, not just proximity.** Added during implementation, where
a proximity-only rule proved wrong at the boundary that matters most: the list
opens at `scrollTop` 0, so *every* session's first downward flick reads as "near
the top" and would prefetch a fortnight of history nobody asked for. Comparing
against the previous observed offset makes "scrolling toward an end" mean what
it says. It also removes a class of test fragility, since a mid-list scroll can
no longer trip an extension by accident.

**Re-arm rule.** After a request fires, no further request may fire in that
direction until a subsequent scroll event moves `scrollTop`. Without it, an
extension that adds fourteen short empty-day sections can land still inside the
threshold and immediately request another, chaining fetches the reader never
asked for. Requiring observed motion makes runaway extension impossible while
still letting a reader who keeps scrolling pull in page after page.

### D8: Backward extension anchors scroll position in a layout effect

Prepending sections above the viewport shifts content down by their height. A
`useLayoutEffect` records the first rendered day section and its offset each
commit; on the next commit it re-measures that same node and applies the
difference to `scrollTop` before paint.

Layout effect rather than effect because the correction must land in the same
frame as the insertion — a `useEffect` correction is a visible jump.

**Anchored on a node, not on `scrollHeight` deltas** (revised during
implementation). A height delta only accounts for prepended *days*; the loading
spinner and the retry row also occupy the top of the list, and each would shift
the reader by its own height when it appeared or vanished. Measuring one node's
movement covers every case with one rule: whatever is inserted above the anchor,
the correction is its displacement, and content appended below moves it by zero.
It also degrades correctly on a distant jump — the anchor node is gone, so no
correction is attempted, which is right because there is no position to keep.

**Requires `overflow-anchor: none` on the list.** Chrome and Firefox implement
native scroll anchoring and would correct the same shift themselves, doubling
it; Safari does not implement it at all. Disabling it buys one deterministic
behavior across engines rather than two that disagree.

## Risks / Trade-offs

- **Unbounded DOM growth.** A reader who scrolls a year deep renders ~365 day
  sections and holds a year of events in memory → No cap in v1. Sections are a
  header plus cards, and reaching that depth by scroll takes sustained effort.
  Revisit with virtualization if it is ever observed; capping would reintroduce
  the dead-end this change exists to remove.
- **Pull-to-refresh cost grows with the range.** Refreshing after scrolling a
  month deep re-requests that whole month → Accepted deliberately (D6): a
  partial refresh that leaves visible days stale is a correctness bug, and the
  payload is bounded by how far the reader chose to scroll.
- **Scroll anchoring can fight iOS momentum.** Adjusting `scrollTop` mid-fling
  may read as a stutter → Anchoring runs pre-paint and only on backward
  extension; the 600px threshold means it normally lands while the reader is
  still well inside the list rather than pinned at the top.
- **Two fetch triggers on one hook.** A jump and a scroll extension can race →
  `coverRange` holds the single-flight guard and returns `false` when suppressed;
  the agenda's re-arm rule (D7) means the next scroll event retries.
- **Existing `useMobileEvents` tests assert whole-window refetch.** They encode
  behavior D4 deliberately changes → Rewrite rather than patch, and keep the
  parity cases that are still true (dedupe, sort, status filter, single-flight).

## Open Questions

- Should there be a hard extension cap (say one year in each direction) as a
  backstop against a stuck scroll handler? Deferred until there is any evidence
  of deep scrolling.
- Should the 3-day grid eventually read `renderedRange` too? It has no vertical
  day axis, so today the question does not arise; it would only matter if a
  horizontal multi-day scroll were ever added.
