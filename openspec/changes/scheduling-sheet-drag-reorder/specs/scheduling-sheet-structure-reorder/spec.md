## ADDED Requirements

### Requirement: Reorder columns by header drag
The system SHALL allow editable users to reorder scheduling sheet columns by dragging an explicit handle in each column header.

#### Scenario: Column moves to a new position
- **WHEN** an editable user drags the handle for one column and drops it on another column position
- **THEN** the sheet SHALL render the columns in the new order
- **AND** the moved column SHALL keep its id, name, linked-event metadata, and existing cell contents

#### Scenario: Column drag does not invoke other header actions
- **WHEN** an editable user starts a drag from the column reorder handle
- **THEN** the sheet SHALL NOT trigger column rename, delete confirmation, link refresh, or cell editing

### Requirement: Reorder custom rows by row-label drag
The system SHALL allow editable users to reorder user-created custom rows by dragging an explicit handle in each custom row label.

#### Scenario: Custom row moves within custom row group
- **WHEN** an editable user drags a custom row handle and drops it on another custom row position
- **THEN** the sheet SHALL render the custom rows in the new order below the starter rows
- **AND** the moved row SHALL keep its id, label, and existing cell contents across all columns

#### Scenario: Starter rows remain fixed
- **WHEN** an editable user reorders custom rows
- **THEN** starter rows such as Location, Call Time, Doors Open, Begins, and Ends SHALL remain in their seeded order above all custom rows

### Requirement: Persist reordered structure without rewriting cells
The system SHALL persist column and custom row reorder operations by saving reordered row or column arrays without changing row ids, column ids, or cell keys.

#### Scenario: Reordered sheet reloads with same data
- **WHEN** a user reorders columns or custom rows and later reloads the scheduling sheet
- **THEN** the sheet SHALL display the saved order
- **AND** every cell, note, person chip, location chip, text segment, and linked-event chip SHALL remain attached to the same row id and column id as before the reorder

### Requirement: Provide non-drag reorder controls
The system SHALL provide non-drag move controls for each reorderable column and custom row so keyboard and assistive technology users can perform equivalent reorder operations.

#### Scenario: Column is moved with controls
- **WHEN** an editable user activates a column move command such as move left, move right, move to start, or move to end
- **THEN** the sheet SHALL update the column order consistently with the selected command

#### Scenario: Custom row is moved with controls
- **WHEN** an editable user activates a custom row move command such as move up, move down, move to top, or move to bottom
- **THEN** the sheet SHALL update the custom row order consistently with the selected command
- **AND** starter rows SHALL remain fixed

#### Scenario: Boundary move controls are unavailable
- **WHEN** a column or custom row is already at the relevant boundary for a move command
- **THEN** the no-op move command SHALL be disabled or omitted

### Requirement: Hide reorder actions from read-only users
The system SHALL only expose drag handles and reorder controls to users who can edit the scheduling sheet.

#### Scenario: Read-only user views sheet
- **WHEN** a user without edit permission views a scheduling sheet
- **THEN** the sheet SHALL NOT show column reorder handles, custom row reorder handles, or reorder move controls
