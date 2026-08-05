# Tasks: scheduling-assistant-series-mode

## 1. Extract the conflict fetch into a hook

- [x] 1.1 Write `src/__tests__/unit/hooks/useRecurringConflicts.test.jsx` by
      migrating the fetch-machinery cases from
      `RecurringConflictSummary.test.jsx` (signature-keyed refetch, debounce in
      edit mode, single fetch in readOnly, abort on change, error + retry,
      null-out when inputs incomplete), plus new cases: last-known-blocker
      session map retained for dates skipped this session; occurrence list
      merges exclusion dates (saved + pending) in date order
- [x] 1.2 Create `src/hooks/useRecurringConflicts.js` from
      `RecurringConflictSummary.jsx`'s fetch/state code; return
      `{ occurrences, conflictedDates, loading, error, retry,
      lastKnownBlockers }` where `occurrences` is the merged, date-ordered
      chip model (state: conflicted | clear | skipped, `pending` flag on
      session skips); run 1.1 until green

## 2. Form base: view date, restore, gating

- [x] 2.1 Write failing tests in `RoomReservationFormBase.test.jsx`:
      SVD-1 chip click retargets assistant `selectedDate` and day-availability
      fetch without touching `formData.startDate` or dirty state; SVD-2 view
      date resets when the recurrence stops containing it; SVD-3
      `onConflictChange` is suppressed while viewing a non-start date; RST-1
      `handleRestoreOccurrence` removes a pending exclusion and marks dirty;
      RST-2 restore also removes a previously saved exclusion
- [x] 2.2 Implement in `RoomReservationFormBase.jsx`: `seriesViewDate` state +
      `assistantViewDate = seriesViewDate || formData.startDate` threaded into
      the `selectedDate` prop, the day-availability effect (including
      `lastFetchParamsRef` key and 30s auto-refresh), and the reset effect
      (design D1); `handleRestoreOccurrence` mirroring `handleSkipOccurrence`
      (design D5); `onConflictChange` wrapper no-op while browsing (design
      D9); run 2.1 until green

## 3. SeriesOccurrenceBand component

- [x] 3.1 Write `src/__tests__/unit/components/SeriesOccurrenceBand.test.jsx`
      against the spec scenarios: chip per occurrence with state classes;
      verdict chip keeps the locked 'N of M occurrences have room conflicts'
      phrasing (+ publish blocked / all-clear variants — migrate RCS-1/2/4
      here); selection callback; conflicts focus compresses and inerts
      non-conflicted chips and auto-jumps selection; stepper walks conflicts
      only, wraps, disables at zero; dense (>60) drops labels; compact (>150)
      replaces the row with summary + conflict list
- [x] 3.2 Create `src/components/SeriesOccurrenceBand.jsx` + `.css` per the
      approved mockup (`sa-series-mode-v2.html`): series meta line, date
      chips, focus toggle with count, stepper with position indicator; tokens
      only, no new ad-hoc values; run 3.1 until green

## 4. SeriesVerdictBand component

- [x] 4.1 Write `src/__tests__/unit/components/SeriesVerdictBand.test.jsx`:
      conflicted verdict lists every blocker with title/time/requester or
      Outlook badge and offers Open blocking event + Skip; clear verdict is a
      quiet line with no actions; skipped verdict states pending removal and
      offers Restore; session-skipped-with-blocker warning present, absent
      for saved exclusions; two-step confirm for Skip (warning) and Restore
      (success) — arm, second-click execute, disarm on selection change or
      data refresh; last-occurrence skip refusal message; readOnly hides skip
      and restore but keeps navigation
- [x] 4.2 Create `src/components/SeriesVerdictBand.jsx` + `.css`; run 4.1
      until green; mutation-check: disabling the restore exclusion-removal
      write must fail RST tests, disabling the confirm arming must fail the
      two-step tests

## 5. Assistant composition and panel retirement

- [x] 5.1 Add the optional `series` prop to `SchedulingAssistant.jsx` and
      compose `SeriesOccurrenceBand` (between header and room tabs) and
      `SeriesVerdictBand` (below the timeline); no band logic inside the
      assistant; add mount tests: band renders with `series` present, absent
      otherwise, single-event render byte-identical to today
- [x] 5.2 In `RoomReservationFormBase.jsx`: call `useRecurringConflicts`,
      build the `series` prop (occurrences, selected/view date, handlers:
      select, skip, restore, open-blocker via existing `onOpenBlockingEvent`
      threading, focus state), delete the `<RecurringConflictSummary>` mount;
      update the 4 existing mount tests to threading assertions
- [x] 5.3 Delete `RecurringConflictSummary.jsx`, its CSS, and its test file
      once every migrated case is green elsewhere; grep for remaining imports

## 6. Verification

- [x] 6.1 Run the targeted suites: `useRecurringConflicts`,
      `SeriesOccurrenceBand`, `SeriesVerdictBand`,
      `RoomReservationFormBase.test.jsx`, `SchedulingAssistant` suites, plus
      `useReviewModal.navigation.test.jsx` and
      `ReviewModal.returnBar.test.jsx` (open-blocker threading unchanged)
- [x] 6.2 Measure the full frontend suite against the stash baseline (red
      main: 10 failures / 3 files expected) and confirm no new failures;
      `npm run lint` clean on touched files
- [ ] 6.3 Manual end-to-end on dev (live MSAL session): conflicted series
      shows the band with correct chip states; chip click retargets the
      timeline and badges; conflicts focus + stepper; skip round-trip
      (arm, confirm, chip flips, verdict recount) and restore round-trip
      re-flagging a still-booked date; saved-exclusion restore; readOnly
      review modal shows band without actions; single events unchanged
