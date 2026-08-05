# Spec: room-conflict-report

## ADDED Requirements

### Requirement: A scan reports room double-bookings across a forward window

The system SHALL provide a read-only endpoint that scans a forward date window
and reports every genuine room conflict among published events.

The endpoint SHALL accept a window length of 30, 90, 180, or 365 days,
defaulting to 90, always beginning today. Any other value SHALL be rejected
with 400 rather than clamped, so the report cannot misstate its own coverage.

The endpoint SHALL perform no writes of any kind.

#### Scenario: Default window
- **WHEN** the report is requested with no window specified
- **THEN** it scans today through 90 days ahead

#### Scenario: Supported window lengths
- **WHEN** the report is requested with 30, 90, 180, or 365 days
- **THEN** it scans that window beginning today

#### Scenario: Unsupported window rejected
- **WHEN** the report is requested with any other window value
- **THEN** the request is rejected with 400 and no scan runs

#### Scenario: The report never writes
- **WHEN** a scan runs
- **THEN** no event, audit, or other document is created or modified

### Requirement: Only published events are eligible

The scan SHALL consider only events with status `published`. Draft, pending,
rejected, and deleted events SHALL NOT appear on either side of a conflict.

#### Scenario: Non-published events excluded
- **WHEN** an event in draft, pending, rejected, or deleted status overlaps a
  published event in the same room
- **THEN** no conflict is reported

#### Scenario: Two published events conflict
- **WHEN** two published events in the same room have overlapping effective
  windows and the concurrency rules do not permit the overlap
- **THEN** exactly one conflict is reported for that pair

### Requirement: Overlap is measured on effective windows

Overlap SHALL be measured on each event's effective window — its start and end
extended by its reservation or setup and teardown buffers — not on its visible
event times.

Buffer resolution SHALL use the same field precedence the publish-time check
uses, falling back through reservation-bound minutes to setup and teardown
minutes, treating absent values as zero.

#### Scenario: Conflict caused only by a buffer
- **WHEN** two events' visible times do not overlap but one event's teardown
  buffer extends its effective window into the other's
- **THEN** a conflict is reported

#### Scenario: No overlap after buffers
- **WHEN** two events in the same room have effective windows that do not
  overlap
- **THEN** no conflict is reported

#### Scenario: Different rooms never conflict
- **WHEN** two events overlap in time but share no room
- **THEN** no conflict is reported

### Requirement: Each conflict names the contested interval

Every reported conflict SHALL carry the intersection of the two effective
windows as its contested interval, in addition to each side's own times.

#### Scenario: Contested interval is the intersection
- **WHEN** a conflict is reported between two events
- **THEN** it carries a start and end equal to the intersection of their
  effective windows, which may differ from either event's visible times

### Requirement: Recurring series contribute per-occurrence

Series masters SHALL NOT be matched by their stored date range, because a
master's stored range spans the whole series rather than one occurrence.
Masters SHALL be fetched by event type and expanded into occurrences only
within the scan window.

Expansion SHALL omit dates listed in the series exclusions and dates for which
an exception or addition document exists, since such a document replaces the
master's occurrence and is evaluated in its own right.

Each conflicting occurrence SHALL produce its own conflict, identified by its
occurrence date, rather than one conflict for the whole series.

#### Scenario: Only conflicting occurrences reported
- **WHEN** a weekly series has twelve occurrences in the window and three of
  them collide with another event in the same room
- **THEN** exactly three conflicts are reported, each naming its occurrence date

#### Scenario: Excluded dates are not occurrences
- **WHEN** an occurrence date appears in the series exclusions
- **THEN** it is not expanded and produces no conflict

#### Scenario: An overridden occurrence is replaced, not doubled
- **WHEN** an exception document overrides an occurrence and moves it to a
  different time
- **THEN** the master's occurrence for that date is suppressed and the
  exception document is evaluated in its place

#### Scenario: An override moved outside the window still suppresses
- **WHEN** an exception document moves an occurrence outside the scan window
- **THEN** the master's occurrence for that date is still suppressed

### Requirement: Conflicts are grouped by date and room

The response SHALL group conflicts by calendar date and by room, ordered by
date, then room, then start time. Each conflict SHALL carry a stable key
derived from its room, date, and the events involved, so that the same conflict
is identifiable across re-runs.

An event whose effective window spans a day boundary SHALL be considered for
conflicts on every day its window touches.

#### Scenario: Ordering
- **WHEN** a report contains conflicts across several days and rooms
- **THEN** they are ordered by date, then room, then start time

#### Scenario: Stable identity across runs
- **WHEN** the same scan is run twice with no data change
- **THEN** each conflict carries the same key in both responses

#### Scenario: Midnight-spanning event
- **WHEN** an event's effective window crosses midnight and collides with an
  event on the following day in the same room
- **THEN** the conflict is reported

### Requirement: Overlaps permitted by the concurrency rules are excluded

The scan SHALL evaluate every candidate pair with the shared concurrency rule
function and SHALL report only pairs it deems conflicts. Permitted overlaps
SHALL NOT appear in the response and SHALL NOT be counted.

#### Scenario: Category-permitted overlap hidden
- **WHEN** two overlapping events' categories permit concurrency in either
  direction
- **THEN** no conflict is reported

#### Scenario: Flag-permitted overlap hidden
- **WHEN** an overlapping pair is permitted by the per-event concurrency flag
- **THEN** no conflict is reported

### Requirement: Three or more overlapping events report as pairs

When three or more events overlap in the same room, the scan SHALL report each
conflicting pair separately rather than merging them into a single multi-event
conflict, so that each reported contested interval is truthful.

#### Scenario: Pairwise emission
- **WHEN** three events in one room overlap such that A and B contest one
  interval and B and C contest a different interval, with A and C not
  overlapping
- **THEN** two conflicts are reported with their own contested intervals, and
  no conflict is reported between A and C

### Requirement: Results are scoped to a single calendar

The scan SHALL compare events within one calendar owner, and SHALL accept an
optional calendar filter narrowing the scan to a specified mailbox.

Comparing events across different calendar owners is out of scope for this
capability.

#### Scenario: Calendar filter applied
- **WHEN** a calendar filter is supplied
- **THEN** only events belonging to that calendar are scanned

#### Scenario: Unknown calendar
- **WHEN** a calendar filter names a calendar with no events
- **THEN** the response is an empty result rather than an error

### Requirement: An incomplete scan never reports a clean calendar

If part of the scan fails, the response SHALL report the incompleteness
explicitly alongside whatever results were obtained. It SHALL NOT present a
partial or failed scan as a conflict-free result.

If no part of the scan succeeds, the request SHALL fail with an error rather
than return an empty result.

Reads SHALL use the project's existing Cosmos retry utility.

#### Scenario: Partial failure is disclosed
- **WHEN** one of the scan's reads fails and others succeed
- **THEN** the response carries the results obtained and a marker identifying
  which stage was incomplete

#### Scenario: Partial failure with no findings is not an all-clear
- **WHEN** a scan degrades and finds no conflicts in the data it could read
- **THEN** the response is marked incomplete rather than reported as clean

#### Scenario: Total failure errors
- **WHEN** the scan cannot complete any read
- **THEN** the request fails with an error and returns no conflict list

### Requirement: Scan volume is capped and disclosed

The scan SHALL cap the total number of expanded occurrences it will consider
and SHALL mark the response as truncated when that cap is reached, rather than
silently omitting results.

#### Scenario: Cap reached
- **WHEN** the window contains more occurrences than the cap allows
- **THEN** the response is marked truncated

#### Scenario: Cap not reached
- **WHEN** the window is within the cap
- **THEN** the response is not marked truncated

### Requirement: The report is restricted to approvers and administrators

The endpoint SHALL be reachable only by users who can approve reservations or
who are administrators, matching the gate on the existing sync health report.
The server SHALL be authoritative.

#### Scenario: Approver permitted
- **WHEN** a user who can approve reservations requests the report
- **THEN** the request succeeds

#### Scenario: Administrator permitted
- **WHEN** an administrator requests the report
- **THEN** the request succeeds

#### Scenario: Other roles refused
- **WHEN** a user who can neither approve reservations nor administer requests
  the report
- **THEN** the request is refused with 403 and no scan runs
