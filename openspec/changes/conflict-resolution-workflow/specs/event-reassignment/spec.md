# Spec: event-reassignment

## MODIFIED Requirements

### Requirement: Reassign control on the Additional Information tab
The Submitter Information section SHALL show a "Reassign" affordance only to
users with `canApproveReservations`. It SHALL open a searchable picker of all
registered users (name + email, from `GET /api/users`, fetched lazily on first
open) excluding the current owner, and SHALL commit via the standard
in-button confirmation pattern with success/error toasts.

The affordance SHALL be collapsed at rest, occupying a single line. When
opened, the picker SHALL span the full width of the Submitter Information grid
rather than a single column.

The picker SHALL show at most a fixed number of matches. When more users match
than are shown, it SHALL state how many are hidden and that typing narrows
them. The list SHALL NOT scroll and SHALL NOT be height-constrained, so no
match is ever hidden without being counted.

Once a user is selected, the search SHALL collapse to show the pending
transfer — the current owner, the chosen owner, and the commit action —
rather than continuing to display the result list.

#### Scenario: Approver sees the control
- **WHEN** an approver opens the Additional Information tab of an event review
- **THEN** the Requester cell shows a Reassign affordance

#### Scenario: Non-approver does not see the control
- **WHEN** a requester views the same tab
- **THEN** no Reassign affordance renders

#### Scenario: Collapsed at rest
- **WHEN** the approver has not opened the control
- **THEN** no search input, result list, or commit button is rendered

#### Scenario: Open picker spans the grid
- **WHEN** the approver opens the picker
- **THEN** it spans the full width of the Submitter Information grid

#### Scenario: Picker excludes the current owner
- **WHEN** the approver opens the picker for an event owned by Emily
- **THEN** Emily is absent from the selectable list

#### Scenario: Excess matches are counted, not scrolled
- **WHEN** more users match the search term than the picker shows
- **THEN** the picker states how many further matches exist and that typing
  narrows them, and the list does not scroll

#### Scenario: Selection collapses the search
- **WHEN** the approver selects Jeannette
- **THEN** the result list is replaced by the pending transfer and its commit
  action

#### Scenario: Two-step confirmation
- **WHEN** the approver picks Jeannette and clicks Reassign once
- **THEN** the button enters a "Confirm?" state and no request is sent until a
  second click, which shows "Reassigning..." and disables the button

#### Scenario: Version conflict during reassign
- **WHEN** the reassign request returns 409
- **THEN** the UI shows a one-line error explaining the event changed and
  refreshes the event data (no full ConflictDialog)
