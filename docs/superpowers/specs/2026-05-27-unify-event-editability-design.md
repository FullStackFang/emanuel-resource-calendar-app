# Unify Event Editability (owner + same-department + ownerless/rsched)

- **Date:** 2026-05-27
- **Status:** Design approved; ready for implementation plan
- **Author:** brainstorming session (architecture-reviewed)

## Problem

"Who can edit / request-edit / request-cancellation on an event" is decided in
**seven** places that read **different data** and therefore disagree. The
intended model already exists in code — `isOwner || isSameDepartment ||
isOwnerless || isRschedImported` — but the `isSameDepartment` term is
implemented inconsistently, so the edit/request button silently fails to appear
on several surfaces even when the backend would allow the action.

The user's request ("imported rsched events editable by anyone; app events
editable by the creator and anyone in their department") maps onto the existing
model. The rsched half already shipped (2026-05-21). This work is **unification
and reliability**, not new capability.

## Goals

- One canonical editability rule, mirrored on FE and BE, reading the **same**
  stored data so the two can never disagree.
- "Same department" actually works on every entry point (Calendar, My
  Reservations, Approval Queue, day panels/popups).
- A shared, data-only test contract that fails on both runners if the two
  implementations drift.

## Non-goals

- No change to the approval workflow / status machine.
- Drafts stay **private** (owner-only). Department editing applies only to
  pending/rejected (direct edit) and published (request-edit).
- No new editor relationships beyond owner / same-department / ownerless /
  rsched.
- No isomorphic shared *code* module (ESM frontend vs CommonJS backend). We
  share *data* (a JSON fixture) instead.

## Locked decisions

| # | Decision | Choice |
|---|---|---|
| a | Goal | Unify & make reliable (not expand) |
| b | Event department source | **Stored at creation** (`requestedBy.department`), not live |
| c | Draft scope | Drafts stay owner-only private |
| d | Backend live creator-lookup fallback | **Delete** — both sides rely solely on the stored field (true FE=BE parity); backfill is the safety net |
| e | Flat `roomReservationData.department` field | **Single canonical field** — gate strictly on `requestedBy.department`; the flat field is display-only / non-gating |
| f | Admin-created / ownerless events (no requester) | **Keep existing** — remain community-editable (`isOwnerless`), like Graph-synced events |

## Current state (verified 2026-05-27)

### Already shipped (not changing)
- rsched community-editable: every gate carries `isRschedImported = source === 'rsSched'`.
- Events store the owner's department at creation via
  `buildRequestedByObject()` → `requestedBy.department` (`backend/utils/eventFieldBuilder.js:357`).
  The two requester-facing create paths resolve `effectiveDepartment` from the
  creator profile: draft (`backend/api-server.js:15588-15597`) and request
  (`backend/api-server.js:20814-20823`).

### The seven gate sites (to converge)
Frontend:
1. `src/hooks/useCurrentUserGates.js:112-116` — `deriveGates`, reads enriched `event.creatorDepartment`.
2. `src/components/Calendar.jsx:650-703` — duplicate `canEditThisEvent` / `canRequestEditThisEvent` useMemos, read `item.creatorDepartment`. **Dead code** (never referenced).
3. `src/components/DayEventPanel.jsx:258` — "Request Edit" shown on `canSubmitReservation && !canEditEvents` only (no ownership/department check).
4. `src/components/DayEventsPopup.jsx:275` — same as #3.

Backend:
5. `backend/api-server.js:22209-22250` — `POST /api/edit-requests`: stored dept **+ live creator-user lookup fallback**.
6. `backend/api-server.js:23456-23484` — `POST /api/events/:id/request-cancellation`: same rich logic as #5.
7. `backend/api-server.js:17469-17487` — `PUT /api/room-reservations/:id/edit`: stored dept **only**.

### Why they diverge
- `creatorDepartment` is enriched in exactly one place — `getUnifiedEvents()`
  (`backend/api-server.js:6188-6216`), which serves only `/api/events/load`
  (Calendar). `/api/events/list` (`:7320`; My Reservations / Approval Queue /
  Event Management) never sets it, so the FE department check is dead there.
- The BE additionally does a live profile lookup, which the FE cannot
  replicate — the root of the "button missing but server allows it" bug.

### Data-source facts that shaped the rule
- `calendarData.department` was already `$unset` on all `roomReservationData`
  events by `backend/migrate-deduplicate-requester-info.js:193` — a **dead**
  fallback. Dropped from the rule.
- `roomReservationData.department` (flat) is written by draft-save
  (`:15819`) and owner-edit (`:17708`) but **read by no gate** today. Per
  decision (e) it stays non-gating (display-only).
- Admin "new event" path `POST /api/events/:eventId/audit-update`
  (`:7937`, insert at `:8172-8208`) writes **no** `roomReservationData` —
  these events are `isOwnerless` and community-editable. Per decision (f),
  preserved.

## The canonical rule

Normalization: `normalize(d) = (d || '').toLowerCase().trim()`.

```
resolveEventDepartment(event):
    return normalize(event.roomReservationData?.requestedBy?.department)
    // calendarData.department: dead (migration-unset), not read
    // roomReservationData.department (flat): display-only, not read

ownerEmailChain(event):
    return [ event.roomReservationData?.requestedBy?.email,
             event.calendarData?.requesterEmail,
             event.requesterEmail ]
           .map(toLowerCase).filter(Boolean)

isEventOwner(event, currentUserEmail):
    e = toLowerCase(currentUserEmail)
    return !!e && ownerEmailChain(event).includes(e)
    // Ownership is the canonical requestedBy.email chain ONLY. createdBy is not
    // consulted: an admin who created-on-behalf is not the "owner" and uses the
    // admin-save path. Admin-created events with no requester are isOwnerless
    // (below) and thus community-editable on BOTH sides — composite agrees.

isEventOwnerless(event):
    return !event.roomReservationData?.requestedBy?.email

isRschedImported(event):
    return event.source === 'rsSched'

isSameDepartment(event, userDepartment):
    ed = resolveEventDepartment(event)
    ud = normalize(userDepartment)
    return !!(ud && ed && ud === ed)   // userDepartment = caller's OWN live profile dept

communityEditable(event, user):           // user = { email, department }
    return isEventOwner(event, user.email)
        || isSameDepartment(event, user.department)
        || isEventOwnerless(event)
        || isRschedImported(event)
```

Status layering (unchanged from today's intent):

| Status | Who may act | Flow |
|---|---|---|
| draft | owner only (+admin) | direct edit — drafts private |
| pending / rejected | owner OR same-dept (+admin) | direct edit (owner-edit endpoint) |
| published (app) | owner OR same-dept | request-edit (propose → approver) |
| published (rsched/ownerless) | anyone (any requester) | request-edit |

> Parity note: ownership is computed from the email chain identically on both
> sides; `createdBy`/`createdByEmail`/`requestedBy.userId` are **not** used for
> ownership. Requester-less events are covered by `isEventOwnerless` on both
> sides, so the **composite** decision provably agrees — which is what the
> shared contract locks.

## Design

### 1. Data layer — self-describing events
- **Canonical field:** `roomReservationData.requestedBy.department`.
- **Close straggler creation paths:** audit every event-creation path; ensure
  each that establishes a requester populates `requestedBy.department` from the
  creator profile (the two requester paths already do; guest path passes
  `department || ''`; admin `audit-update` intentionally writes no requester →
  ownerless, per (f)).
- **One-time backfill** `backend/migrate-backfill-requester-department.js`
  (CLAUDE.md migration conventions — `--dry-run`/`--verify`, `BATCH_SIZE=100`,
  1000ms inter-batch delay, progress bar, `withCosmosRetry`, idempotent):
  - Target: `source != 'rsSched'`, `eventType ∈ {singleInstance, seriesMaster}`
    (exclude `occurrence`/`exception`/`addition` children), with
    `requestedBy.email` present but `requestedBy.department` missing/empty.
  - Fill from the creator's current profile department
    (`requestedBy.userId`/`email` → `usersCollection`).
  - Skip rsched (department moot) and requester-less events (nothing to fill).

### 2. Backend unification
- New pure module `backend/utils/eventEditability.js` exporting
  `resolveEventDepartment`, `isEventOwner`, `isEventOwnerless`,
  `isRschedImported`, `isSameDepartment`, `canRequestEditEvent(event, user)`,
  `canDirectEditEvent(event, user)`. Normalizes internally.
- The three endpoints (#5, #6, #7) call the helper. The **live creator-lookup
  fallback is deleted** (decision d). Each endpoint still owns its own OCC
  (`conditionalUpdate` + `_version`) and status guards — the helper only returns
  booleans.

### 3. Frontend unification
- `deriveGates` (`useCurrentUserGates.js`) reads `resolveEventDepartment(event)`
  instead of `event.creatorDepartment`. Owner/ownerless/rsched logic unchanged.
- Delete the dead `canEditThisEvent` / `canRequestEditThisEvent` useMemos in
  `Calendar.jsx`.
- `DayEventPanel.jsx:258` and `DayEventsPopup.jsx:275`: gate the "Request Edit"
  button on the per-event rule (via `useCurrentUserGates`/`deriveGates`) so it
  no longer appears for non-owner, non-department, non-ownerless events.
- Remove the orphaned `creatorDepartment` enrichment in `getUnifiedEvents()`
  (`api-server.js:6188-6216`) — eliminates the second source of truth.

### 4. Shared parity test contract
- Data-only fixture `backend/__tests__/__fixtures__/eventEditabilityCases.json`:
  array of `{ name, event, user, modalContext, expect: { canRequestEdit,
  canDirectEdit, ... } }` covering owner / same-dept / different-dept /
  ownerless / rsched / admin-created across every status, including
  drafts-private cases and the published-app vs published-rsched split.
- Jest (BE) imports via `@fixtures/eventEditabilityCases` and asserts against
  `eventEditability.js`.
- Vitest (FE) imports via relative path
  (`../../../backend/__tests__/__fixtures__/eventEditabilityCases.json`) and
  asserts against `deriveGates`. Import paths are not restricted by Vitest's
  `include`; JSON imports work in both runtimes — no config changes.

## Behavior changes & edge cases (honest accounting)
- **Stale department (accepted, decision b):** an event keeps its creation-time
  department; if the creator later changes teams, the event does not follow.
- **Empty-stored-dept after fallback deletion:** an app event whose creator had
  no resolvable department at backfill time is owner-/admin-only. Today's live
  lookup would also usually find nothing; backfill minimizes the gap. This is
  the deliberate cost of FE=BE parity (decision d).
- **Form-edited department has no effect on edit access** (decision e) — gating
  is on `requestedBy.department`, not the flat field.
- **Backend ownership definition narrows (parity fix):** `POST /api/edit-requests`
  currently treats `createdBy`/`createdByEmail`/`requestedBy.userId` matches as
  ownership (`:22210-22214`). The unified rule uses the `requestedBy.email`
  chain only, so the BE matches the FE. The only events affected are
  created-on-behalf events where `createdByEmail === current user` but
  `requestedBy.email` is someone else and non-empty — those lose the owner path
  on this endpoint (admins use the admin-save path, so this is not expected to
  be user-visible). Requester-less events stay editable via `isOwnerless`.
- **Admins/approvers:** unaffected — `canEditEvents`/`canApproveReservations`
  override everything, as today.
- **rsched:** unchanged — `isRschedImported` short-circuits regardless of dept.
- **Admin-created/ownerless events:** remain community-editable (decision f).

## Verification plan (TDD-first per CLAUDE.md)
1. Write the shared fixture + the two contract tests (FE Vitest, BE Jest) first
   — they will fail until the helpers exist.
2. Implement `backend/utils/eventEditability.js`; make Jest contract green.
3. Refactor `deriveGates` to the helper's field reads; make Vitest contract +
   existing `useCurrentUserGates.test.js` green.
4. Wire the 3 BE endpoints to the helper; delete the fallback. Run
   `editRequestsCreate.test.js`, `cancellationRequest.test.js`, and the
   owner-edit tests.
5. Gate `DayEventPanel`/`DayEventsPopup`; delete Calendar.jsx dead useMemos;
   remove `creatorDepartment` enrichment. Frontend tests.
6. Backfill script: `--dry-run` then `--verify` against a seeded dataset; unit
   test the query predicate and child-doc exclusion.

## File-change inventory
- New: `backend/utils/eventEditability.js`
- New: `backend/migrate-backfill-requester-department.js`
- New: `backend/__tests__/__fixtures__/eventEditabilityCases.json`
- New: BE Jest contract test + FE Vitest contract test
- Edit: `src/hooks/useCurrentUserGates.js` (department read)
- Edit: `src/components/Calendar.jsx` (delete dead useMemos)
- Edit: `src/components/DayEventPanel.jsx`, `src/components/DayEventsPopup.jsx` (gate button)
- Edit: `backend/api-server.js` (3 endpoints → helper, delete fallback; remove `getUnifiedEvents` enrichment; audit/fix straggler create paths)

## Risks
- Backfill correctness on Cosmos (cross-partition reads, child-doc exclusion) —
  mitigated by `--dry-run`/`--verify` and the established batch pattern.
- Removing the enrichment could affect any other consumer of
  `creatorDepartment` — grep confirms only the gate code reads it; verify again
  before deletion.
- A residual reduction in department-edit access for un-backfillable events
  (documented, accepted).
