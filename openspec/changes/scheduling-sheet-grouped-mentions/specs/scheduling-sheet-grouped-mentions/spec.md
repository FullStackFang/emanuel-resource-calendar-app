## ADDED Requirements

### Requirement: A picked person opens a group that collects details
The system SHALL treat a person picked in a scheduling sheet cell editor as an open group, and SHALL attach each subsequent `@` token entered in that editor to that person as a detail until the group closes.

#### Scenario: Details attach to the person on one line
- **WHEN** an editor user picks Stephen, then enters `@615pm`, `@Greenwald` and `@Task` as further tokens
- **THEN** the cell SHALL hold one person segment for Stephen whose details are "6:15 PM", "Greenwald" and "Task" in that order
- **AND** the cell SHALL NOT hold those three values as separate top-level segments

#### Scenario: A second picked person starts a new group
- **WHEN** an editor user picks Stephen, adds `@6pm`, then picks Dana and adds `@7pm`
- **THEN** Stephen's details SHALL be "6:00 PM" only
- **AND** Dana's details SHALL be "7:00 PM" only

#### Scenario: Plain text without @ stays a top-level segment
- **WHEN** a group is open and the user types `after kiddush` without a leading `@` and commits
- **THEN** "after kiddush" SHALL be stored as a top-level text segment, not a detail

#### Scenario: A line with no person behaves as before
- **WHEN** the user enters tokens without ever picking a person
- **THEN** the cell SHALL be built exactly as it was before this change

#### Scenario: The open group renders live
- **WHEN** a detail is added to an open group
- **THEN** the detail SHALL appear inside that person's chip in the editor immediately

#### Scenario: Backspace removes details before the person
- **WHEN** the input is empty and the user presses Backspace with an open group that has details
- **THEN** the last detail SHALL be removed and the person SHALL remain
- **AND** a further Backspace after the last detail is gone SHALL remove the person as before

#### Scenario: A single detail can be removed
- **WHEN** the user activates the remove control on one detail of a person chip
- **THEN** only that detail SHALL be removed

### Requirement: A space followed by @ finalizes the current token
The system SHALL apply the current token's default choice when the user types a space followed by `@`, and SHALL continue with a new token, so a full line can be typed without stopping.

#### Scenario: Typing the whole line
- **WHEN** the user types `@Stephen` (with Stephen highlighted), then ` @615pm @Greenwald @Task`, then presses Enter
- **THEN** the cell SHALL hold Stephen with details "6:15 PM", "Greenwald" and "Task"

#### Scenario: Multi-word tokens stay whole
- **WHEN** a group is open and the user enters `@after kiddush`
- **THEN** the detail SHALL be "after kiddush"

#### Scenario: An @ inside a word does not split
- **WHEN** a group is open and the user enters `@a@b.com`
- **THEN** the detail SHALL be "a@b.com"

#### Scenario: Pasting a multi-token line
- **WHEN** the user pastes ` @615pm @Usher` while a group is open
- **THEN** both tokens SHALL be finalized as details in order

### Requirement: Detail tokens default to text and never guess
While a group is open, the suggestion list SHALL default to adding the typed term as text, SHALL NOT offer placeholder or outside-person rows, and SHALL resolve a token to a person or location only when the user explicitly picks that row.

#### Scenario: Unmatched term becomes a text detail
- **WHEN** a group is open and the user types `@Task` and presses Enter
- **THEN** "Task" SHALL be added as a text detail
- **AND** no placeholder person SHALL be created

#### Scenario: Partial name is not resolved to a person
- **WHEN** a group is open, a user named Alan exists, and the user types `@Al` and presses Enter
- **THEN** "Al" SHALL be added as a text detail
- **AND** Alan SHALL NOT be added

#### Scenario: A room is added only when picked
- **WHEN** a group is open and the user types `@Greenwald` and presses Enter without moving the highlight
- **THEN** "Greenwald" SHALL be added as a text detail
- **AND** **WHEN** the user instead moves the highlight to the Greenwald location row and picks it
- **THEN** a location detail for Greenwald SHALL be added

#### Scenario: Times are normalized
- **WHEN** a group is open and the user enters `@615pm`
- **THEN** the detail SHALL be the text "6:15 PM"

#### Scenario: Lookup tokens are unchanged
- **WHEN** no group is open and the user types `@`
- **THEN** the suggestion list SHALL behave exactly as before this change, including placeholder and outside-person rows

### Requirement: Detail suggestions come from the same sheet
While a group is open, the suggestion list SHALL offer text details already used anywhere on the same scheduling sheet that match the typed term, above the add-as-text row.

#### Scenario: Previously used detail is suggested
- **WHEN** another cell on any day of the same sheet has a person with the detail "Usher", and a group is open and the user types `@us`
- **THEN** "Usher" SHALL be offered as a suggestion above "Add 'us' as text"

#### Scenario: Case variants are merged
- **WHEN** the sheet holds details "Usher" (three times) and "usher" (once)
- **THEN** a single suggestion "Usher" SHALL be offered

#### Scenario: Other sheets and locations are not suggested
- **WHEN** a detail exists only on a different sheet, or only as a location detail
- **THEN** it SHALL NOT be offered as a detail text suggestion

#### Scenario: Suggestions are capped honestly
- **WHEN** more than five stored details match the term
- **THEN** at most five SHALL be listed with a count of the remainder

### Requirement: The server stores and validates person details
The system SHALL accept an optional `details` array on person segments, containing only text and location entries normalized like top-level segments, and SHALL reject invalid details.

#### Scenario: Details survive a save
- **WHEN** a cell write includes a person segment with text and location details
- **THEN** the stored cell SHALL contain those details, normalized, in order

#### Scenario: Nested people are rejected
- **WHEN** a cell write includes a person segment whose details contain a person
- **THEN** the write SHALL be rejected with a 400

#### Scenario: Too many details are rejected
- **WHEN** a person segment has more than 10 details, or the cell's segments plus details exceed the cell segment cap
- **THEN** the write SHALL be rejected with a 400

#### Scenario: Cells without details are unchanged
- **WHEN** a person segment has no `details`, or an empty `details` array
- **THEN** the stored segment SHALL have no `details` field

#### Scenario: Details never change derived data
- **WHEN** a person segment carries details that include a time and a location
- **THEN** the person's call time, `taggedEmails`, the double-booking warning and the calendar event start and end SHALL be identical to the same cell without details

### Requirement: Details render wherever the sheet is shown
The system SHALL render a person's details as part of that person's chip in the grid, in both cell editors, in print, and in the workbook PDF.

#### Scenario: Grid chip shows the group
- **WHEN** a cell holds Stephen with details "6:15 PM" and "Greenwald"
- **THEN** the grid SHALL render one chip reading Stephen followed by those details

#### Scenario: PDF keeps the group together
- **WHEN** the workbook PDF is generated for that cell
- **THEN** the person block SHALL include the details after the name

### Requirement: The person sees their own details
The system SHALL include a person's details in that person's schedule email, their My Assignments entry, and the description of their calendar attachment, without changing any computed time.

#### Scenario: Email itinerary lists details
- **WHEN** a schedule email is sent to Stephen for a post where his chip has details
- **THEN** that post in his email SHALL list the details

#### Scenario: My Assignments lists details
- **WHEN** Stephen opens My Assignments
- **THEN** the entry for that post SHALL show his details
- **AND** the `GET /api/my-assignments` entry SHALL include a `details` array

#### Scenario: Calendar description includes details
- **WHEN** Stephen's calendar attachment is built
- **THEN** that event's DESCRIPTION SHALL include his details
- **AND** its start and end SHALL be the same as without details

#### Scenario: Another person's details are not shown to Stephen
- **WHEN** Dana's chip in the same cell has details
- **THEN** Stephen's email, My Assignments entry and calendar attachment SHALL NOT include Dana's details
