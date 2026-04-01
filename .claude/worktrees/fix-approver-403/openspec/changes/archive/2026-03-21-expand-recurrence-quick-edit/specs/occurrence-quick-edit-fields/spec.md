## ADDED Requirements

### Requirement: Description field in occurrence detail editor
The occurrence detail editor SHALL display a textarea for `eventDescription` below the title field. It SHALL show the master event's description by default and allow per-occurrence overrides.

#### Scenario: View inherited description
- **WHEN** user opens an occurrence detail that has no description override
- **THEN** the textarea SHALL display the master event's description with an inherited visual cue

#### Scenario: Override description for one occurrence
- **WHEN** user modifies the description text and navigates back to list
- **THEN** the occurrence's `occurrenceOverrides` entry SHALL contain the new `eventDescription` value
- **AND** the occurrence SHALL show the customized badge in the list

### Requirement: Categories selector in occurrence detail editor
The occurrence detail editor SHALL display the current categories as removable chips with an Add button. Clicking Add SHALL open the existing CategorySelector modal. Categories SHALL follow the same override pattern as other fields.

#### Scenario: View inherited categories
- **WHEN** user opens an occurrence detail that has no categories override
- **THEN** the chips SHALL display the master event's categories

#### Scenario: Remove a category from one occurrence
- **WHEN** user clicks the remove button on a category chip
- **THEN** that category SHALL be removed from the local occurrence edits
- **AND** navigating back to list SHALL persist the change to `occurrenceOverrides`

#### Scenario: Add a category to one occurrence
- **WHEN** user clicks the Add button and selects a category from the CategorySelector modal
- **THEN** the selected category SHALL appear as a new chip
- **AND** navigating back to list SHALL persist the change to `occurrenceOverrides`

### Requirement: Locations selector in occurrence detail editor
The occurrence detail editor SHALL display current locations as removable chips with an Add button. Clicking Add SHALL open a room picker. Both `locations` (ObjectId array) and `locationDisplayNames` (string) SHALL be stored in the override.

#### Scenario: View inherited locations
- **WHEN** user opens an occurrence detail that has no locations override
- **THEN** the chips SHALL display the master event's location names

#### Scenario: Change room for one occurrence
- **WHEN** user removes a location chip and adds a different room via the picker
- **THEN** the override SHALL contain the updated `locations` and `locationDisplayNames`
- **AND** navigating back to list SHALL persist the change to `occurrenceOverrides`

### Requirement: getEffectiveValue supports new fields
`getEffectiveValue()` SHALL support `eventDescription`, `locations`, and `locationDisplayNames` with fallback from local edits to existing override to master values.

#### Scenario: Fallback chain for new fields
- **WHEN** an occurrence has no override for `eventDescription`
- **THEN** `getEffectiveValue` SHALL return the master event's description
- **WHEN** an occurrence has an override for `locations`
- **THEN** `getEffectiveValue` SHALL return the override's locations array

### Requirement: Pre-populate new fields when opening detail
`handleOpenOccurrenceDetail()` SHALL include `eventDescription`, `locations`, and `locationDisplayNames` in the pre-population loop alongside existing fields.

#### Scenario: Open occurrence with existing location override
- **WHEN** user opens an occurrence that already has a locations override
- **THEN** the location chips SHALL display the overridden locations, not the master locations
