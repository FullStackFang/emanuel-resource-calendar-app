## 1. Hook: range coverage

- [x] 1.1 Extract `coverRange(target)` in `useMobileEvents.js` — computes gaps
      against `loadedRangeRef`, fetches only uncovered spans, awaits both gaps
      sequentially when a target extends past both ends
- [x] 1.2 Move the single-flight guard from `fetchEvents` up to `coverRange`
- [x] 1.3 Reset `loadedRangeRef` (rather than min/max-union it) when the target
      is disjoint, fixing the bridged-gap bug
- [x] 1.4 Point the existing `selectedDate` effect at `coverRange` so ordinary
      navigation stops refetching whole windows
- [x] 1.5 Rewrite the `useMobileEvents` tests that assert whole-window refetch;
      keep the dedupe / sort / status-filter / single-flight parity cases
- [x] 1.6 Add tests: gap-only fetch forward, gap-only fetch backward, disjoint
      jump replaces the loaded range, returning into a skipped gap refetches it

## 2. Hook: extension API

- [x] 2.1 Add `ensureRange(start, end) => Promise<'covered'|'suppressed'|'error'>`
      — three-valued rather than boolean, because a suppressed request should
      retry silently on the next scroll while a failed one needs an affordance
- [x] 2.2 ~~Add `extending` / `extendError` to the hook~~ — **dropped as
      redundant**: the agenda awaits `ensureRange`, so it already knows an
      extension is in flight and which end failed, and the hook has no notion of
      ends. State lives in `MobileAgenda` (`busyDirection` / `failedDirection`).
      The requirement this protected is enforced instead by making `coverRange`
      mode-aware so an extension failure never populates `error`
- [x] 2.3 Repoint `refresh` and `retry` at the whole loaded range, falling back
      to `getWeekRange(selectedDate)` when nothing has loaded yet
- [x] 2.4 Add tests: `ensureRange` reports each of its three statuses correctly,
      an extension failure leaves `error` null, refresh after extension refetches
      the full range, refresh replaces rather than appends

## 3. Shell: rendered range state

- [x] 3.1 Add `renderedRange` state to `MobileCalendarTab`, initialized to
      `getWeekRange(new Date())`, and derive `datesToShow` from it
- [x] 3.2 Implement the union-on-overlap / replace-on-disjoint rule in the
      `selectedDate` effect
- [x] 3.3 Add `handleExtendRange(direction)` — computes the 14-day target, calls
      `ensureRange`, commits `renderedRange` only on success
- [x] 3.4 Pass `onExtendRange` to `MobileAgenda` (only — see 2.2)
- [x] 3.5 Add tests: contiguous step unions the range, distant jump replaces it,
      3-day grid rendering is unaffected by range growth

## 4. Agenda: scroll triggers

- [x] 4.1 Add end-proximity detection to the existing rAF-throttled `observe()`
      using `EXTEND_THRESHOLD_PX = 600`
- [x] 4.2 Implement the re-arm rule — a direction cannot fire again until a
      later scroll event moves `scrollTop`
- [x] 4.3 Verify scroll extension never writes `selectedDate` (guards the
      `mobile-day-navigation` loop-freedom requirement)
- [x] 4.4 Add tests: bottom proximity extends forward, top proximity extends
      backward, no repeat request without intervening motion, no
      `onDateSelect`/`selectedDate` write

## 5. Agenda: prepend anchoring and end states

- [x] 5.1 Add the `useLayoutEffect` scroll anchor — re-measures the previously
      first day section and applies its displacement. Node-anchored rather than
      `scrollHeight`-delta'd so the spinner and retry rows, which also sit above
      the reader, are corrected for by the same rule
- [x] 5.2 Render a loading indicator at the extending end while a request is
      in flight
- [x] 5.3 Keep extension failures out of the full-screen error panel (enforced
      in the hook, see 2.2); render an inline retry at the failed end instead
- [x] 5.4 Add the indicator and inline-retry styles to `MobileAgenda.css`, plus
      `overflow-anchor: none` on the list so native scroll anchoring does not
      double the correction from 5.1
- [x] 5.5 Add tests: prepend preserves scroll offset, extension failure keeps the
      list and offers retry, initial-load failure still shows the full-screen
      error

## 6. Verification

- [x] 6.1 Run the mobile suites and confirm no regression against the recorded
      baseline (231/231 mobile, 10 known frontend failures across 3 files)
- [x] 6.2 Run `npm run lint` on the touched files
- [ ] 6.3 On-device: scroll a month forward and a month back, confirm no dead
      end, no viewport jump on backward extension, and that the week strip
      still tracks the day at the top throughout
- [ ] 6.4 On-device: extend the range, then pull to refresh, and confirm every
      rendered day updates
- [x] 6.5 Update the "Current In-Progress Work" section of `CLAUDE.md`
