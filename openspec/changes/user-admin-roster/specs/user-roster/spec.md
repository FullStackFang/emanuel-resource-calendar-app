## ADDED Requirements

### Requirement: Roster presentation

The user directory at `/admin/users` SHALL render accounts as a single-column roster in which each account occupies one row, and column labels SHALL be printed once in a header strip rather than repeated on every row. The header strip and every row SHALL share one grid template so that values align vertically down the page.

Each row SHALL show, in order: the person (avatar, display name, email), effective role, department, organizational role, title, last activity, and the actions available to the viewer. A row SHALL NOT show the listed account's own calendar preferences.

#### Scenario: Accounts render as aligned rows

- **WHEN** the roster loads with two or more accounts
- **THEN** each account renders as one row
- **AND** the column labels appear exactly once, above the rows
- **AND** each row's cells align with the corresponding header label

#### Scenario: Calendar preferences are absent from the roster

- **WHEN** an account with `preferences.defaultView` and `preferences.startOfWeek` set is rendered in the roster
- **THEN** neither value appears in the row

#### Scenario: Missing optional values read as absent, not blank

- **WHEN** an account has no department, no organizational role, and no title
- **THEN** the department cell reads as explicitly unset
- **AND** the organizational role and title cells render a placeholder rather than empty space

#### Scenario: The signed-in administrator's own row is marked

- **WHEN** the roster contains the row for the currently signed-in user
- **THEN** that row is visually distinguished and carries a "You" marker

### Requirement: Role tabs filter the roster

The roster SHALL present tabs for Everyone, Administrators, Approvers, Requesters, and Viewers. Each tab SHALL display the count of accounts holding that effective role. Selecting a tab SHALL restrict the roster to accounts with that effective role. The counts SHALL reflect the whole directory and SHALL NOT change when other filters narrow the visible rows.

#### Scenario: Selecting a role tab narrows the roster

- **WHEN** the administrator selects the Approvers tab
- **THEN** only accounts whose effective role is approver are listed

#### Scenario: Counts describe the directory, not the filtered view

- **WHEN** a search term is entered that matches one approver
- **THEN** the Approvers tab still shows the total number of approvers in the directory

#### Scenario: Role is derived consistently

- **WHEN** an account carries a server-computed `effectiveRole`
- **THEN** the tab counts and the row's role badge both use that value rather than re-deriving it from legacy fields

### Requirement: Search and filter the roster

The roster SHALL provide a free-text search that matches against display name, email address, and title, case-insensitively, on substring. It SHALL provide selects for department, organizational role, and activity, and a select controlling sort order. All filters SHALL compose, narrowing the result to accounts matching every engaged criterion.

Activity SHALL be derived from `lastLogin`, because the user read model carries no active flag. The buckets SHALL be: signed in within the last 30 days, dormant for 90 days or more, and never signed in.

#### Scenario: Search matches across all three fields

- **WHEN** the administrator types a term matching only an account's title
- **THEN** that account remains listed

#### Scenario: Filters compose

- **WHEN** the Approvers tab is selected, the department filter is set to one department, and the activity filter is set to active within 30 days
- **THEN** only approvers in that department who signed in within 30 days are listed

#### Scenario: Never signed in is distinguishable from dormant

- **WHEN** the activity filter is set to never signed in
- **THEN** only accounts with no `lastLogin` value are listed
- **AND** accounts that signed in long ago are excluded

#### Scenario: Engaged filters are visibly marked

- **WHEN** any filter is set away from its default
- **THEN** that filter control is rendered in its engaged state

#### Scenario: The result count reflects the filtered set

- **WHEN** filters narrow 84 accounts to 1
- **THEN** the roster reports the filtered count against the directory total

#### Scenario: Clearing filters restores the full roster

- **WHEN** at least one filter is engaged and the administrator activates the clear control
- **THEN** every filter returns to its default, the search term is emptied, and all accounts are listed again

#### Scenario: The clear control does not shift the layout

- **WHEN** no filter is engaged
- **THEN** the clear control and result count occupy their space without being visible, so engaging a filter does not move the surrounding controls

### Requirement: Sort the roster

The roster SHALL support sorting by role then name, by name ascending, by name descending, and by most recent activity. The default SHALL be role then name, preserving the current display order in which administrators appear first, then approvers, requesters, and viewers, with each role's members ordered alphabetically.

#### Scenario: Default order is preserved

- **WHEN** the roster loads with no sort selected
- **THEN** accounts appear ordered by role rank, then alphabetically by display name within each role

#### Scenario: Sorting by activity places never-signed-in accounts last

- **WHEN** the administrator sorts by most recent activity
- **THEN** accounts that have never signed in appear after all accounts that have

### Requirement: Edit an account inline without losing the roster

Editing SHALL expand a panel beneath the account's row rather than replacing the roster or opening a modal, so that the surrounding rows and the engaged filters remain visible. The editor SHALL operate on a draft copy of the account held in its own state.

Cancelling SHALL discard the draft and leave the account exactly as it was, with no visible change to its row. Saving SHALL persist the draft and update the row from the server's response.

The editor SHALL expose display name, email, role, department, organizational role, and title, and SHALL expose the account's calendar preferences beneath a subheading that marks them as secondary.

#### Scenario: Cancelling reverts every edited field

- **WHEN** the administrator edits an account's display name, role, and title, then cancels
- **THEN** the row shows the original display name, role, and title
- **AND** no request is sent

#### Scenario: The roster stays visible while editing

- **WHEN** the editor is open for one account
- **THEN** the other rows remain rendered and the engaged filters remain engaged

#### Scenario: Saving updates the row from the server response

- **WHEN** the administrator changes an account's role and saves successfully
- **THEN** the row's role badge shows the new role
- **AND** a success toast is raised

#### Scenario: A failed save keeps the editor open

- **WHEN** a save request fails
- **THEN** an error toast is raised
- **AND** the editor remains open with the administrator's entered values intact

### Requirement: Role-cap gating shapes actionable rows

The roster SHALL continue to derive which accounts a viewer may manage, and which roles a viewer may assign, from the shared role-cap policy rather than from logic local to this screen. A row the viewer may not manage SHALL render without edit or delete controls and SHALL state that an administrator is required.

#### Scenario: An approver cannot manage an approver or an administrator

- **WHEN** an approver views the roster
- **THEN** rows whose effective role is approver or admin render no edit or delete control
- **AND** those rows state that only an administrator can manage them

#### Scenario: An approver's role options are capped

- **WHEN** an approver opens the editor for a row they may manage
- **THEN** the role select offers only roles at or below requester

#### Scenario: The viewer cannot delete their own account

- **WHEN** the roster renders the signed-in user's own row
- **THEN** that row offers no delete control

### Requirement: Destructive actions use in-button confirmation

Deleting an account SHALL require two clicks on the same control. The first click SHALL arm the control, changing its label to a confirmation prompt in the destructive colour. The second click SHALL perform the deletion and show progress. The armed state SHALL persist until the administrator confirms, cancels, or acts elsewhere, and SHALL NOT auto-reset on a timer. No browser confirmation dialog SHALL be used.

#### Scenario: First click arms, second click deletes

- **WHEN** the administrator clicks delete on an account they may manage
- **THEN** the control changes to a confirmation prompt and no request is sent
- **WHEN** the administrator clicks the armed control
- **THEN** the deletion request is sent and the control shows progress

#### Scenario: The armed state can be abandoned

- **WHEN** a delete control is armed and the administrator dismisses it
- **THEN** the control returns to its resting label and no request was sent

#### Scenario: Deletion reports through a toast

- **WHEN** a deletion succeeds
- **THEN** the account leaves the roster and a success toast is raised

### Requirement: Loading, empty, and failure states are distinct

The roster SHALL distinguish first load, background refresh, an empty directory, a filtered-to-nothing result, and a load failure, and SHALL NOT present any of them using another's message.

First load SHALL show a loading indicator and SHALL NOT render an empty state. A background refresh SHALL keep the previously loaded rows and the page chrome mounted, dimmed and non-interactive, rather than replacing them with a spinner. A load failure SHALL never render the empty-directory message.

The filtered-to-nothing state and the failure state SHALL each offer a recovery action: clearing the filters, and retrying the load, respectively.

#### Scenario: First load shows a loader, not an empty state

- **WHEN** the roster query has not yet resolved
- **THEN** a loading indicator is shown
- **AND** no empty state is rendered

#### Scenario: A background refresh preserves the rows

- **WHEN** a refetch runs while accounts are already loaded
- **THEN** the existing rows stay on screen, dimmed and non-interactive
- **AND** no full-page spinner replaces them

#### Scenario: Saving does not blank the page

- **WHEN** an administrator saves an edit and the roster refetches
- **THEN** the roster remains visible throughout

#### Scenario: A load failure is not reported as an empty directory

- **WHEN** the roster query fails
- **THEN** the failure is stated plainly, the message does not claim the directory is empty, and a retry control is offered

#### Scenario: No matches offers a way back

- **WHEN** filters exclude every account
- **THEN** the empty state says no account matches the filters and offers to clear them

#### Scenario: A genuinely empty directory offers a refresh

- **WHEN** the query succeeds and returns no accounts with no filters engaged
- **THEN** the empty state invites creating the first account and also offers a refresh control

### Requirement: Feedback uses the application's toast system

Success, failure, and warning feedback from roster actions SHALL be delivered through the shared notification system rather than through banner state local to this screen, and SHALL NOT be cleared by a timer owned by this screen.

#### Scenario: A created account reports through a toast

- **WHEN** an account is created successfully
- **THEN** a success toast names the account
- **AND** no local banner is rendered above the roster
