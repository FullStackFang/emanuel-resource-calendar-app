## MODIFIED Requirements

### Requirement: Event detail fields displayed
The bottom sheet SHALL display key event fields in a clear, readable layout. All fields are read-only; the sheet SHALL offer no editing affordance on any viewport.

#### Scenario: Published event detail
- **WHEN** a published event's detail sheet opens
- **THEN** the sheet SHALL display: event title, status badge ("Published" in green), date and time range, location name(s), requester name and department, categories, event description, and attendee count if available

#### Scenario: Pending event detail
- **WHEN** a pending event's detail sheet opens
- **THEN** the sheet SHALL display the same fields as a published event
- **AND** the status badge SHALL show "Pending" in yellow

#### Scenario: Event with setup/teardown times
- **WHEN** an event has setup time, teardown time, door open, or door close times
- **THEN** the detail sheet SHALL display these timing fields in a dedicated section

#### Scenario: Event without optional fields
- **WHEN** an event does not have a description, attendee count, or timing fields
- **THEN** those sections SHALL be omitted from the detail sheet (not shown as empty)

#### Scenario: No edit affordance
- **WHEN** any user opens the detail sheet for any event, regardless of permissions
- **THEN** the sheet SHALL NOT offer any control that modifies the event's fields

## ADDED Requirements

### Requirement: Reservation context in the detail sheet
When the detail sheet is opened from the Requests tab, it SHALL display the request's review context so the user can see where the request stands without leaving mobile.

#### Scenario: Status history timeline
- **WHEN** the detail sheet opens for a reservation request
- **THEN** the sheet SHALL render entries from the event's `statusHistory[]` as a chronological timeline
- **AND** each entry SHALL show the status reached, when it changed, and who changed it

#### Scenario: Rejection reason surfaced
- **WHEN** the detail sheet opens for a request whose status is rejected
- **THEN** the sheet SHALL display the rejection reason above the event's timing details

> **Removed during implementation — conflict context on a rejected request.**
> A scenario requiring the sheet to display a conflicting event's title and time
> range was dropped because no such data exists to display. Scheduling conflicts
> are transient: `checkRoomConflicts()` returns `hardConflicts` / `softConflicts`
> inside a `409 SchedulingConflict` response body, and neither
> `PUT /api/admin/events/:id/reject` nor any other write persists them onto the
> event document (`conflictDetails` is an rsched import staging field only).
> Restoring this scenario requires first persisting a conflict snapshot at
> rejection time — backend work this change explicitly scoped out.

### Requirement: Withdraw a pending request
The detail sheet SHALL allow a user to withdraw their own pending reservation request, and SHALL offer this action in no other circumstance.

#### Scenario: Withdraw offered only for own pending request
- **WHEN** the viewer is the requester of the displayed request and its status is pending
- **THEN** the sheet SHALL display a "Withdraw Request" action

#### Scenario: Withdraw not offered otherwise
- **WHEN** the displayed request is not the viewer's own, or its status is published, rejected, draft, or deleted
- **THEN** the sheet SHALL NOT display a "Withdraw Request" action

#### Scenario: In-button confirmation
- **WHEN** the user taps "Withdraw Request"
- **THEN** the button SHALL enter a confirm state reading "Confirm withdrawal?" styled with the destructive color
- **AND** the confirm state SHALL persist until the user confirms, takes another action, or leaves the view
- **AND** the system SHALL NOT use a browser confirmation dialog

#### Scenario: Withdrawal submitted
- **WHEN** the user taps the button a second time in its confirm state
- **THEN** the system SHALL call `DELETE /api/admin/events/:id` with a reason
- **AND** the button SHALL read "Withdrawing..." and be disabled for the duration of the call
- **AND** on success the system SHALL show a success toast, close the sheet, and refresh the Requests list

#### Scenario: Withdrawal fails
- **WHEN** the withdraw call fails for any reason other than a version conflict
- **THEN** the system SHALL show an error toast
- **AND** the button SHALL return to its idle state so the user can retry

### Requirement: Version conflicts resolve without a diff view
A version conflict on mobile SHALL be reported as a plain outcome rather than reproducing the desktop field-level conflict dialog, which does not fit a phone viewport.

#### Scenario: Conflict on withdraw
- **WHEN** a withdraw call returns HTTP 409 with code `VERSION_CONFLICT`
- **THEN** the system SHALL inform the user that the request was already handled
- **AND** SHALL close the sheet and refresh the Requests list
- **AND** SHALL NOT render a field-level diff or a multi-mode conflict dialog
