## Why

The security department needs to know the on-site event organizer and their contact information (phone, email) for certain events. Today the only contact info stored is the requester's name and email (read-only, pulled from the logged-in user's Azure AD profile). When an admin assistant submits a reservation on behalf of a program director, or when the person responsible on-site differs from the submitter, there is no way to record who security should contact.

## What Changes

- Add an optional **Event Organizer** section to the reservation form with three fields: organizer name, organizer phone, and organizer email
- Default the organizer fields to the requester's name/email (pre-populated, editable)
- Store organizer data in `roomReservationData.organizer` (new nested object alongside existing `requestedBy`)
- Surface organizer info in the ReviewModal event details view (approvers, admins, and the requester can see it)
- Include organizer fields in all four event payload builders and the centralized event transformer

## Capabilities

### New Capabilities
- `event-organizer-contact`: Capture and display an optional event organizer with name, phone, and email distinct from the reservation requester

### Modified Capabilities

## Impact

- **Frontend form**: `RoomReservationFormBase.jsx` gains 3 new fields in a new "Event Organizer" section
- **Frontend display**: `ReviewModal` / `RoomReservationReview` shows organizer info in event details
- **Payload builders**: All 4 builders in `eventPayloadBuilder.js` include organizer fields
- **Event transformer**: `eventTransformers.js` extracts organizer from `roomReservationData.organizer`
- **Backend endpoints**: `POST /api/events/request`, `POST /api/room-reservations/draft`, `PUT /api/room-reservations/:id/edit`, `POST /api/room-reservations/public/:token` accept and persist organizer fields
- **No breaking changes**: All fields are optional; existing events without organizer data continue to work
- **No migration needed**: Missing `organizer` field defaults gracefully to empty/null
