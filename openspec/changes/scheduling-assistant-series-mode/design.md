# Design: scheduling-assistant-series-mode

## Context

`RoomReservationFormBase` currently renders two disconnected recurring-series
surfaces:

- `SchedulingAssistant` (line ~2489): presentational day timeline. It receives
  `selectedDate={formData.startDate}`, plus `availability` fetched by the form
  base's `checkDayAvailability(roomIds, date)` (effect at ~1066, keyed on
  `assistantRooms` + `formData.startDate` + `currentReservationId`, deduped by
  `lastFetchParamsRef`, auto-refreshed every 30s). It only ever shows the
  first occurrence's day.
- `RecurringConflictSummary` (line ~2531): owns the
  `POST /rooms/recurring-conflicts` fetch (signature-keyed, debounced in edit
  mode, single-shot in readOnly), and renders verdict header, occurrence
  strip, and a single resolution drawer with open-blocker/skip actions.

Existing plumbing this design reuses unchanged: `onOpenBlockingEvent`
(threaded EventReviewExperience → RoomReservationReview → form base, routed
through the discard-changes guard), `handleSkipOccurrence` (appends to
`recurrence.exclusions` via `setRecurrencePattern`, marks dirty, refuses the
last remaining occurrence), `pendingSkippedDates` (derived: current exclusions
minus `savedRecurrenceExclusions`), and the dense/compact strip thresholds
(60 / 150).

An approved interactive mockup (`sa-series-mode-v2.html`, 2026-08-05) defines
the target UI: date chips inside the assistant chrome, a series verdict chip,
conflicts-only focus with stepper, and a per-day verdict band with
open-blocker / skip / restore.

## Goals / Non-Goals

**Goals:**
- One surface: conflict awareness, navigation, and resolution all inside the
  SchedulingAssistant, with the timeline showing the occurrence being resolved.
- Skip is visibly reversible; restored dates re-enter conflict checking with
  no special-casing.
- Zero backend change; one recurring-conflicts request drives the whole band.
- readOnly (approver review) gets the same band minus mutating actions.

**Non-Goals:**
- No change to conflict-check semantics, publish blocking (409), or
  force-publish affordances.
- No per-occurrence time editing (dragging the user block still edits the
  series-wide times).
- No mobile variant; this is the desktop form/review modal only.
- Not touching the recurrence editor UI or `formatRecurrenceSummary`.

## Decisions

### D1. The form base owns series-view state; the assistant stays presentational

New state in `RoomReservationFormBase`: `seriesViewDate: string | null`
(`YYYY-MM-DD`; `null` means "follow the form's start date"). The effective
assistant date becomes `seriesViewDate || formData.startDate`, used in three
places: the `selectedDate` prop, the day-availability effect (its
`dateToCheck` and `lastFetchParamsRef` key), and the 30s auto-refresh.
Chip clicks call `setSeriesViewDate(date)`.

*Why not state inside SchedulingAssistant?* The availability fetch lives in
the form base; a date the assistant chose for itself could not retarget the
fetch without inverting the existing data flow. This is the same
intent-vs-observation separation as mobile's `selectedDate` / `visibleDate`:
browsing occurrences must never write `formData.startDate` (that would
reschedule the series).

*Reset rule:* an effect clears `seriesViewDate` to `null` whenever it no
longer matches an occurrence or exclusion of the current recurrence (pattern
change, range change, rooms emptied, recurrence removed). Structural, not
event-based: no stale view date can survive a recurrence rewrite.

### D2. Fetch machinery extracted to `useRecurringConflicts`; panel retired

`RecurringConflictSummary`'s fetch/state (signature-keyed request, debounce,
abort, loading/error/data) moves to `src/hooks/useRecurringConflicts.js` with
the same inputs the component takes today. The form base calls the hook and
threads results down. The standalone `<RecurringConflictSummary>` mount below
the assistant is deleted; the component file is retired (its rendering is
superseded by the band; anything reusable moves with the hook).

*Why a hook and not a data-only render-prop component?* The form base already
composes both surfaces; a hook gives it the data where the handlers
(`handleSkipOccurrence`, restore, view-date) already live, with no extra
component layer.

### D3. Two new presentational components composed by SchedulingAssistant

- `SeriesOccurrenceBand` — series meta line (pattern summary + verdict chip),
  date chips, focus toggle, conflict stepper. Rendered between the assistant
  header and the room tabs.
- `SeriesVerdictBand` — the selected day's verdict: conflicted (blocker
  title / time / requester or Outlook badge + Open blocking event + Skip),
  clear (quiet check line), skipped (pending-removal note + Restore
  + still-booked warning when a last-known blocker exists).

`SchedulingAssistant` gains one optional prop, `series` (object bundling
occurrences, selected date, focus handlers, action handlers, loading/error).
When absent (single events) the assistant renders exactly as today. The two
subcomponents live in their own files with their own CSS; the assistant only
composes them — no band logic inside the existing 2,000-line component.

### D4. Occurrence model: expanded dates ∪ exclusions, all client-derived states

The band's chip list merges:
- `allOccurrences` from the recurring-conflicts response (conflicted / clear),
- `recurrence.exclusions` dates (skipped) — both saved and session-pending,
  distinguished via the existing `pendingSkippedDates` derivation.

The endpoint honors exclusions during expansion, so excluded dates never come
back from the server; the band re-inserts them client-side in date order.
This is the same merge the current strip does for pending skips, extended to
saved exclusions so restore is offered for both.

*Last-known blockers:* when a conflicted date is skipped this session, the
hook retains its blocker list in a session map (keyed by date) so the skipped
verdict can warn "the room is still booked here; restoring re-flags the
conflict." Saved exclusions have no session memory → no warning, restore
offered plainly. The warning is honest UI, not a guarantee; the refetch after
restore is the authority.

### D5. Restore: `handleRestoreOccurrence`, symmetric with skip

New handler in the form base: removes the date from
`recurrence.exclusions` via `setRecurrencePattern` + `setHasChanges` +
`notifyDataChange` — the exact mirror of `handleSkipOccurrence`. The
signature-keyed hook refetch then re-expands the date and re-checks it: a
restored date gets no free pass by construction, because the server never
knew it was special. Works identically for saved exclusions (the exclusion
array is just form state; persistence happens on normal save). No guard
needed for "restore the last occurrence" (restore only grows the series).
Both skip and restore are null when `fieldsDisabled`.

### D6. Conflicts-only focus and stepper are pure band-local UI state

`focusMode: 'all' | 'conflicts'` lives in `SeriesOccurrenceBand`. In
conflicts focus: non-conflicted chips compress to 14px stubs (not hidden —
temporal context like "the conflicts cluster in early fall" survives), and
are inert to clicks; entering focus with a non-conflicted selection jumps to
the first conflicted date. The stepper (‹ › + "conflict n of m") steps
through conflicted dates only and works in both modes; it disables at zero
conflicts. Focus state resets when the band unmounts; it is not persisted.

### D7. Verdict-chip phrasing carries the locked assertions

The series verdict chip keeps the locked '\<N\> of \<M\> occurrences have room
conflicts' sentence fragment (RCS-1/2/4 from recurring-publish-conflict-
blocking) as its accessible text, with '· publish blocked' appended in the
blocked state and an 'All clear · ready to publish' clear state. The locked
tests migrate to the chip rather than being weakened.

### D8. Confirmation pattern per app standard

Skip (warning color) and Restore (success color) both use two-step in-button
confirmation: first activation arms ("Confirm skip?" / "Confirm restore?",
pulsing), second executes. Arming is cleared by selecting another chip,
toggling focus, or the data refetching — never by a timeout.

### D9. onConflictChange is suppressed while browsing a non-form date

The assistant's `onConflictChange` (which drives `hasSchedulingConflicts`
gating in the parent) reports the *rendered* day. When
`seriesViewDate && seriesViewDate !== formData.startDate`, the form base
wraps the callback to no-op: browsing occurrence #7's conflicts must not
flip the first-occurrence gating that non-recurring save paths read.
Recurring publish gating is server-authoritative (409) and unaffected.

### D10. Density fallbacks (carried thresholds)

- ≤ 60 occurrences: full chips (month + day).
- 61–150: chips drop their labels and render as 14px state squares (the
  current dense strip look); selection ring, focus compression, and stepper
  keep working.
- \> 150: the chip row is replaced by the existing compact text summary plus
  the conflict list; the stepper remains the navigation affordance.

## Risks / Trade-offs

- [Chip click = one availability fetch per browsed day] → Acceptable: the
  fetch is the assistant's existing single-day query, deduped by
  `lastFetchParamsRef`; browsing N days costs N small queries, same as
  changing the form date N times today.
- [Dragging the user block while viewing occurrence #7 edits series-wide
  times] → Semantically correct (occurrences share time-of-day) but possibly
  surprising; the existing drag tooltip already shows the new times. Called
  out for the manual-verification pass.
- [SchedulingAssistant complexity growth] → Mitigated by D3: band and verdict
  are separate presentational files; the assistant adds only composition and
  one prop.
- [Stale seriesViewDate after recurrence edits] → D1 reset rule is
  structural (validity check against current occurrence set), not tied to
  remembering every mutation site.
- [Session-only blocker memory (D4) can lie across reloads] → The warning is
  advisory; the authoritative recheck happens on restore. A reloaded form
  simply shows no warning.
- [Removing RecurringConflictSummary breaks its 22-test suite plus 4 mount
  tests] → Planned rewrites, not collateral: hook tests inherit the fetch
  cases, band tests inherit strip/drawer cases, form-base tests swap mount
  assertions for threading assertions.
- [readOnly review modal must not lose conflict visibility] → The band
  renders in readOnly with navigation and verdicts; only skip/restore/drag
  are absent — strictly more visibility than the current readOnly panel.

## Migration Plan

Frontend-only, no data or API migration. Single PR; revert = rollback. The
retired component file and its CSS are deleted in the same change to avoid a
dead-code interregnum.

## Open Questions

- Should the focus toggle hide when the series has no conflicts (chip already
  says all-clear)? Leaning yes — render toggle and stepper only when
  `conflictedCount > 0`. To be settled during implementation with a look at
  the rendered result.
- Exact `series` prop shape (one object vs. grouped props) — settled in code
  review of the first task; the object form is the default.
