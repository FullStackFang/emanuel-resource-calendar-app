## ADDED Requirements

### Requirement: All-day Graph event for pushed markers
When a marker has `pushToOutlook` true, the system SHALL create an all-day Microsoft Graph event on the main TempleEvents calendar with `isAllDay` true, `start` at midnight of `startDate`, and `end` at midnight of the day after `endDate` (exclusive end), using the marker `name` as subject and `note` as body.

#### Scenario: Single-day all-day event
- **WHEN** a one-day marker is pushed to Outlook
- **THEN** the Graph event has `isAllDay` true with `end` set to the day after `startDate`

#### Scenario: Multi-day all-day event
- **WHEN** a marker covering several days is pushed
- **THEN** the Graph event covers the inclusive range with an exclusive end one day past `endDate`

### Requirement: showAs derived from marker type
Pushed Office Closed markers SHALL set Graph `showAs` to `oof`; pushed Holiday markers SHALL set Graph `showAs` to `free`.

#### Scenario: Office Closed shows as out-of-office
- **WHEN** an `officeClosed` marker is pushed
- **THEN** the Graph event has `showAs` equal to `oof`

#### Scenario: Holiday shows as free
- **WHEN** a `holiday` marker is pushed
- **THEN** the Graph event has `showAs` equal to `free`

### Requirement: Graph linkage stored on the marker
After creating the Graph event, the system SHALL store the Graph event id and target calendar identity (`graphData`) on the marker so later edits and deletes can address it.

#### Scenario: Linkage persisted
- **WHEN** a marker is first pushed to Outlook
- **THEN** the marker is updated with the returned Graph event id and calendar identity

### Requirement: Sync on marker update
Editing a pushed marker SHALL patch the linked Graph event to match. Turning `pushToOutlook` from false to true on a marker that has no Graph linkage yet SHALL create the Graph event and store the linkage. Turning `pushToOutlook` from true to false SHALL delete the linked Graph event and clear the linkage.

#### Scenario: Edit patches Graph
- **WHEN** a pushed marker's name, note, dates, or type change
- **THEN** the linked Graph event is patched to reflect the new values

#### Scenario: Activating a staged marker creates the Graph event
- **WHEN** a marker with no stored Graph linkage has `pushToOutlook` turned from false to true
- **THEN** the system creates the all-day Graph event and stores the returned id and calendar identity on the marker

#### Scenario: Un-pushing removes the Graph event
- **WHEN** a marker's `pushToOutlook` is turned off
- **THEN** the linked Graph event is deleted and the stored linkage is cleared

### Requirement: Sync on marker delete
Deleting a marker SHALL delete its linked Graph event when one exists.

#### Scenario: Delete propagates to Graph
- **WHEN** a marker that has a stored Graph linkage is deleted
- **THEN** the system deletes the corresponding Graph event

### Requirement: Graph failures do not block marker writes
A Graph synchronization failure SHALL NOT prevent a marker create, update, or delete from persisting. The failure SHALL be logged and surfaced, and the marker write SHALL still succeed.

#### Scenario: Graph create failure is isolated
- **WHEN** Graph event creation fails during a marker push
- **THEN** the marker is still saved and the error is logged rather than failing the request
