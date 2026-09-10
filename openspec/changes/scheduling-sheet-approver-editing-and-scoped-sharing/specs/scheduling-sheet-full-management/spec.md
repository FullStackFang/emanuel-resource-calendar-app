## ADDED Requirements

### Requirement: Approvers receive full Scheduling Sheet management
The system SHALL grant admins, approvers, and Events-department users full workbook, day, structure, cell, lookup, export, and email management through the existing assignment capability, without granting unrelated permissions.

#### Scenario: Approver outside Events manages a workbook
- **WHEN** an authenticated non-Events approver opens Scheduling Sheets and creates, copies, edits, deletes, or sends sheet content
- **THEN** frontend navigation and backend endpoints SHALL authorize the operation subject to existing validation and confirmation rules

#### Scenario: Existing department grant and exclusions persist
- **WHEN** an Events-department requester or viewer accesses Scheduling Sheets
- **THEN** management SHALL remain available
- **AND** non-Events requesters and viewers SHALL remain denied by direct backend requests as well as route navigation

#### Scenario: Role simulation matches the capability
- **WHEN** an admin simulates an approver without the Events department grant
- **THEN** the effective frontend capability SHALL expose Scheduling Sheet management

### Requirement: Row creation is explicit and preserves failed input
The grid SHALL offer a labeled Add Row action and Enter shortcut, prevent duplicate submission while saving, and clear entered text only after successful persistence.

#### Scenario: Successful row addition
- **WHEN** a manager submits a nonblank label with the button or Enter
- **THEN** exactly one custom row SHALL persist and remain after reload
- **AND** the input SHALL clear after success with success feedback

#### Scenario: Save fails or conflicts
- **WHEN** the row mutation returns validation, network, or version-conflict failure
- **THEN** the label SHALL remain available and the error SHALL be visible
- **AND** stale structure SHALL NOT be silently resubmitted over newer data

### Requirement: All rows can move without changing identity
The grid SHALL support drag and keyboard move actions for starter and custom rows across the entire row order, preserving ids, metadata roles, and cell contents.

#### Scenario: Starter row moves below a custom row
- **WHEN** a manager moves Location below an assignment row and reloads
- **THEN** the stored order SHALL remain changed
- **AND** location extraction, notes, and all cell contents SHALL retain their original row identity

#### Scenario: Boundary and read-only controls
- **WHEN** a move would be a no-op or a surface is read-only
- **THEN** the boundary action SHALL be disabled or omitted, or editing controls hidden, respectively

### Requirement: Metadata meaning survives label changes
The system SHALL identify metadata using stable optional row roles for location, call time, doors open, begins, and ends; SHALL allow explicit role reassignment; and SHALL reject duplicate non-null or unknown roles.

#### Scenario: Renamed metadata retains its behavior
- **WHEN** Call Time is renamed Arrival and moved
- **THEN** assignments, prefill, emails, and ICS SHALL continue using that row's call-time role
- **AND** copied days SHALL preserve the role

#### Scenario: Legacy sheet is normalized
- **WHEN** a legacy day without role properties is read and subsequently structurally saved
- **THEN** exact trimmed case-insensitive legacy labels SHALL resolve using the documented last-match compatibility rule unless an explicit role owner exists
- **AND** resolved roles SHALL be persisted without changing ids or cell contents
- **AND** already-renamed unrecognized legacy rows SHALL remain ordinary until explicitly assigned a role

#### Scenario: Role is recovered after deletion
- **WHEN** a manager deletes the Begins row and assigns the begins role to another row
- **THEN** downstream extraction SHALL use the replacement row
- **AND** attempting to give another row the same role SHALL fail validation

#### Scenario: Older client omits new properties
- **WHEN** an older client structurally saves rows with existing ids but no metadataRole properties
- **THEN** persisted explicit roles SHALL be preserved server-side

### Requirement: Structural deletion removes assignments atomically
Deleting rows or columns SHALL remove their cells and recompute tagged recipients within the version-checked write. All readers SHALL ignore historical orphaned cells, and late cell writes SHALL NOT recreate deleted structure's content.

#### Scenario: Deleted assignment disappears everywhere
- **WHEN** a manager confirms deletion of a row or column containing person tags
- **THEN** those assignments SHALL disappear from the grid, My Assignments, recipient counts, emails, and ICS
- **AND** remaining valid assignments SHALL be unchanged

#### Scenario: Concurrent edit is protected
- **WHEN** a cell write changes the day version before a structural deletion commits
- **THEN** the stale deletion SHALL return a version conflict without removing the concurrent edit
- **AND** a cell write arriving after deletion SHALL fail if its row or column no longer exists

#### Scenario: Old orphaned cell is present
- **WHEN** a day contains stored cells whose row or column no longer exists
- **THEN** recipient and assignment readers SHALL omit them even before cleanup is saved
