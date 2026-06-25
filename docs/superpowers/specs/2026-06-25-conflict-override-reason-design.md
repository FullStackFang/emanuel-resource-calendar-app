# Conflict Override with Forced Reason & Auto-Clear — Design

**Date:** 2026-06-25
**Status:** Approved (brainstorming) — pending implementation plan

## Problem

Approvers want to override hard scheduling conflicts (double-booking a room against an
already-published event) because they sometimes know business context the system cannot
see. A blanket override is risky: it allows silent double-bookings with no accountability.

We want to add **friction and accountability**:

1. Forcing a hard conflict requires a mandatory **override reason** (free text).
2. The reason is recorded permanently in the **audit trail of BOTH conflicting events**.
3. The reason is **surfaceable** on either event's record so reviewers can see *why* the
   double-book was allowed.
4. If either event is later updated so the conflict no longer exists, the live override
   reason is **automatically cleared on both events** (the permanent audit entries remain).

## Current System (grounding)

- `checkRoomConflicts(event, excludeId)` returns two tiers:
  - `hardConflicts` — overlaps with **published** events (blocking).
  - `softConflicts` — overlaps with **pending edit requests** (advisory; cleared today via
    `acknowledgeSoftConflicts`, no reason needed).
- Each conflict object already carries the counterpart event's `_id` (via `CONFLICT_PROJECTION`),
  so the set of events to annotate is known.
- Every hard-conflict `409` response carries `canForce` + `forceField`. Today only **admin
  restore** sets `canForce: true`; approver publish/submit/owner-edit paths return
  `canForce: false`. So this feature flips force ON for approvers, gated behind a reason.
- Two history mechanisms exist: append-only audit collections (`auditService.recordEvent`
  → `templeEvents__EventAuditHistory`) and the `statusHistory[]` array on each event doc.
- All event writes go through `conditionalUpdate()` with `_version` (optimistic concurrency).

## Key Decisions

| # | Decision |
|---|----------|
| 1 | **Split audit vs live state.** Permanent append-only audit entries (override + later clear) are never deleted. A separate live override record holds the current reason and is cleared on resolution. |
| 2 | **Edge collection storage.** A dedicated `templeEvents__ConflictOverrides` collection, one document per overridden pair — single source of truth (not mirrored arrays on event docs). |
| 3 | **All three auto-clear triggers** are in scope: time/room edits, either event removed, and opportunistic re-check on the counterpart's own publish/restore. |
| 4 | **One reason per override action**, applied to every E↔Cn edge created in that action (edges still clear independently). |
| 5 | **Reason required for everyone** — approvers AND admins. No silent hard-conflict overrides. (Tightens today's silent admin restore-force.) |
| 6 | **Soft conflicts unchanged** — keep the advisory `acknowledgeSoftConflicts` flow, no reason. |

## Data Model — `templeEvents__ConflictOverrides`

One document per overridden pair, symmetric:

```javascript
{
  _id: ObjectId,
  pairKey: "<sortedIdA>_<sortedIdB>",       // canonical key, ids sorted — E↔C and C↔E collapse to one
  eventIds: [ObjectId, ObjectId],            // the two events; query with { eventIds: <thisId> }
  reason: String,                            // mandatory override justification
  overriddenBy: { userId, email, name },
  overriddenAt: Date,
  context: 'publish' | 'restore' | 'save',   // which operation forced the override
  active: Boolean,                           // true = live; false = resolved
  resolvedAt: Date | null,
  resolvedBy: { userId, email } | 'system' | null,
  resolvedReason: 'time_room_edit' | 'event_removed' | 'recheck' | null,
  _version: Number,
  createdAt: Date
}
```

**Indexes:**
- `{ eventIds: 1, active: 1 }` — enrichment lookups.
- Partial unique index on `pairKey` where `active: true` — prevents two live edges for the same pair.

**Why an edge collection (vs mirrored arrays on event docs):** the override is a property
of the *relationship* between two events, not of one event. The edge carries its own
`_version`, decoupled from both event docs — so clearing an edge is a self-contained write
that cannot lose an OCC race against the event update that triggered it, and there is no
mirror to drift on partial failure. Auto-clear of a pair is a single atomic write that
resolves both sides at once.

## Override Flow (write path)

At each hard-conflict check site (publish/submit, admin save, owner edit, restore), replace
the flat `canForce: false` branch with:

- **If `req.body.forceConflicts` AND caller has `canApproveReservations`:**
  1. Require non-empty trimmed `overrideReason` → else `400 OVERRIDE_REASON_REQUIRED`.
     (Server-side gate; UI validation is not trusted.)
  2. Perform the operation (publish/save/restore) as normal.
  3. For **each** hard-conflict counterpart `Cn`: upsert an `active` edge `{E, Cn}` with the
     single shared reason (canonical `pairKey`, idempotent on the partial-unique index).
  4. Write append-only audit entries to **both** E's and Cn's audit history via
     `auditService.recordEvent`, metadata `{ action: 'conflict_override', counterpartEventId, reason }`.
- **Else** (no force, or caller lacks `canApproveReservations`): return the existing 409 with
  `canForce: true, forceField: 'forceConflicts', requiresReason: true`.

Soft conflicts: unchanged.

## Auto-Clear (resolution path)

Shared helper `reconcileConflictOverrides(eventId, actor)`:

1. Load all `active` edges containing `eventId`.
2. For each edge, load the counterpart and decide "does a hard conflict still exist?":
   - Either event no longer `published` (deleted / rejected / cancelled) → resolved (`event_removed`).
   - Otherwise run the **same overlap math** as `checkRoomConflicts` (room intersection +
     setup/teardown-extended time window) against just the counterpart → no overlap →
     resolved (`time_room_edit`); re-check trigger uses `recheck`.
3. Resolve = flip edge `active: false` + set `resolvedAt/By/Reason`, and write append-only
   audit entries to **both** events ("Conflict override cleared — …").

Wrapped in try/catch, failure-isolated (never breaks the main operation), matching the
`auditService` / calendar-marker push patterns.

**Called from:**
1. After a successful event edit that touches time / room / setup / teardown.
2. After delete / reject / cancel (status leaves `published`).
3. Opportunistically at the counterpart's own publish/restore/save conflict check.

## Surfacing (read path)

An enrichment step (mirroring `enrichSeriesMastersWithOverrides`) attaches
`activeConflictOverrides[]` to events when loaded for review. The review modal's conflict
section shows e.g. **"⚠️ Conflict overridden by Jane Doe on Jun 25 — reason: …"** so anyone
reviewing either event sees why the double-book was allowed.

Frontend: the approver hard-conflict path currently shows no override affordance (it was
`canForce: false`). We add an override control + required reason textarea to the conflict
section used by `ReviewModal` / `RoomReservationReview` / `EventReviewExperience`, following
the in-button confirmation UX standard.

A global "all active overrides" admin dashboard is a natural future add-on (out of scope here).

## Permissions

- Gate = `canApproveReservations` (approvers and admins).
- Everyone forcing a hard conflict must supply a reason (Decision 5).
- Owners / requesters still cannot force (unchanged).

## Testing (verification-first)

**Unit:**
- `pairKey` canonicalization — E↔C equals C↔E; no duplicate active edge.
- `reconcileConflictOverrides` decision for each resolution reason.

**Integration:**
- Force-publish without reason → `400 OVERRIDE_REASON_REQUIRED`.
- Force-publish with reason → success + active edge + audit entry on **both** events.
- Edit E's time away from C → edge cleared, audit "cleared" on both.
- Delete C → edge cleared on surviving event.
- E conflicts with C1 + C2, resolve only C1 → C1 edge cleared, C2 edge survives.
- Counterpart's own publish/restore re-check clears a now-stale edge.

## Out of Scope

- Global admin "all active overrides" dashboard.
- Surfacing override reasons in requester-facing emails.
- Changing soft-conflict (pending-edit) behavior.
