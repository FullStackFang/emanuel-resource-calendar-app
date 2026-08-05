# Spec: conflict-resolution-actions

## MODIFIED Requirements

### Requirement: Conflicted occurrences open a resolution drawer
The resolution surface SHALL be the per-day verdict band rendered below the
assistant's timeline, bound to the selected occurrence rather than opened per
row: selecting a conflicted occurrence (chip or stepper) shows that day's
verdict with, for every blocking event, its title, time range, and the name
of the person who requested it — or an explicit synced-from-Outlook badge
when there is no reservation data. Exactly one day's verdict SHALL be shown
at a time (the selected day's); there is no separately opened drawer.
Selecting a clear occurrence SHALL show a quiet all-clear line; selecting a
skipped occurrence SHALL show the skipped verdict described by the restore
requirement.

#### Scenario: Selecting a conflicted occurrence
- **WHEN** the user selects a conflicted occurrence's chip
- **THEN** the verdict band shows each blocking event's title, time range,
  and requester, alongside the timeline rendering those blockers on that day

#### Scenario: One verdict at a time
- **WHEN** the user selects Sep 8 after viewing Aug 11
- **THEN** the band shows only Sep 8's verdict

#### Scenario: Clear occurrences show a quiet verdict
- **WHEN** the user selects an occurrence with no conflict
- **THEN** the band shows a quiet all-clear line with no actions

#### Scenario: Multiple blocking events on one date
- **WHEN** an occurrence is blocked by two events
- **THEN** the band lists both, each with its own detail and its own action
  to open it

### Requirement: The drawer can open the blocking event
The verdict band SHALL offer an action that navigates the review modal to a
blocking event. Activating it SHALL call the modal's navigation with that
event's `id` from the conflict record.

When the form has unsaved changes, the navigation SHALL route through the
existing discard-changes guard rather than navigating directly.

#### Scenario: Navigating to a blocking event
- **WHEN** the user activates the open action for a blocking event
- **THEN** the review modal navigates to that event using its conflict-record
  `id`

#### Scenario: Unsaved changes block direct navigation
- **WHEN** the form has unsaved changes and the user activates the open
  action
- **THEN** the discard-changes guard is shown and no navigation occurs until
  it is resolved

### Requirement: The drawer can skip a conflicted date
The verdict band SHALL offer a skip action on conflicted occurrences that
excludes the occurrence from the series by adding its date to
`recurrence.exclusions` in form state, marking the form dirty through the
same path every other form control uses. No dedicated persistence endpoint
SHALL be introduced; the exclusion is persisted by the normal form save.

The skip action SHALL use the app's two-step in-button confirmation (warning
color): the first activation arms the button, the second executes. Arming
SHALL be cleared by selecting another occurrence or by the conflict data
refreshing, never by a timeout.

Because the hook's fetch is keyed on a signature that includes the
recurrence, the conflict check SHALL re-run as a consequence of the state
change rather than through an explicit refetch call.

The skip action SHALL NOT be offered when the form's fields are disabled.

The system SHALL refuse to skip the last remaining occurrence in a series and
SHALL explain why.

#### Scenario: Skipping a date
- **WHEN** the user arms and confirms skip on the Sep 23 occurrence
- **THEN** `Sep 23` is added to the recurrence exclusions in form state, the
  form is marked dirty, and the conflict check re-runs

#### Scenario: Two-step confirmation
- **WHEN** the user activates skip once
- **THEN** the button arms with a confirmation label and no exclusion is
  written until the second activation

#### Scenario: The band reflects a skipped date
- **WHEN** an occurrence has been skipped but not yet saved
- **THEN** that occurrence's chip renders in a skipped state distinct from
  both conflicted and clear, and the interface states that the change is not
  saved yet

#### Scenario: Skip is unavailable in read-only mode
- **WHEN** the form's fields are disabled
- **THEN** the band offers navigation but no skip or restore actions

#### Scenario: The last occurrence cannot be skipped
- **WHEN** the user attempts to skip the only remaining occurrence
- **THEN** the skip is refused with an explanation, and the recurrence is
  unchanged

## ADDED Requirements

### Requirement: A skipped date can be restored and re-enters conflict checks
Selecting a skipped occurrence SHALL show a verdict stating the date leaves
the series when the form is saved, with a restore action (success color,
two-step in-button confirmation). Restoring SHALL remove the date from
`recurrence.exclusions` in form state through the same dirty-marking path as
skip, for both session-pending and previously saved exclusions. The restored
date SHALL re-enter the conflict check via the signature-keyed refetch with
no special-casing: if the room is still booked, the occurrence returns to the
conflicted state and the publish-blocking counts update accordingly.

When the occurrence was skipped earlier in the same session and had known
blockers, the skipped verdict SHALL warn that the room is still booked and
that restoring will re-flag the conflict. Saved exclusions with no session
memory SHALL offer restore without the warning.

The restore action SHALL NOT be offered when the form's fields are disabled.

#### Scenario: Restoring a clear date
- **WHEN** the user restores a skipped date whose room is free
- **THEN** the date returns to the series as a clear occurrence

#### Scenario: No free pass on restore
- **WHEN** the user restores a date whose blocking event still exists
- **THEN** after the conflict check re-runs, the occurrence renders
  conflicted and the series verdict counts it as blocking publish

#### Scenario: Session-skipped dates warn before restore
- **WHEN** the user selects a date they skipped this session that had a
  blocker
- **THEN** the skipped verdict warns that restoring will re-flag the conflict

#### Scenario: Saved exclusions are restorable
- **WHEN** the form loads a series with a previously saved exclusion and the
  user restores that date
- **THEN** the date is removed from the exclusions in form state, the form is
  marked dirty, and the occurrence re-enters the conflict check
