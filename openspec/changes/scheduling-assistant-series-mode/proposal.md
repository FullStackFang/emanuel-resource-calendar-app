# Proposal: scheduling-assistant-series-mode

## Why

For a recurring series, conflict information and the room timeline live in two
disconnected surfaces: `RecurringConflictSummary` (a panel below the
SchedulingAssistant) knows WHICH occurrences conflict, while the
SchedulingAssistant knows WHAT the room looks like on one day — but only the
form's start day. Resolving a conflict therefore means reading the panel,
mentally mapping a date onto a timeline the assistant refuses to show, and
acting through a drawer that repeats information the timeline could render
directly. An approved interactive mockup (`sa-series-mode-v2.html`, reviewed
2026-08-05) integrates the two: the occurrence strip becomes a date-chip band
inside the assistant that retargets the timeline, with per-day verdict and
resolution actions anchored to what the timeline is showing.

## What Changes

- **SchedulingAssistant gains a series mode**: when the form has an active
  recurrence with `pattern` + `range` and at least one room, an occurrence
  band renders inside the assistant chrome (between header and room tabs):
  one date chip per occurrence (month + day), states conflicted / clear /
  skipped / selected, driven by the existing
  `POST /rooms/recurring-conflicts` response. No new endpoint.
- **Chips navigate the timeline**: clicking a chip sets a series *view date*,
  distinct from the form's start date; the assistant's day timeline, room-tab
  conflict badges, and event blocks re-render for that date. The form's
  date/time fields never change from browsing.
- **Conflicts-only focus**: an All dates / Conflicts toggle (with live count)
  compresses clear and skipped chips to small stubs, and prev/next arrows step
  through conflicted occurrences only, with a "conflict n of m" position
  indicator.
- **Per-day verdict band replaces the resolution drawer**: below the timeline,
  the selected day's verdict renders as one band — blocker title, time,
  requester name (or "Synced from Outlook"), with `Open blocking event` and
  `Skip this date` actions. Clear days show a quiet all-clear line; skipped
  days show a pending-removal note with a `Restore this date` action.
- **Skip is reversible — no free pass**: skip appends the date to
  `recurrence.exclusions` in form state (existing mechanism); restore removes
  it, whether the exclusion is session-pending or previously saved. A restored
  date re-enters the conflict check via the signature-keyed refetch, so a
  still-booked room re-flags immediately. Both actions use the app's two-step
  in-button confirmation.
- **Standalone panel retired from the form**: `RoomReservationFormBase` stops
  mounting `RecurringConflictSummary` below the assistant; its fetch logic is
  extracted into a reusable hook that feeds the band. Density fallbacks carry
  over: chips drop their labels above 60 occurrences, and above 150 the band
  collapses to the compact text summary plus conflict list.

## Capabilities

### New Capabilities
- `sa-series-navigation`: the SchedulingAssistant occurrence band as a
  navigation surface — series-mode activation, view-date vs form-date
  separation, chip selection retargeting the day timeline, conflicts-only
  focus with stepper, density fallbacks.

### Modified Capabilities
- `recurring-conflict-visibility`: the per-occurrence conflict surface moves
  from a standalone panel below the SchedulingAssistant into the assistant's
  own chrome (occurrence band + series verdict chip); the standalone
  `RecurringConflictSummary` mount in `RoomReservationFormBase` is removed.
- `conflict-resolution-actions`: the resolution drawer is replaced by the
  per-day verdict band (same open-blocker and skip semantics, anchored to the
  timeline's selected day); a new restore action reverses a skip, including
  previously saved exclusions, and restored dates re-enter conflict checking.

## Impact

- **Frontend only; zero backend surface.** `POST /rooms/recurring-conflicts`
  is consumed unchanged.
- `src/components/SchedulingAssistant.jsx` / `.css`: hosts the band and
  verdict band (new presentational subcomponent(s), props-driven).
- `src/components/RecurringConflictSummary.jsx`: fetch/state machinery
  extracted to a hook (e.g. `useRecurringConflicts`); the standalone panel
  rendering is retired from the form path.
- `src/components/RoomReservationFormBase.jsx`: swaps the panel mount for band
  props threading; `handleSkipOccurrence` gains a restore counterpart that
  removes dates from `recurrence.exclusions`.
- Existing threading reused: `onOpenBlockingEvent`
  (EventReviewExperience → RoomReservationReview → form base) and the
  discard-changes navigation guard.
- **Tests**: `RecurringConflictSummary.test.jsx` (22) and the 4 mount tests in
  `RoomReservationFormBase.test.jsx` rewritten against the new surface; new
  suites for the hook, the band (navigation, focus, density), and skip/restore
  round-trips. Locked RCS-1/2/4 phrasing assertions from
  recurring-publish-conflict-blocking migrate to the band's verdict chip.
- Builds on the unarchived `conflict-resolution-workflow` and
  `recurring-publish-conflict-blocking` changes; their specs are the baseline
  these deltas modify.
