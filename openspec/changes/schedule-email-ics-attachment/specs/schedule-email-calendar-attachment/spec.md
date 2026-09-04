# schedule-email-calendar-attachment

## ADDED Requirements

### Requirement: One calendar file per recipient covering their whole scope
`POST /api/scheduling-sheets/:sheetId/email` SHALL attach, to each recipient's message, a single RFC 5545 `text/calendar` file containing one `VEVENT` per assignment that recipient has in the send scope. A day-scoped send SHALL cover that day; a whole-workbook send SHALL cover every day in the workbook in one file. Because the contents differ per person, the file MUST be built inside the per-recipient fan-out, not once for all recipients like the workbook PDF.

#### Scenario: Multiple assignments in one file
- **WHEN** a person is tagged in 3 cells across 2 columns of one day and a day-scoped send runs
- **THEN** their message carries exactly one `.ics` attachment containing 3 `VEVENT` components

#### Scenario: Workbook scope spans days
- **WHEN** a person is tagged on Sep 11 and Sep 20 and a whole-sheet send runs
- **THEN** their single `.ics` attachment contains events for both dates

#### Scenario: Files differ per recipient
- **WHEN** two people with different assignments are emailed in the same send
- **THEN** each receives a calendar file containing only their own assignments

#### Scenario: Placeholders contribute nothing
- **WHEN** the scope contains placeholder person chips
- **THEN** no calendar events are generated for them, they remain reported in `skippedPlaceholders`, and resolved recipients are unaffected

### Requirement: PUBLISH method, never a meeting invitation
The generated calendar object SHALL declare `METHOD:PUBLISH` and SHALL NOT use `METHOD:REQUEST`. Events SHALL NOT carry `ATTENDEE` properties. The attachment content type SHALL be `text/calendar; charset=utf-8; method=PUBLISH`.

#### Scenario: No RSVP semantics
- **WHEN** a schedule email with a calendar attachment is generated
- **THEN** the file contains `METHOD:PUBLISH` and no `ATTENDEE` property, so the sending mailbox never becomes the organizer of a tracked meeting

### Requirement: An entry spans effective call time to end
`DTSTART` SHALL resolve in order: the entry's effective call time (the person's `callTimeOverride`, else the column's Call Time row), then the Begins cell, then the linked column's `snapshot.startDateTime`. `DTEND` SHALL resolve in order: the Ends cell, then `snapshot.endDateTime`, then two hours after `DTSTART`. A resolved end earlier than the resolved start SHALL be treated as crossing midnight and rolled to the following day.

#### Scenario: Call time wins over event start
- **WHEN** a person has a `callTimeOverride` of 16:30 in a column whose Begins cell reads '6:00 PM' and Ends reads '8:00 PM'
- **THEN** their event runs 4:30 PM to 8:00 PM

#### Scenario: Column call time when there is no personal override
- **WHEN** a person has no `callTimeOverride` and the column's Call Time row reads '4:00 PM'
- **THEN** their event starts at 4:00 PM

#### Scenario: Falls back to Begins
- **WHEN** neither a personal override nor a Call Time cell resolves, and Begins reads '7:00 PM'
- **THEN** the event starts at 7:00 PM

#### Scenario: Falls back to the linked event snapshot
- **WHEN** no call time or Begins cell resolves but the column is linked to a published event with a snapshot start
- **THEN** the event starts at the snapshot start time

#### Scenario: Default duration when the end is unresolvable
- **WHEN** a start resolves to 4:30 PM and the Ends cell reads 'TBD' with no linked snapshot
- **THEN** the event ends at 6:30 PM

#### Scenario: Crossing midnight
- **WHEN** a start resolves to 10:00 PM and an end resolves to 1:00 AM
- **THEN** the end is placed on the following calendar day and the event has a positive three-hour duration

### Requirement: Conservative time parsing with a documented ambiguity rule
The parser SHALL accept 24-hour `HH:MM`, and `H` or `H:MM` with an optional meridiem in either case with or without periods and surrounding whitespace. A time with no meridiem SHALL resolve hour 12 and hours 1 through 6 as PM, and hours 7 through 11 as AM. Any value that does not match SHALL be treated as unresolvable.

#### Scenario: Explicit meridiem
- **WHEN** a cell reads '6:00 PM'
- **THEN** it resolves to 18:00 local time

#### Scenario: Twenty-four hour input
- **WHEN** a cell reads '17:30'
- **THEN** it resolves to 17:30 local time

#### Scenario: Bare evening time
- **WHEN** a cell reads '5:30' with no meridiem
- **THEN** it resolves to 17:30 local time

#### Scenario: Bare morning time
- **WHEN** a cell reads '9:00' with no meridiem
- **THEN** it resolves to 09:00 local time

#### Scenario: Bare noon
- **WHEN** a cell reads '12:00' with no meridiem
- **THEN** it resolves to 12:00 local time

#### Scenario: Prose is not a time
- **WHEN** a cell reads 'after Mincha' or 'TBD' or is empty
- **THEN** it does not resolve and the all-day fallback applies

### Requirement: Unresolvable times produce an all-day event, never an omission
When no start time can be resolved for an assignment, the generator SHALL emit an all-day `VEVENT` on that assignment's date using `DTSTART;VALUE=DATE` with an exclusive `DTEND;VALUE=DATE` on the following day. The assignment SHALL NOT be dropped from the file.

#### Scenario: All-day fallback
- **WHEN** an assignment on 2026-09-21 has no resolvable call time, Begins cell, or linked snapshot
- **THEN** the file contains an all-day event with `DTSTART;VALUE=DATE:20260921` and `DTEND;VALUE=DATE:20260922`

#### Scenario: Nothing is silently missing
- **WHEN** a recipient has 4 assignments in scope and 2 have unparseable times
- **THEN** the file contains 4 events, 2 of them all-day

### Requirement: Stable identity so re-sends update rather than duplicate
Each `VEVENT` SHALL carry a `UID` derived deterministically from the day id, row id, column id and the recipient's sanitized email address, and a `SEQUENCE` taken from the day document's `_version`. The same assignment SHALL produce the same `UID` across separate sends, including after columns or custom rows are reordered.

#### Scenario: UID is stable across sends
- **WHEN** the same day is emailed twice with no edits in between
- **THEN** both files carry identical `UID` values for the same assignments

#### Scenario: Reordering does not re-identify
- **WHEN** columns or custom rows are reordered by drag and the day is emailed again
- **THEN** the `UID` for each unchanged assignment is unchanged, because reordering moves array positions and never ids

#### Scenario: Sequence advances after an edit
- **WHEN** a cell on the day is edited, incrementing the day `_version`, and the day is emailed again
- **THEN** the new file's events carry a strictly higher `SEQUENCE` than the previous send

#### Scenario: Distinct people in one cell get distinct events
- **WHEN** two people are tagged in the same cell
- **THEN** each recipient's file carries a `UID` distinct from the other's

### Requirement: Local wall-clock times are emitted as DST-correct UTC instants
Sheet dates and cell times SHALL be interpreted as `America/New_York` wall-clock and emitted as UTC instants with a `Z` suffix, using the zone offset in effect on that specific date. The file SHALL NOT rely on a `TZID` parameter without an accompanying `VTIMEZONE` component.

#### Scenario: Daylight time
- **WHEN** an assignment resolves to 4:30 PM on 2026-09-11, when Eastern Daylight Time is in effect
- **THEN** the file emits `20260911T203000Z`

#### Scenario: Standard time
- **WHEN** an assignment resolves to 4:30 PM on a date when Eastern Standard Time is in effect
- **THEN** the file emits `T213000Z`, reflecting the different offset for that date

### Requirement: RFC 5545 format conformance
The generated file SHALL use CRLF line endings throughout, fold lines longer than 75 octets measured in UTF-8 bytes, and escape backslash, semicolon, comma and newline characters in `SUMMARY`, `DESCRIPTION` and `LOCATION` values. Every `VEVENT` SHALL carry a `DTSTAMP`, and the calendar SHALL carry `VERSION:2.0`, `CALSCALE:GREGORIAN` and a `PRODID`.

#### Scenario: Multi-byte names fold correctly
- **WHEN** a summary contains accented characters and exceeds 75 octets
- **THEN** folding occurs on the octet boundary, not the character count, and the file remains valid

#### Scenario: Punctuation is escaped
- **WHEN** a cell note contains a comma, a semicolon and a line break
- **THEN** the emitted `DESCRIPTION` escapes each of them rather than terminating the property

#### Scenario: Location carries free text unchanged
- **WHEN** an offsite venue is typed as plain text in the Location row rather than selected as a chip
- **THEN** that text appears in `LOCATION` intact

### Requirement: Event content names the assignment and carries the raw cell text
Each `VEVENT` SHALL carry a `SUMMARY` naming the assignment role and its column, and a `DESCRIPTION` containing the literal Call Time, Begins and Ends cell text as written on the sheet, plus any cell note. This keeps a misresolved time visible to the recipient rather than silent.

#### Scenario: Raw text is preserved
- **WHEN** a Begins cell reads '5:30' and is resolved to 5:30 PM
- **THEN** the description shows the sheet's literal '5:30' alongside the resolved event time

#### Scenario: Cell note is carried
- **WHEN** an assignment cell has a note
- **THEN** the note text appears in the event description

### Requirement: Attachment failure never withholds the schedule
A calendar file that cannot be generated, or that exceeds the attachment size budget shared with the workbook PDF, SHALL be omitted and reported in a `calendarWarning` field on the response. The email SHALL still be sent, and the recipient SHALL still be counted as a successful send with an `emailLog` entry.

#### Scenario: Generation throws
- **WHEN** calendar generation fails for a recipient
- **THEN** that recipient still receives their schedule email without the attachment, the response carries `calendarWarning`, and the send is reported as successful

#### Scenario: Size budget exceeded
- **WHEN** the combined attachment payload would exceed the Graph message budget
- **THEN** the calendar file is dropped with a warning rather than causing a failed send

#### Scenario: Response reports attachment state
- **WHEN** a send completes with calendar attachments included
- **THEN** the response carries `calendarAttached: true` alongside the existing `attached` field for the PDF

### Requirement: Sender-controlled toggle, default on
The send panel SHALL offer a control to include or omit the calendar attachment, defaulting to included. The request body SHALL carry `includeCalendar`, and the endpoint SHALL omit the attachment when it is not `true`.

#### Scenario: Default send includes the calendar
- **WHEN** a manager opens the send panel and sends without changing the control
- **THEN** the request carries `includeCalendar: true` and recipients receive the attachment

#### Scenario: Sender opts out
- **WHEN** a manager clears the control and sends
- **THEN** no calendar attachment is generated or sent, and the response reports `calendarAttached: false`

#### Scenario: Absent field is treated as opt-out
- **WHEN** a request omits `includeCalendar` entirely
- **THEN** the endpoint sends no calendar attachment, reproducing the behavior that existed before this change

### Requirement: The shared assignment extractor gains fields without disturbing My Assignments
`extractDayAssignments` SHALL additionally return the day `_version` as `sequence` and the column's linked event snapshot as `linkedSnapshot`. These additions SHALL be purely additive; `GET /api/my-assignments` SHALL continue to return an unchanged response shape.

#### Scenario: My Assignments is unaffected
- **WHEN** the assignments view is fetched after the extractor gains the new fields
- **THEN** its response shape and contents are identical to before the change
