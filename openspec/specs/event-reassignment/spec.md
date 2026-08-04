# event-reassignment Specification

## Purpose

Defines how ownership of an already-submitted event moves from one person to
another: who is allowed to initiate the transfer, how the new owner's identity
is established, what the transfer does to a recurring series, and what record
the system keeps of it.

The governing fact is that `roomReservationData.requestedBy` is not descriptive
metadata — it is the join key the rest of the application scopes on.
`view=my-events` filters My Reservations on `requestedBy.email`, withdraw
permission for a pending request checks it, and every notification path routes
to it. Until this capability existed that block was written once at submission
and was never editable afterwards, which made ownership an accident of who
happened to fill in the form. That is the wrong lifetime for it in this
building: assistants rotate which clergy member they support, so responsibility
for an event routinely moves between assistants long after the request was
filed, and an approver looking at a handed-over event had no way to hand it
over in the system.

Three consequences follow from ownership being a join key rather than a label.
The server resolves the target identity from `templeEvents__Users` and ignores
any identity fields the client sends, because a typo'd or spoofed email does
not fail loudly — it silently produces an event that no ownership query can
match. Transfers are gated on `canApproveReservations` rather than being
self-service, since the same field controls what a requester is permitted to do
to the event. And a series master's transfer must cascade: exception and
addition children snapshot the master's `roomReservationData` at creation, so a
master-only write would leave children pointing at the previous owner.

Status is deliberately untouched by a reassignment — nothing in the approval
state machine changes — so `statusHistory` is not written and the audit
collection is the sole record of the transfer. The previous owner remains
visible there; the Submitter Information grid shows only the current owner.

## Requirements

### Requirement: Approver can reassign event ownership
The system SHALL provide `PUT /api/admin/events/:id/reassign` accepting
`{ targetUserId, expectedVersion }`. Callers with `canApproveReservations`
(approver or admin) SHALL be able to transfer ownership of any non-deleted
event; the server SHALL replace `roomReservationData.requestedBy` with an
identity block (name, email, department, phone, userId) built from the target
user's `templeEvents__Users` record, never from client-supplied identity
fields.

#### Scenario: Successful reassignment
- **WHEN** an approver reassigns a pending event from Emily to Jeannette with
  the current `expectedVersion`
- **THEN** the response is 200, `roomReservationData.requestedBy` holds
  Jeannette's name/email/department/phone/userId, `_version` is incremented,
  and `lastModifiedBy`/`lastModifiedDateTime` are updated

#### Scenario: Ownership queries follow the transfer
- **WHEN** an event has been reassigned to Jeannette
- **THEN** it appears in Jeannette's My Reservations
  (`view=my-events` filters on `requestedBy.email`) and no longer in Emily's

#### Scenario: Non-approver is rejected
- **WHEN** a requester or viewer calls the reassign endpoint
- **THEN** the response is 403 and the event is unchanged

#### Scenario: Deleted event is not reassignable
- **WHEN** the target event has status `deleted` or `isDeleted: true`
- **THEN** the response is 400 with code `EVENT_DELETED`

#### Scenario: Reassigning to the current owner is rejected
- **WHEN** the target user's email equals the current `requestedBy.email`
  (case-insensitive)
- **THEN** the response is 400 with code `ALREADY_OWNER`

#### Scenario: Unknown event or target user
- **WHEN** the event id or `targetUserId` matches no document
- **THEN** the response is 404 and nothing is written

#### Scenario: Target user record lacks an email
- **WHEN** the target user's record has no email
- **THEN** the response is 400 with code `TARGET_USER_INCOMPLETE` and nothing
  is written

### Requirement: Reassignment respects optimistic concurrency
The endpoint SHALL apply the write via `conditionalUpdate()` with the caller's
`expectedVersion`.

#### Scenario: Stale version conflicts
- **WHEN** `expectedVersion` does not match the event's `_version`
- **THEN** the response is 409 with the standard `VERSION_CONFLICT` shape and
  ownership is unchanged

### Requirement: Series masters cascade, children are not directly reassignable
Reassignment SHALL reject `exception`/`addition` child documents with 400
`INVALID_TARGET_EVENT_TYPE`. Reassigning a `seriesMaster` SHALL update
`roomReservationData.requestedBy` on every non-deleted child of that series.

#### Scenario: Child document rejected
- **WHEN** the reassign endpoint targets an event with
  `eventType: 'exception'` or `'addition'`
- **THEN** the response is 400 with code `INVALID_TARGET_EVENT_TYPE`

#### Scenario: Master cascades to children
- **WHEN** a series master with two non-deleted exception children is
  reassigned to Jeannette
- **THEN** both children's `roomReservationData.requestedBy` also hold
  Jeannette's identity

### Requirement: Reassignment is audited and notifies the new owner
A successful reassignment SHALL insert an audit entry
(`action: 'ownership-reassigned'`, metadata containing the previous and new
owner's name and email), SHALL email the new owner only, and SHALL broadcast
an SSE event change. Audit and email failures SHALL NOT fail the request.

#### Scenario: Audit entry recorded
- **WHEN** an event is reassigned from Emily to Jeannette
- **THEN** `templeEvents__EventAuditHistory` gains an entry with action
  `ownership-reassigned`, the performing approver, and
  `{ from: Emily, to: Jeannette }` metadata

#### Scenario: Only the new owner is emailed
- **WHEN** an event is reassigned from Emily to Jeannette
- **THEN** a notification email is sent to Jeannette and none is sent to Emily

#### Scenario: Email failure does not fail the transfer
- **WHEN** the email service throws during a reassignment
- **THEN** the response is still 200 and ownership is transferred

### Requirement: Reassign control on the Additional Information tab
The Submitter Information section SHALL show a "Reassign" affordance only to
users with `canApproveReservations`. It SHALL open a searchable picker of all
registered users (name + email, from `GET /api/users`, fetched lazily on first
open) excluding the current owner, and SHALL commit via the standard
in-button confirmation pattern with success/error toasts.

#### Scenario: Approver sees the control
- **WHEN** an approver opens the Additional Information tab of an event review
- **THEN** the Requester cell shows a Reassign affordance

#### Scenario: Non-approver does not see the control
- **WHEN** a requester views the same tab
- **THEN** no Reassign affordance renders

#### Scenario: Picker excludes the current owner
- **WHEN** the approver opens the picker for an event owned by Emily
- **THEN** Emily is absent from the selectable list

#### Scenario: Two-step confirmation
- **WHEN** the approver picks Jeannette and clicks Reassign once
- **THEN** the button enters a "Confirm?" state and no request is sent until a
  second click, which shows "Reassigning..." and disables the button

#### Scenario: Version conflict during reassign
- **WHEN** the reassign request returns 409
- **THEN** the UI shows a one-line error explaining the event changed and
  refreshes the event data (no full ConflictDialog)
