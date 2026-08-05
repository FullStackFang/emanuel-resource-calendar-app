# Spec: conflict-report-view

## ADDED Requirements

### Requirement: The report has its own route and navigation entry

The application SHALL provide a route for the conflict report, guarded so that
only administrators and users who can approve reservations reach it. The guard
is a user-experience redirect; the server remains authoritative.

The guard predicate is identical to the one protecting the sync health report,
and SHALL be shared by both routes rather than duplicated.

The report SHALL appear in navigation the same way the sync health report does:
as a top-level entry for approvers who are not administrators, and within the
administrative menu for administrators.

#### Scenario: Approver reaches the report
- **WHEN** a user who can approve reservations navigates to the report route
- **THEN** the report renders

#### Scenario: Other roles redirected
- **WHEN** a user with neither permission navigates to the report route
- **THEN** they are redirected away from it

#### Scenario: Navigation entry placement
- **WHEN** an approver who is not an administrator views the navigation
- **THEN** a top-level entry for the report is present

#### Scenario: Administrator navigation entry
- **WHEN** an administrator views the navigation
- **THEN** the report is reachable from the administrative menu

### Requirement: The report scans on open and on control change

The view SHALL run a scan when it opens, using the default window, and SHALL
re-run when the window length or calendar filter changes. It SHALL offer an
explicit re-run action and SHALL display when the currently shown results were
generated.

#### Scenario: Scans on open
- **WHEN** the report is opened
- **THEN** a scan runs with the default window without further user action

#### Scenario: Changing the window re-scans
- **WHEN** the user selects a different window length
- **THEN** a new scan runs for that window

#### Scenario: Freshness is visible
- **WHEN** results are displayed
- **THEN** the time they were generated is shown

### Requirement: Loading and empty states follow the list-view convention

The view SHALL derive its loading state from the project's shared list loading
helper, using the first-load flag to gate its spinner, so that no empty state
renders before the first fetch resolves.

The empty state SHALL render only when the query is settled, the result is
empty, and no background refresh is in flight. It SHALL present the absence of
conflicts as a successful result rather than as a failure, and SHALL offer a
manual refresh affordance.

#### Scenario: No empty state before the first fetch resolves
- **WHEN** the report is opened and the first scan has not yet resolved
- **THEN** a loading indicator is shown and no empty state renders at any point

#### Scenario: Clean calendar reads as good news
- **WHEN** a completed scan finds no conflicts
- **THEN** the view states that no conflicts were found in the scanned window
  and offers a refresh action

#### Scenario: Background refresh does not blank the list
- **WHEN** a re-scan is in flight and previous results are displayed
- **THEN** the previous results remain visible and no empty state renders

### Requirement: Incompleteness and truncation are surfaced

When a scan reports itself incomplete or truncated, the view SHALL display that
above the results. A scan that failed entirely SHALL render an error state with
a retry action, never an empty list.

#### Scenario: Degraded scan banners
- **WHEN** the response reports an incomplete stage
- **THEN** a notice states the results may be incomplete, above the list

#### Scenario: Truncated scan banners
- **WHEN** the response is marked truncated
- **THEN** a notice states that not all occurrences were scanned

#### Scenario: Failed scan is not an empty list
- **WHEN** the scan request fails
- **THEN** an error state with a retry action is shown and no empty state
  renders

### Requirement: Conflicts are presented by date, room, and contested interval

The view SHALL group conflicts under their date and then their room, and SHALL
lead each conflict with its contested interval. Each side of a conflict SHALL
show its title, its own times, its status, and either the requester's name or
an indication that it was synced from Outlook when no requester is recorded.

A side that is one occurrence of a recurring series SHALL be identified as
such.

#### Scenario: Grouping
- **WHEN** conflicts are displayed
- **THEN** they appear grouped by date and then by room

#### Scenario: Contested interval leads
- **WHEN** a conflict is displayed
- **THEN** its contested interval is shown, with each side's own times shown
  alongside

#### Scenario: Outlook-synced side identified
- **WHEN** a side has no recorded requester
- **THEN** it is labelled as synced from Outlook rather than showing a blank
  requester

#### Scenario: Recurring occurrence identified
- **WHEN** a side is one occurrence of a recurring series
- **THEN** it is identified as an occurrence of that series

### Requirement: Either side of a conflict opens in the review modal

Selecting a side of a conflict SHALL open that event in the shared review
experience over the report, so that the actions offered are exactly those the
viewer's permissions allow. The view SHALL NOT compute permission gates itself.

Loading a side SHALL resolve events that carry no reservation data, because
events synced from Outlook are expected among the results.

The report SHALL remain mounted beneath the modal so its scroll position is
preserved, and SHALL refresh its results when the modal reports that the event
was changed or removed.

#### Scenario: Opening a side
- **WHEN** the user selects one side of a conflict
- **THEN** that event opens in the shared review experience

#### Scenario: Outlook-synced side opens
- **WHEN** the selected side has no reservation data
- **THEN** it is still resolved and opened

#### Scenario: Position preserved
- **WHEN** the modal is closed
- **THEN** the report is still displayed at the same scroll position

#### Scenario: Resolved conflict disappears
- **WHEN** the user changes an event in the modal such that the conflict no
  longer exists, and closes the modal
- **THEN** the report refreshes and the conflict is no longer listed

#### Scenario: Permissions are not re-derived
- **WHEN** the review experience is opened from the report
- **THEN** the report supplies raw permissions and caller props only, and the
  shared component determines which actions are offered
