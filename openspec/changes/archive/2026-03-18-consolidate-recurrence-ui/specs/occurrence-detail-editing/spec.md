## ADDED Requirements

### Requirement: Clicking an occurrence opens a detail editor in the right column
When user clicks an occurrence row in the list, the right column SHALL swap from the occurrence list to a detail/edit view for that specific date.

#### Scenario: Open occurrence detail
- **WHEN** user clicks an occurrence row (pattern, added, or excluded type)
- **THEN** the right column displays editable fields for that occurrence date with current effective values (inherited from master or from existing override)

#### Scenario: Back to list
- **WHEN** user clicks "Back to list" in the detail view
- **THEN** the right column returns to the full occurrence list

### Requirement: Occurrence detail shows current effective field values
The detail view SHALL display the occurrence's effective values for: eventTitle, startTime, endTime, locations (room picker), setupTime, teardownTime, doorOpenTime, doorCloseTime, and categories. Values come from the existing occurrenceOverride for that date if present, otherwise from the series master fields.

#### Scenario: Occurrence with no override
- **WHEN** user opens detail for an occurrence that has no entry in occurrenceOverrides[]
- **THEN** all fields display the series master's values

#### Scenario: Occurrence with existing override
- **WHEN** user opens detail for an occurrence that has an entry in occurrenceOverrides[] with overridden startTime and eventTitle
- **THEN** startTime and eventTitle fields display the override values, all other fields display the master values

### Requirement: Editing occurrence fields updates occurrenceOverrides in memory
When user modifies a field in the occurrence detail view, the change SHALL be stored in the local occurrenceOverrides[] state. Changes are persisted when the parent form saves.

#### Scenario: Edit a field on an occurrence without existing override
- **WHEN** user changes the startTime for an occurrence that has no override
- **THEN** a new entry is added to occurrenceOverrides[] with the occurrenceDate and the changed startTime

#### Scenario: Edit a field on an occurrence with existing override
- **WHEN** user changes the eventTitle for an occurrence that already has an override entry
- **THEN** the existing override entry is updated with the new eventTitle, preserving other overridden fields

#### Scenario: Changes persist with form save
- **WHEN** user edits occurrence fields and then saves the form via the ReviewModal save action
- **THEN** the updated occurrenceOverrides[] are included in the save payload sent to the backend

### Requirement: Customized occurrences show indicator in list
Occurrence rows that have entries in occurrenceOverrides[] SHALL display a small visual indicator distinguishing them from non-customized occurrences.

#### Scenario: Occurrence with override shows indicator
- **WHEN** the occurrence list renders and an occurrence has an entry in occurrenceOverrides[]
- **THEN** that row displays a visual customized indicator

#### Scenario: Occurrence without override shows no indicator
- **WHEN** the occurrence list renders and an occurrence has no entry in occurrenceOverrides[]
- **THEN** that row does not display the customized indicator

### Requirement: Excluded occurrences are not editable in detail view
Excluded occurrences (dates in recurrence.exclusions[]) SHALL NOT offer field editing in the detail view since they are skipped dates.

#### Scenario: Click excluded occurrence
- **WHEN** user clicks an excluded occurrence row
- **THEN** the detail view shows the date as excluded with a "Restore" action but no editable fields
