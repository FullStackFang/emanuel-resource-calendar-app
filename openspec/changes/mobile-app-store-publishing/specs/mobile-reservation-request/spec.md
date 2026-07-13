## ADDED Requirements

### Requirement: Step-wizard reservation request form on mobile
The Request tab SHALL provide a mobile-first, step-based wizard for submitting a room reservation request: What (title, description, category) -> When (date, times, setup/teardown) -> Where (room selection) -> Details (attendees, services) -> Review & Submit.

#### Scenario: Wizard navigation
- **WHEN** the user completes a step and taps Next
- **THEN** the wizard SHALL advance to the next step with progress indication
- **AND** Back SHALL return to the previous step with entered values preserved

#### Scenario: Per-step validation
- **WHEN** the user taps Next with required fields missing or invalid on the current step
- **THEN** the wizard SHALL show inline validation errors and SHALL NOT advance

#### Scenario: Guest prompted to sign in
- **WHEN** an unauthenticated guest opens the Request tab
- **THEN** the system SHALL show a sign-in prompt instead of the wizard

### Requirement: Wizard reuses shared reservation business logic
The wizard SHALL submit through the same processing path as the desktop form, producing an identical request payload.

#### Scenario: Same submission payload
- **WHEN** the user submits the wizard's Review step
- **THEN** the request SHALL be built via payload-shaping logic extracted into a shared utility (note: `getProcessedFormData` is today a component-local closure inside `RoomReservationReview.jsx` bound to form refs — it MUST first be lifted into an importable function alongside the existing `eventPayloadBuilder.js` exports; the desktop form SHALL be migrated to consume the same extraction)
- **AND** the created event SHALL be indistinguishable from one submitted via the desktop form (status `pending`, `roomReservationData.requestedBy` populated as canonical requester source)

#### Scenario: Room availability checking
- **WHEN** the user selects a room and time in the Where step
- **THEN** the system SHALL run the same availability/conflict check as desktop and surface conflicts before submission

#### Scenario: Capacity and feature filtering
- **WHEN** the user has entered an attendee count and required features
- **THEN** the Where step SHALL filter reservable locations by capacity and features (same rules as desktop)

### Requirement: Holiday/closure marker behavior preserved
The wizard SHALL apply the same calendar-marker advisory and blocking behavior as the desktop reservation form.

#### Scenario: Advisory marker warning
- **WHEN** the selected date carries a `warnOnReservation` marker
- **THEN** the wizard SHALL display the non-blocking advisory (ReservationMarkerAdvisory content) in the When or Review step

#### Scenario: Blocking closure warning on submit
- **WHEN** the selected date falls on a blocking holiday/closure
- **THEN** the submit action SHALL present the same blocking warning flow as the desktop Submit Request
