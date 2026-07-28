# sync-health-reconcile — Delta Spec

## ADDED Requirements

### Requirement: Two-phase plan/apply reconcile API
The system SHALL expose two admin-only endpoints:
`POST /api/admin/sync-health/reconcile/plan` and
`POST /api/admin/sync-health/reconcile/apply`. `plan` SHALL re-observe current state
(Mongo document plus a narrow Graph probe) — never trusting a previously rendered
report — and return an ordered op list with human-readable descriptions, warnings, and
an `expectedState` fingerprint with a soft `expiresAt`. `apply` SHALL re-observe again
before any write and MUST refuse with `409 STALE_FINDING` (including the fresh
observation) when any fingerprinted fact has changed.

#### Scenario: Non-admin is rejected
- **WHEN** a user with the approver role (but not admin) calls either endpoint
- **THEN** the response is 403 and no observation or write occurs

#### Scenario: Stale finding aborts before any write
- **WHEN** a plan is created, then the target document's `_version` changes (or its `graphData.id` appears, or it is un-deleted, or the Outlook probe result changes), then apply is called with the original `expectedState`
- **THEN** the response is `409 STALE_FINDING` with the fresh observation, and zero Graph or Mongo writes occurred

#### Scenario: Expired plan must be re-planned
- **WHEN** apply is called with an `expectedState` past its `expiresAt`
- **THEN** the request is rejected and the client must call plan again

### Requirement: Decision context before an action is chosen
A `plan` request that omits `action` SHALL return the current observation and
the actions available for that finding type, performing reads only and returning
no ops and no `expectedState`. The observation SHALL include the event's date,
times, locations, requester, status and creation date, plus the Outlook entries
present on the event's date, so an admin can distinguish a stale placeholder
from a live booking and verify the finding rather than trust it. `apply` SHALL
continue to require an `action`.

#### Scenario: Context request describes the event and the day
- **WHEN** plan is called for an `untethered` finding with no `action`
- **THEN** the response carries the document's date, times, location, requester and creation date, the list of Outlook entries on that date, and the available actions — with no ops, no fingerprint, and no writes

#### Scenario: Empty Outlook day is stated, not omitted
- **WHEN** the event's date has no Outlook entries at all
- **THEN** the response reports an empty day explicitly rather than omitting the field

#### Scenario: Apply still requires an action
- **WHEN** apply is called without an `action`
- **THEN** the request is rejected with 400 and nothing is observed or written

### Requirement: shouldNotBeInOutlook delete action
For a `shouldNotBeInOutlook` finding, apply SHALL delete the surviving Outlook
occurrence/event, subject to ALL of: (a) `confirmIrreversible: true` in the request,
enforced server-side; (b) the fingerprint re-derives the app-side justification (the
exclusion date is still recorded, or the app document is still deleted) — the Outlook
item's existence alone SHALL NOT justify deletion; (c) apply fetches the target via
`getEvent` and MUST abort if its `type` is `seriesMaster`; (d) the full pre-delete
event snapshot is stored in the audit entry. Deleting an already-absent event (404)
SHALL report success as `alreadyGone`.

#### Scenario: Delete without confirmation is refused
- **WHEN** apply is called for a plan containing a Graph delete without `confirmIrreversible: true`
- **THEN** the response is 400 and no Graph call is made

#### Scenario: Justification vanished
- **WHEN** the app document that justified deletion was un-deleted (or the exclusion removed) between plan and apply
- **THEN** apply returns `409 STALE_FINDING` and the Outlook event is not deleted

#### Scenario: Series-master id guard
- **WHEN** the Graph probe reveals the target id resolves to an event with `type: 'seriesMaster'`
- **THEN** apply aborts without deleting

#### Scenario: Idempotent re-apply
- **WHEN** apply runs twice for the same delete and the second Graph delete returns 404
- **THEN** the second apply reports the op as `alreadyGone` success

#### Scenario: Attendee warning surfaced at plan time
- **WHEN** the target Outlook event has one or more attendees
- **THEN** the plan response includes a warning that deletion will send cancellations

### Requirement: Untethered event actions
For an `untethered` finding (published app document with no stored Graph link), the
system SHALL offer three actions: (a) **link to existing** — set the document's Graph
linkage to an admin-chosen candidate Outlook event, writing Mongo only; (b) **archive
in app** — soft-archive via the existing delete/restore machinery with a distinct
statusHistory reason, writing Mongo only; (c) **publish to Outlook** — single-instance
documents only in this version, creating the Graph event via the shared republish core
and persisting the link, with a compensating Graph delete if the link persist fails.
All Mongo writes SHALL use `conditionalUpdate` with the fingerprinted `_version`.

#### Scenario: Link to existing writes only Mongo
- **WHEN** an admin applies link-to-existing with a candidate's Graph id
- **THEN** the document's Graph linkage is set via OCC, no Graph write occurs, and an SSE broadcast is emitted

#### Scenario: Publish creates and links atomically-ordered
- **WHEN** an admin applies publish for a single-instance untethered document
- **THEN** the Graph event is created first, its id persisted to the document via OCC second, and on OCC conflict the created Graph event is compensating-deleted and its id reported

#### Scenario: Series masters cannot publish in v1
- **WHEN** plan is requested for action `publish` on an untethered `seriesMaster`
- **THEN** the plan is refused with an explanation that series republish is not yet supported

### Requirement: Duplicate-creation guard
Before proposing publish for an untethered document, plan SHALL probe the mailbox's
calendarView on the event's date for untracked events whose normalized subject matches
the document's would-be Graph subject. When candidates exist, the plan's recommendation
SHALL flip to link-to-existing with candidates listed, and apply with action `publish`
MUST be refused with `422 DUPLICATE_CANDIDATE` unless the request carries
`allowDuplicate: true`.

#### Scenario: Candidate found flips recommendation
- **WHEN** plan runs for an untethered event and a same-subject same-date untracked Outlook event exists
- **THEN** the plan recommends link-to-existing and lists the candidate(s)

#### Scenario: Publish over a candidate requires override
- **WHEN** apply is called with action `publish` while candidates exist and `allowDuplicate` is absent
- **THEN** the response is `422 DUPLICATE_CANDIDATE` and no Graph event is created

### Requirement: Every apply is audited
Every apply SHALL write one entry to `templeEvents__EventAuditHistory` with
`source: 'SyncHealthReconcile'`, the action, finding type, calendar owner, actor, the
fingerprint hash, and any Graph ids created or deleted. Status-changing actions SHALL
also push `statusHistory[]`, and Mongo-writing actions SHALL emit an SSE broadcast.
Created Graph ids SHALL be recorded in `roomReservationData.createdGraphEventIds`.

#### Scenario: Audit entry on delete
- **WHEN** an Outlook delete apply succeeds
- **THEN** an audit entry exists containing the deleted Graph id and the full pre-delete event snapshot

#### Scenario: Archive pushes statusHistory
- **WHEN** an archive apply succeeds
- **THEN** the document's `statusHistory[]` gains an entry with the reconcile-specific reason and the actor

### Requirement: Fix panel on the report page
The Sync Health report SHALL render a "Fix…" affordance on finding rows in categories
with available actions, visible only to admins. The panel SHALL render the plan's op
descriptions, warnings, and candidates verbatim from the server response, use the
in-button confirmation pattern for apply (no browser dialogs), and on completion or
`STALE_FINDING` SHALL refresh the report scoped to that calendar with a toast.

#### Scenario: Non-admin sees no Fix affordance
- **WHEN** an approver (non-admin) views the report
- **THEN** no Fix buttons render

#### Scenario: Irreversible apply requires in-button confirmation
- **WHEN** an admin clicks apply for a plan containing a Graph delete
- **THEN** the button first enters a confirm state and only a second click sends the request with `confirmIrreversible: true`

#### Scenario: Stale finding refreshes the report
- **WHEN** apply returns `409 STALE_FINDING`
- **THEN** the UI shows an explanatory toast and re-runs the report for that calendar only
