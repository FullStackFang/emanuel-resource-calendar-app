## ADDED Requirements

### Requirement: Form captures event organizer information
The reservation form SHALL display an "Event Organizer" section with three optional fields: organizer name, organizer phone, and organizer email. The section SHALL appear below the existing "Submitter Information" section. All three fields SHALL be editable text inputs.

#### Scenario: New reservation form loads with pre-populated organizer
- **WHEN** a user opens the reservation form (new request, new draft, or public token form)
- **THEN** the organizer name field SHALL be pre-populated with the requester's display name
- **AND** the organizer email field SHALL be pre-populated with the requester's email address
- **AND** the organizer phone field SHALL be empty

#### Scenario: User edits organizer fields
- **WHEN** a user modifies any organizer field and submits the form
- **THEN** the submitted payload SHALL include the user-entered organizer name, phone, and email values

#### Scenario: User leaves organizer fields unchanged
- **WHEN** a user submits the form without modifying the pre-populated organizer fields
- **THEN** the submitted payload SHALL include the pre-populated values (requester's name and email, empty phone)

#### Scenario: Organizer fields on existing event edit
- **WHEN** a user opens an existing event for editing (pending edit or draft edit)
- **THEN** the organizer fields SHALL display the previously saved organizer values, not re-default to the requester

### Requirement: Organizer data persists through all event lifecycle paths
All event creation and update endpoints SHALL accept and store organizer fields in `roomReservationData.organizer` as `{ name, phone, email }`.

#### Scenario: Draft creation stores organizer
- **WHEN** a draft is created via `POST /api/room-reservations/draft`
- **THEN** the event document SHALL contain `roomReservationData.organizer` with the submitted name, phone, and email

#### Scenario: Request submission stores organizer
- **WHEN** a reservation request is submitted via `POST /api/events/request`
- **THEN** the event document SHALL contain `roomReservationData.organizer` with the submitted name, phone, and email

#### Scenario: Owner edit preserves organizer
- **WHEN** an owner edits a pending event via `PUT /api/room-reservations/:id/edit`
- **THEN** the updated document SHALL reflect any changes to `roomReservationData.organizer`

#### Scenario: Public token submission stores organizer
- **WHEN** a guest submits via `POST /api/room-reservations/public/:token`
- **THEN** the event document SHALL contain `roomReservationData.organizer` with the submitted values

#### Scenario: Existing events without organizer data
- **WHEN** an event created before this feature is loaded
- **THEN** the system SHALL treat missing `roomReservationData.organizer` as `{ name: '', phone: '', email: '' }`

### Requirement: Organizer info displayed in event details
The ReviewModal event details view SHALL display organizer name, phone, and email when any organizer field has a non-empty value.

#### Scenario: Event has organizer info
- **WHEN** a user opens the ReviewModal for an event that has organizer data
- **THEN** the detail view SHALL show the organizer name, phone, and email in a labeled section

#### Scenario: Event has no organizer info
- **WHEN** a user opens the ReviewModal for an event with no organizer data (legacy event or all fields blank)
- **THEN** the organizer section SHALL NOT be displayed

### Requirement: Organizer fields included in event transformer
The centralized `transformEventToFlatStructure()` function SHALL extract organizer fields from `roomReservationData.organizer` and expose them as `organizerName`, `organizerPhone`, and `organizerEmail`.

#### Scenario: Transform event with organizer data
- **WHEN** `transformEventToFlatStructure()` receives an event with `roomReservationData.organizer`
- **THEN** the output SHALL include `organizerName`, `organizerPhone`, and `organizerEmail` with the stored values

#### Scenario: Transform event without organizer data
- **WHEN** `transformEventToFlatStructure()` receives an event without `roomReservationData.organizer`
- **THEN** the output SHALL include `organizerName: ''`, `organizerPhone: ''`, and `organizerEmail: ''`
