## 1. Event Transformer & Payload Builders

- [x] 1.1 Add `organizerName`, `organizerPhone`, `organizerEmail` extraction to `transformEventToFlatStructure()` in `src/utils/eventTransformers.js` — source from `roomReservationData.organizer`, default to empty strings
- [x] 1.2 Add organizer fields to `buildDraftPayload()` in `src/utils/eventPayloadBuilder.js`
- [x] 1.3 Add organizer fields to `buildRequesterPayload()` in `src/utils/eventPayloadBuilder.js`
- [x] 1.4 Add organizer fields to `buildOwnerEditPayload()` in `src/utils/eventPayloadBuilder.js`
- [x] 1.5 Add organizer fields to `buildEditRequestPayload()` in `src/utils/eventPayloadBuilder.js`

## 2. Form UI

- [x] 2.1 Add `organizerName`, `organizerPhone`, `organizerEmail` to form state in `RoomReservationFormBase.jsx`, pre-populated from `requesterName`/`requesterEmail` on new forms
- [x] 2.2 Add "Event Organizer" section with three text inputs below the "Submitter Information" section in `RoomReservationFormBase.jsx`
- [x] 2.3 Ensure existing event edits (draft edit, pending edit) load saved organizer values rather than re-defaulting to the requester

## 3. Backend Endpoints

- [x] 3.1 Accept and store `organizerName`, `organizerPhone`, `organizerEmail` in `roomReservationData.organizer` in `POST /api/events/request`
- [x] 3.2 Accept and store organizer fields in `POST /api/room-reservations/draft`
- [x] 3.3 Accept and store organizer fields in `PUT /api/room-reservations/:id/edit`
- [x] 3.4 Accept and store organizer fields in `POST /api/room-reservations/public/:token`

## 4. ReviewModal Display

- [x] 4.1 Display organizer name, phone, and email in the ReviewModal detail view (conditionally hidden when all fields are empty)

## 5. Tests

- [x] 5.1 Add backend tests verifying organizer fields are stored and returned for each endpoint
- [x] 5.2 Add frontend test for `transformEventToFlatStructure()` with and without organizer data
- [x] 5.3 Verify existing test suites still pass (run full backend + frontend suites)
