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
  so the set of events to annotate is known. **Caveat:** when the counterpart is a
  `seriesMaster`, that `_id` is the master's, and its `calendarData.startDateTime/endDateTime`
  hold the *series span* (potentially multi-year), not a single occurrence window — see the
  auto-clear section for why this forbids naive geometric re-checking.
- **Four** force-bypass flags exist today, all silent admin-only (no reason, no audit, no edge):
  | Flag | Endpoint | Admin gate | Bypass site |
  |---|---|---|---|
  | `forcePublish` | publish | api-server.js:21525 | 21555 |
  | `forceUpdate` | admin update (single + recurring) | 24470 | 24774 |
  | `forcePublishEdit` | publishEdit | 23448 | 23501 |
  | `forceRestore` | admin restore | endpoint-admin @16778 | 16806 |
  The publish 409 at `api-server.js:21597` returns `canForce: true` **unconditionally**, but the
  force-retry is admin-gated at 21525 — so an approver sees a forceable conflict and then hits
  403, a dead-end. Owner restore/save paths have no bypass and correctly stay `canForce: false`.
  This feature **unifies all four flags** into one `forceConflicts` + `overrideReason` body
  contract routed through a single shared override helper (Decision 7).
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
| 5 | **Reason required for everyone** — approvers AND admins. No silent hard-conflict overrides. (Tightens today's four silent admin force bypasses.) |
| 6 | **Soft conflicts unchanged** — keep the advisory `acknowledgeSoftConflicts` flow, no reason. |
| 7 | **Unify the four force flags** (`forcePublish`/`forceUpdate`/`forcePublishEdit`/`forceRestore`) into one `forceConflicts` + `overrideReason` body contract, routed through a single shared override helper. Removes the approver publish dead-end. |
| 8 | **Auto-clear re-uses `checkRoomConflicts`**, never re-implements overlap geometry — so series-master spans, recurring expansion, exception suppression, and category-concurrent exemptions are all handled identically to detection. |
| 9 | **Edge + audit writes are best-effort**, not transactional. A post-operation failure leaves the override applied without a trace (consistent with the swallow-and-log audit contract). Not "permanent" — see Risks. |
| 10 | **Re-override replaces in place.** Re-forcing an already-active pair updates `reason`/`overriddenBy`/`overriddenAt` on the existing edge and writes a fresh audit entry on both events. |

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
  context: 'publish' | 'publishEdit' | 'adminSave' | 'restore', // which force path created it
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

## Centralization (the unified force helper)

Today the four force flags are threaded independently across ~5 endpoints (publish, admin
update single + recurring, publishEdit, admin restore). The review flagged duplicating the
new override logic across them as a maintenance hazard. Instead:

- **One shared helper** owns the override branch: given `(event, hardConflicts, { forceConflicts, overrideReason, actor, context })`
  it enforces the reason gate, upserts edges, and writes audits — returning a normalized
  decision (`proceed` | `409 payload`). Every call site delegates to it.
- **One body contract** everywhere: `forceConflicts: boolean` + `overrideReason: string`. The
  legacy `forcePublish`/`forceUpdate`/`forcePublishEdit`/`forceRestore` flags are migrated to
  it. (Back-compat: accept the old flag as an alias for `forceConflicts` for one release if any
  caller/test still sends it, but require `overrideReason` regardless.)

## Override Flow (write path)

At each hard-conflict check site, the shared helper applies:

- **If `forceConflicts` AND caller has `canApproveReservations`:**
  1. Require non-empty trimmed `overrideReason` → else `400 OVERRIDE_REASON_REQUIRED`.
     (Server-side gate; UI validation is not trusted.)
  2. Perform the operation (publish/save/restore) as normal.
  3. For **each** hard-conflict counterpart `Cn`: upsert an `active` edge `{E, Cn}` with the
     single shared reason (canonical `pairKey`, idempotent on the partial-unique index). If an
     active edge already exists, **replace** `reason`/`overriddenBy`/`overriddenAt` in place
     (Decision 10).
  4. Write append-only audit entries to **both** E's and Cn's audit history via
     `auditService.recordEvent`, metadata `{ action: 'conflict_override', counterpartEventId, reason }`.
     These writes are **best-effort** (swallow-and-log) — see Risks.
- **Else** (no force, or caller lacks `canApproveReservations`): return the 409 with
  `canForce: true, forceField: 'forceConflicts', requiresReason: true`. The publish path's
  current unconditional `canForce: true` + admin-only retry (the approver dead-end at
  api-server.js:21525/21597) is replaced by this unified branch.

Soft conflicts: unchanged.

## Auto-Clear (resolution path)

Shared helper `clearStaleConflictEdges(eventId, actor)` (renamed from `reconcileConflictOverrides`
to avoid colliding with the existing `reconcileOccurrenceOverrides` in `exceptionDocumentService.js`):

1. Load all `active` edges containing `eventId`.
2. For each edge, decide "does a hard conflict still exist?" **by calling
   `checkRoomConflicts(eventE, counterpartId)` and checking whether `counterpartId` still
   appears in the returned `hardConflicts`** — NOT by re-implementing overlap geometry.
   - Either event no longer `published` → counterpart drops out of `hardConflicts` → resolved (`event_removed`).
   - Time/room/setup edit removes the overlap → drops out → resolved (`time_room_edit`).
   - Re-check trigger from the counterpart's own publish/restore → resolved (`recheck`).
   This is mandatory because: (a) a `seriesMaster` counterpart's stored date range is the
   *series span*, so naive geometry would match any event in a multi-year window and never
   clear; and (b) `checkRoomConflicts` applies category-concurrent exemptions
   (`isAllowedConcurrent`/`allowedConcurrentCategories`) that geometry alone would miss.
   Re-using it inherits recurring expansion + exception suppression for free.
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
- Force without reason → `400 OVERRIDE_REASON_REQUIRED` (every one of the four unified paths).
- Force with reason → success + active edge + audit entry on **both** events.
- Edit E's time away from C → edge cleared, audit "cleared" on both.
- Delete C → edge cleared on surviving event.
- E conflicts with C1 + C2, resolve only C1 → C1 edge cleared, C2 edge survives.
- Counterpart's own publish/restore re-check clears a now-stale edge.
- **Series-master counterpart:** override against a recurring master, then shift E off all
  occurrences → edge clears (guards the C2 "never clears" regression).
- **Category-concurrent exemption:** override, then make the pair category-exempt → edge clears.
- **Re-override:** force an already-active pair → reason replaced, second audit entry added,
  still exactly one active edge.
- **Regression guard:** existing admin force flows (`forcePublish`/`forceUpdate`/
  `forcePublishEdit`/`forceRestore`) still succeed for admins via the new contract; existing
  conflict integration tests (`publishConflict`, `editConflict`, `saveConflict`,
  `recurringConflict`, `crossCalendarConflict`, `ownerRestore`, `eventAdminRestore`) stay green.

## Risks

- **Best-effort, not atomic (Decision 9).** Operation succeeds → edge/audit write fails
  (Cosmos throttle / crash) → live double-book with no override record. Mitigation: keep edge
  upsert + audit immediately after the main write, log loudly on failure; accept the residual
  window (same guarantee as all existing audit writes). Do **not** claim "permanent."
- **Touching four existing force paths is the main blast radius.** The unification migrates
  live admin flows; the regression-guard tests above are the gate. Ship the back-compat alias
  for the legacy flags for one release.
- **Cosmos partial-unique index** on `pairKey where active:true` — supported on Cosmos Mongo
  API 4.0+, but concurrent-upsert unique-violation handling has differed from native MongoDB.
  Validate on the staging Cosmos tier, not only MongoDB Memory Server.

## Out of Scope

- Global admin "all active overrides" dashboard.
- Surfacing override reasons in requester-facing emails.
- Changing soft-conflict (pending-edit) behavior.
