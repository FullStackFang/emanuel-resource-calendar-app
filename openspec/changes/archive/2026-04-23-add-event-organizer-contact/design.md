## Context

The reservation form currently captures the requester's identity (name + email) from Azure AD automatically. These fields are read-only. The security department needs a way to know whom to contact for an event on-site, which may differ from the person who submitted the form. Commit `bc415e5` recently removed unused `department`, `phone`, and `contactEmail` fields from the frontend, though the backend still accepts `phone` and `department` in `roomReservationData.requestedBy`.

The existing `contactPerson` (name + email) object in `roomReservationData` serves the "on behalf of" delegation flow and is gated behind the `isOnBehalfOf` toggle. It is conceptually different from the event organizer — a contact person is an alternate notification recipient, while an organizer is the person security calls about the event.

## Goals / Non-Goals

**Goals:**
- Add optional event organizer fields (name, phone, email) to the reservation form
- Pre-populate organizer fields from the requester's identity so the common case requires zero extra effort
- Store organizer data in a clean, distinct structure (`roomReservationData.organizer`)
- Display organizer info in the ReviewModal details view for approvers/admins

**Non-Goals:**
- Making organizer fields conditionally required based on event type or a "security presence" flag (could be a future enhancement)
- Showing organizer info on list-view cards (ReservationRequests, EventManagement) — user confirmed details-only visibility
- Re-introducing the removed `department` field
- Modifying the existing `contactPerson` / "on behalf of" flow
- Adding organizer to Graph API event bodies or email notification templates

## Decisions

### 1. New `organizer` object vs reusing `requestedBy`

**Decision**: Create `roomReservationData.organizer` as a new nested object.

**Alternatives considered:**
- *Reuse `requestedBy`* — would conflate "who submitted" with "who runs the event." Ownership queries rely on `requestedBy.email` so overwriting it breaks permissions.
- *Top-level `calendarData` fields* — the project convention is that requester/organizer metadata lives in `roomReservationData`, not `calendarData`.

**Rationale:** A separate `organizer` object keeps the requester identity immutable for permission checks while giving security an independent contact record.

### 2. Pre-populate from requester, not blank

**Decision**: On form mount, copy `requesterName` → `organizerName` and `requesterEmail` → `organizerEmail`. Phone starts blank (not available from Azure AD profile in this app).

**Rationale:** The common case is "I am the organizer." Pre-populating eliminates friction. Users only edit when the organizer is someone else.

### 3. Store in all event types (drafts, requests, public submissions)

**Decision**: All four payload builders (`buildDraftPayload`, `buildRequesterPayload`, `buildOwnerEditPayload`, `buildEditRequestPayload`) will include organizer fields.

**Rationale:** Organizer info should persist across the full lifecycle — draft → pending → published. Omitting it from any path creates data loss when status changes.

### 4. No form validation on organizer fields

**Decision**: All three organizer fields are optional with no format validation.

**Rationale:** User confirmed "always optional." Adding email/phone regex would add friction for a security-convenience feature. The data is for human consumption (security calls the number), not programmatic use.

## Risks / Trade-offs

- **Stale pre-populated data**: If the requester edits organizerName to someone else but forgets to update the phone/email, the record is partially wrong → Mitigation: keep all three fields visually grouped so edits to one prompt review of the others.
- **Existing events have no organizer data**: Queries or UI that assume `organizer` exists will get `undefined` → Mitigation: transformer returns empty strings as defaults; no migration needed.
- **Future "required for some events" scope**: If security later wants organizer to be mandatory for certain categories, the optional fields will need validation wiring → Mitigation: the data model supports this; only form validation logic needs adding later.
