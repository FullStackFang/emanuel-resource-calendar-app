## ADDED Requirements

### Requirement: Edit a cell in place
The system SHALL allow an editable user to edit a scheduling sheet cell within the grid, without opening a dialog over the sheet.

#### Scenario: Clicking a cell opens the in-cell editor
- **WHEN** an editable user clicks a scheduling sheet cell
- **THEN** the cell SHALL become editable in place
- **AND** the rest of the grid SHALL remain visible and scrollable
- **AND** no dialog SHALL be opened over the sheet

#### Scenario: Existing cell content is available for editing
- **WHEN** an editable user opens a cell that already holds text, person chips, or location chips
- **THEN** the in-cell editor SHALL render the existing segments in their stored order
- **AND** the user SHALL be able to remove any existing segment

#### Scenario: Committed cell renders as before
- **WHEN** a user finishes editing a cell
- **THEN** the cell SHALL render its committed segments in the same form the grid used before this change

### Requirement: Suggest people, locations, and times from within the cell
The system SHALL offer a suggestion list anchored to the cell being edited when the user types a mention trigger.

#### Scenario: Typing @ offers people and locations
- **WHEN** an editable user types `@` followed by search text in the in-cell editor
- **THEN** the system SHALL display a suggestion list anchored to that cell
- **AND** the list SHALL offer matching people and a separate group of matching locations

#### Scenario: Typing # narrows to locations
- **WHEN** an editable user types `#` followed by search text in the in-cell editor
- **THEN** the suggestion list SHALL offer only matching locations

#### Scenario: Suggestion list offers a time when the term is a time
- **WHEN** an editable user types `@` followed by text that reads as a time
- **THEN** the suggestion list SHALL offer that time as a selectable entry in its normalized display form

#### Scenario: Selecting a suggestion adds a chip
- **WHEN** an editable user selects a person, location, or time from the suggestion list
- **THEN** the corresponding segment SHALL be added to the cell being edited
- **AND** the typed trigger text SHALL be cleared from the input

#### Scenario: Suggestion selection is not lost to focus change
- **WHEN** an editable user selects an entry from the suggestion list with a pointer
- **THEN** the selected entry SHALL be added to the cell
- **AND** the raw typed term SHALL NOT be committed in its place

#### Scenario: Suggestion list is not clipped by the grid
- **WHEN** the suggestion list is displayed for a cell near the edge of the scrollable grid area
- **THEN** the full suggestion list SHALL remain visible
- **AND** it SHALL NOT be clipped by the grid scroll area or hidden behind the sticky header row or sticky label column

#### Scenario: Suggestion list follows its cell
- **WHEN** the grid is scrolled or the window is resized while a suggestion list is displayed
- **THEN** the suggestion list SHALL remain positioned with the cell being edited, or SHALL be dismissed

### Requirement: Preserve unmatched and non-user entries
The system SHALL preserve the existing escape hatches for entries that match no known person or location.

#### Scenario: Unmatched mention is kept as a placeholder
- **WHEN** an editable user types a mention term that matches no person and chooses to keep it unassigned
- **THEN** the cell SHALL receive a placeholder person segment carrying that term

#### Scenario: Person who is not a user can be added
- **WHEN** an editable user chooses the not-a-user option for a mention term
- **THEN** the system SHALL allow a name and optional email to be supplied
- **AND** the cell SHALL receive a person segment carrying that name and email

#### Scenario: Unmatched location term can be kept as text
- **WHEN** an editable user types a location term that matches no location and chooses to keep it as free text
- **THEN** the cell SHALL receive a text segment carrying that term

### Requirement: Commit and discard cell edits predictably
The system SHALL commit a cell edit on every ordinary exit path and SHALL discard it only on an explicit cancel.

#### Scenario: Enter commits the cell
- **WHEN** an editable user presses Enter while editing a cell
- **THEN** the cell SHALL be saved with its current content, including any text still in the input

#### Scenario: Moving focus away commits the cell
- **WHEN** an editable user moves focus out of a cell being edited without pressing Escape
- **THEN** the cell SHALL be saved with its current content, including any text still in the input

#### Scenario: Escape discards the edit
- **WHEN** an editable user presses Escape while editing a cell
- **THEN** the cell SHALL be restored to the content it held when editing began
- **AND** no save SHALL be performed for that cell

#### Scenario: Typed text is never silently lost
- **WHEN** an editable user types content into a cell and leaves the cell by any means other than Escape
- **THEN** the typed content SHALL be present in the saved cell

### Requirement: Normalize times entered in a cell
The system SHALL apply the sheet's single time format to any cell entry that reads as a time.

#### Scenario: Loosely typed times normalize
- **WHEN** an editable user commits a cell entry that reads as a time
- **THEN** the saved segment SHALL carry that time in the sheet's normalized display format

#### Scenario: Non-time text is untouched
- **WHEN** an editable user commits a cell entry that does not read as a time
- **THEN** the saved segment SHALL carry the text exactly as typed

### Requirement: Navigate the grid by keyboard
The system SHALL allow an editable user to move between cells and enter edit mode using the keyboard.

#### Scenario: Enter commits and advances downward
- **WHEN** an editable user presses Enter while editing a cell that is not in the last row
- **THEN** the cell SHALL be committed
- **AND** the cell directly below SHALL become the active cell

#### Scenario: Enter at the last row does not wrap
- **WHEN** an editable user presses Enter while editing a cell in the last row
- **THEN** the cell SHALL be committed
- **AND** the active cell SHALL NOT move to another column

#### Scenario: Tab commits and advances rightward
- **WHEN** an editable user presses Tab while editing a cell that is not in the last column
- **THEN** the cell SHALL be committed
- **AND** the cell to the right SHALL become the active cell

#### Scenario: Arrow keys move the focused cell
- **WHEN** a cell is focused and is not being edited, and the user presses an arrow key
- **THEN** focus SHALL move to the adjacent cell in that direction, where one exists

#### Scenario: Arrow keys do not move focus while editing
- **WHEN** a cell is being edited and the user presses an arrow key
- **THEN** focus SHALL remain in the cell being edited

#### Scenario: Escape returns from editing to focused
- **WHEN** an editable user presses Escape while editing a cell
- **THEN** the cell SHALL stop being edited
- **AND** the cell SHALL remain focused for further keyboard navigation

### Requirement: Reach the expanded editor for notes
The system SHALL provide an explicit affordance that opens the full cell editor, which remains the only place a cell note is edited.

#### Scenario: Expand affordance opens the full editor
- **WHEN** an editable user activates the expand affordance on a cell
- **THEN** the full cell editor SHALL open for that cell
- **AND** it SHALL allow the cell note to be added or edited

#### Scenario: In-cell editing does not offer note editing
- **WHEN** an editable user edits a cell in place
- **THEN** the in-cell editor SHALL NOT present a note field

#### Scenario: Existing note survives in-cell editing
- **WHEN** an editable user edits and commits a cell in place that already carries a note
- **THEN** the saved cell SHALL retain its existing note unchanged

#### Scenario: Full editor preserves its established behavior
- **WHEN** a user edits a cell through the full cell editor
- **THEN** it SHALL behave as it did before this change, including its mention picker, location shortcut, per-person call time override, and note handling

### Requirement: Withhold editing from read-only users
The system SHALL present no cell editing surface to users who cannot edit the sheet.

#### Scenario: Read-only cells do not become editable
- **WHEN** a user without edit permission clicks a scheduling sheet cell
- **THEN** no in-cell editor SHALL open
- **AND** no suggestion list SHALL be displayed

#### Scenario: Read-only users get no expand affordance
- **WHEN** a user without edit permission views the scheduling sheet
- **THEN** the expand affordance SHALL NOT be rendered on any cell

#### Scenario: Read-only users cannot commit by keyboard
- **WHEN** a user without edit permission presses Enter or Tab over a scheduling sheet cell
- **THEN** no cell SHALL be saved

### Requirement: Exclude editing chrome from print output
The system SHALL exclude in-cell editing controls from the printed scheduling sheet.

#### Scenario: Printed sheet omits editing controls
- **WHEN** a scheduling sheet is printed
- **THEN** the printed output SHALL NOT include the in-cell editor input, the expand affordance, or the suggestion list
- **AND** committed cell content SHALL print as it did before this change
