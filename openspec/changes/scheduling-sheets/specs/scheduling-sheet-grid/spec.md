# scheduling-sheet-grid

## ADDED Requirements

### Requirement: Freeform grid structure
A day sheet SHALL render columns (events/posts) across and rows down, with a frozen row-label column. Managers SHALL be able to add, rename, reorder, and delete rows and columns anywhere, including the seeded starter rows. Starter rows differ from custom rows only cosmetically (band tint); deleting or renaming them SHALL be permitted.

#### Scenario: Starter row is deletable
- **WHEN** a manager deletes the 'Doors Open' starter row
- **THEN** the row and its cells are removed and the sheet saves successfully

#### Scenario: Off-script row
- **WHEN** a manager adds a row 'Security walkie channel' and types 'Ch. 4' into a cell
- **THEN** the free text is stored and rendered verbatim

### Requirement: Cells hold ordered segments of text and chips
A cell SHALL store an ordered list of segments of type `text`, `person`, or `location`, plus an optional note. The server SHALL validate segment shape on write (reject unknown types, cap segment count and note length) and recompute the day's `taggedEmails` from person segments on every cell write. Person emails SHALL be stored lowercased.

#### Scenario: Mixed cell content
- **WHEN** a manager saves a cell with segments [text 'Lead:', person Sarah Levine, location 'Wise Hall']
- **THEN** the cell round-trips with segments in that order

#### Scenario: taggedEmails recomputed server-side
- **WHEN** a cell write removes the only chip for 'sarah@emanuelnyc.org' and the client supplies a stale `taggedEmails` in the payload
- **THEN** the stored `taggedEmails` no longer contains that address (client value ignored)

#### Scenario: Invalid segment rejected
- **WHEN** a cell write contains a segment of type 'formula'
- **THEN** the response is 400 and the cell is unchanged

### Requirement: Cell writes are targeted and do not version-gate
A cell write SHALL update only that cell's path (plus recomputed `taggedEmails`, audit fields, and `$inc _version`) and SHALL NOT be rejected for a stale `_version`. Concurrent writes to different cells SHALL both persist.

#### Scenario: Different cells never conflict
- **WHEN** two managers concurrently write different cells of the same day
- **THEN** both writes persist and `_version` reflects both increments

### Requirement: Person tagging with three assignee kinds
Typing `@` in a cell SHALL open a unified mention picker: people first, backed by `GET /api/scheduling-sheets/user-lookup` (gated by `requireAssignmentManager`, NOT by `canManageUsers`), showing at most 5 matches with an honest overflow count and a "not a user? add name and email" escape hatch, followed by a Locations group over `templeEvents__Locations`. Person segments SHALL be one of: linked user (`userId` set), external (`userId` null, email present), or placeholder (`placeholder: true`, no email). A person segment MAY carry a `callTimeOverride` (HH:MM).

#### Scenario: Lookup succeeds for events-dept requester
- **WHEN** an events-department requester types '@sar' in a cell
- **THEN** the lookup endpoint returns matches (no 403)

#### Scenario: Placeholder chip
- **WHEN** a manager confirms an unmatched '@usher_team_lead'
- **THEN** the segment is stored with `placeholder: true` and no email

### Requirement: Location tagging
Locations SHALL be taggable from the unified `@` mention picker (Locations group) and from `#`, which narrows to locations only; selection stores a location segment with `locationId`; a non-match falls back to free text.

#### Scenario: Location chip from list
- **WHEN** a manager picks 'Wise Hall' from the '#' picker (or the '@' picker's Locations group)
- **THEN** the segment stores the location's ObjectId and display name

### Requirement: Event-linked columns carry a snapshot and a drift flag
Typing `@` in a column-name input (add-column or rename) SHALL open an event mention picker of published events on the day's date ±1 day, each option showing the event's date and time range. Picking one SHALL store `{ eventId, linkedAt, snapshot }` on the column and perform a one-time prefill of the column name and the starter-row cells (Location as location chips, Call Time from setup time, Doors Open, Begins, Ends), filling ONLY cells that are currently empty. There SHALL be no separate link dropdown. The client SHALL compare live event data to the snapshot on load and show a "changed since linked" flag on mismatch with an explicit refresh action; the system SHALL NOT auto-update linked cells. A deleted event SHALL degrade the chip without breaking the column.

#### Scenario: @ links and prefills in one gesture
- **WHEN** a manager types '@din' in the add-column input and picks 'Community Dinner'
- **THEN** the column is created linked to that event and the empty starter-row cells are prefilled from it

#### Scenario: Linking never clobbers entered values
- **WHEN** a manager links an existing column whose Begins/Ends cells already hold values
- **THEN** only the still-empty starter cells are prefilled

#### Scenario: Drift is flagged, not applied
- **WHEN** a linked event's start time changes after linking
- **THEN** the column shows a drift flag and its cells retain their entered values

#### Scenario: Linked event deleted
- **WHEN** a linked event no longer exists
- **THEN** the column renders with an 'event no longer exists' indication and remains editable

### Requirement: Soft double-booking warning
The client SHALL show a non-blocking warning when the same person (by email or userId) appears in two columns of one day whose time ranges overlap. The warning SHALL never prevent saving.

#### Scenario: Overlap warns
- **WHEN** the same person is tagged in two columns with overlapping Begins–Ends ranges
- **THEN** a warning badge is shown and saves still succeed

### Requirement: Print view
Printing SHALL output only the active day sheet — title, date, and the grid — via a plain `@media print` stylesheet (no `@react-pdf/renderer`), with rows grown to show all chips (no truncation).

#### Scenario: Print strips chrome
- **WHEN** a manager prints the active day
- **THEN** tabs, toolbars, pickers, and annotations are excluded and every tagged person is visible
