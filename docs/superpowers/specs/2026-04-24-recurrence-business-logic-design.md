# Recurrence Business Logic — North Star Spec

**Date:** 2026-04-24
**Purpose:** Define the business logic of recurring events in the Temple Emanuel calendar app across the three user roles (Viewer, Requester, Admin/Approver), independent of current implementation. This document is the authority — any code disagreeing with it is a bug.
**Scope:** Lifecycle + scope rules (create, view, edit, delete, approve/reject/resubmit). Pattern math, timezone handling, and Graph API wire format are out of scope (they are implementation concerns handled downstream).
**Consumers:** Engineers reviewing recurrence code, auditors verifying behavior across entry points, PRs touching recurrence logic.

---

## 1. Vocabulary

| Term | Definition |
|---|---|
| **Series master** | Document with `eventType: 'seriesMaster'`. Holds `recurrence: { pattern, range, additions[], exclusions[] }`. Source of truth for the series rule. |
| **Exception document** | Document with `eventType: 'exception'`. A modified occurrence. Linked to its master by `seriesMasterEventId`. Its `occurrenceDate` MUST correspond to a date the pattern would otherwise generate. |
| **Addition document** | Document with `eventType: 'addition'`. An ad-hoc date NOT in the pattern. Linked to its master by `seriesMasterEventId`. Its `occurrenceDate` MUST NOT correspond to a date the pattern generates. |
| **Virtual occurrence** | Not a document. Materialized at read time from master + pattern. Exists on dates that are in the pattern AND are not covered by an exception or addition AND are not in `exclusions`. |
| **Exclusion** | A YYYY-MM-DD entry in `master.recurrence.exclusions[]`. A date the pattern would generate but is suppressed. |
| **Scope** | `'thisEvent'` (one date) or `'allEvents'` (the master and all its children). `'thisAndFollowing'` is NOT supported. |
| **Effective role** | The role returned by `usePermissions()` — honors role simulation. All rules in this document apply to effective role, not actual role. |

---

## 2. Invariants

These must hold at all times. Audit checks should verify each invariant has enforcement.

| # | Invariant | Enforced by |
|---|---|---|
| I-1 | Every exception document's `occurrenceDate` is a date the master pattern currently generates (before exclusions). | Backend write path + pattern-change handler |
| I-2 | Every addition document's `occurrenceDate` is NOT a date the master pattern currently generates. | Backend write path + pattern-change handler |
| I-3 | A date is represented by AT MOST ONE of: exception doc, addition doc, virtual occurrence. Never two. Never an exclusion AND an exception. | Read-time expansion + delete/exclude paths |
| I-4 | An exception or addition doc's `startDate` equals its `endDate` equals its `occurrenceDate`. Occurrence date cannot be moved. | `DATE_IMMUTABLE` server guard (existing) |
| I-5 | Soft-delete is cascaded: deleting the master soft-deletes all its children; no child may have `isDeleted: false` if its master has `isDeleted: true`. | Delete endpoints + read filters |
| I-6 | Status is cascaded: all children share their master's status at all times. No child may be `pending` if master is `published`. | Publish/reject/resubmit endpoints |

---

## 3. Roles

Three roles resolved from `effectivePermissions`. A user with a `department` assignment gets **additional** field-level edit rights on other users' events — called out explicitly below.

| Role | Core flags | Plain English |
|---|---|---|
| **Viewer** | `canViewCalendar: true`, others false | Read-only |
| **Requester** | `canSubmitReservation: true`, may have `department` + `departmentEditableFields[]` | Own events: full lifecycle. Others' events: department-editable fields only on `thisEvent` scope. |
| **Admin/Approver** | `canEditEvents: true` and/or `canApproveReservations: true` | Any event, any status, any scope. Can force-override scheduling conflicts on publish. |

**Ownership** is determined by `roomReservationData.requestedBy.email === effectiveUserEmail`. NEVER use top-level fields for ownership checks.

---

## 4. VIEW — what each role sees

All expansion goes through a single read layer: master + non-deleted exceptions + non-deleted additions - soft-deleted dates - exclusions. Virtual occurrences are generated for pattern dates not covered by any of the above.

| Role | Sees |
|---|---|
| Viewer | Published events only. |
| Requester | Published + own drafts + own pending + own rejected. |
| Admin/Approver | All except soft-deleted (unless explicitly browsing the Deleted tab). |

### Rules

- **V-1**: A virtual occurrence MUST NOT render on a date where an exception, addition, or exclusion is active. Enforced by the expansion layer. Any leak is a bug.
- **V-2**: Clicking an occurrence opens the review modal with THAT occurrence's resolved date (exception's date if overridden, else the clicked pattern date). Master's `startDate` is never shown as the occurrence's date.
- **V-3**: Clicking "All Events" from the scope dialog opens the master with the series range in the read-only date inputs — not the clicked date.

(V-2 and V-3 are already specced in `openspec/specs/recurring-event-dates/spec.md` and remain authoritative there.)

---

## 5. CREATE

### Viewer
- Cannot create. No recurrence tab, no create button.

### Requester
- Creates a recurring event as draft or direct-to-pending.
- Recurrence tab exposes: pattern `type`, `interval`, `daysOfWeek` (for weekly), `dayOfMonth` (for monthly), `month`+`dayOfMonth` (for yearly), range `type` (`endDate`/`numbered`/`noEnd`) with corresponding fields, and editable `additions[]` / `exclusions[]`.
- May add per-occurrence overrides before save; on save, overrides become exception documents linked to the new master.
- Submit goes to `pending`. Never auto-publishes.

### Admin/Approver
- Same controls as Requester, with two differences:
  1. Submit auto-publishes (skips `pending`) — consistent with single-event creation.
  2. May force-override scheduling conflicts with `forcePublish: true`. Requesters cannot.

### Rules

- **C-1**: At create time, the persisted fields `master.startDate`, `master.endDate`, and `master.recurrence.range.startDate` MUST all equal the date of the first occurrence. Backend normalizes if given divergent values. This rule is about database state at create time only; the UI's read-time display transform (showing `recurrence.range` in the read-only inputs for a series master) is governed by the existing `openspec/specs/recurring-event-dates/spec.md` and is unaffected.
- **C-2**: `additions[]` entries whose date falls inside the pattern are silently dropped at create time (not errors). See I-2.
- **C-3**: `exclusions[]` entries whose date does not fall inside the pattern are silently dropped (they are a no-op).
- **C-4**: Creating a recurring event with an empty pattern (no `daysOfWeek` for weekly, etc.) is an error (HTTP 400). Pattern must generate at least one occurrence within range.

---

## 6. EDIT

### 6.1 Scope dialog rule (all entry points)

- **E-0**: Any edit action on a recurring event from any entry point (Calendar, MyReservations, ReservationRequests, EventManagement) MUST present the scope dialog unless the user clicked the series master with no displayed occurrences (in which case default to `allEvents`). The scope choice is user-initiated; never inferred. **Current state**: only Calendar implements this dialog — remediate.

### 6.2 What each scope can mutate

| Field group | `thisEvent` | `allEvents` |
|---|---|---|
| Title, description, categories, services, assignments | ✓ | ✓ |
| Time-of-day (startTime, endTime, setup, teardown, door open/close) | ✓ | ✓ |
| Locations | ✓ | ✓ |
| `startDate`, `endDate` | ✗ (I-4) | ✗ (master date derives from pattern range) |
| `recurrence.pattern`, `recurrence.range` | ✗ | ✓ |
| `recurrence.additions`, `recurrence.exclusions` | ✗ | ✓ |

- `thisEvent` creates or updates an exception document.
- `allEvents` updates the master (and may cascade — see 6.4).

### 6.3 Per role

**Viewer**: Cannot edit. Recurrence tab renders read-only summary.

**Requester**:
- Own draft / pending / rejected series: both scopes available, all controls.
- Own published series: direct edit NOT allowed. Must use **edit-request flow** (changes stored in `master.pendingEditRequest`, awaiting approval). See Rule A-2 for the cascade rule.
- Others' events (with `department` assignment, any status): ONLY `thisEvent` scope, ONLY fields listed in `departmentEditableFields`. Cannot touch pattern, range, additions, or exclusions. A department-field edit on an occurrence DOES create or update the underlying exception document (that is the storage mechanism for thisEvent-scope changes), but the department requester cannot see or modify any non-department fields on that exception.

**Admin/Approver**: Any event, any status, any scope. No force override needed for edits (that's publish-only).

### 6.4 Pattern/range changes — orphan handling

When an `allEvents`-scope edit changes pattern or range such that some exceptions no longer match:

- **E-1**: Any exception document whose `occurrenceDate` is no longer a valid pattern date (after the change) MUST be soft-deleted. These are "orphans" and violate I-1.
- **E-2**: Any addition document whose `occurrenceDate` now IS a valid pattern date (after the change) MUST be soft-deleted. These are "redundant" and violate I-2. (Note: preserving an addition's customizations by converting it to an exception is explicitly out of scope — the rule is delete, consistent with E-1's destructive semantics.)
- **E-3**: The UI MUST warn the user before applying a pattern/range change that would orphan exceptions or redundantify additions. The warning states how many docs would be affected AND their dates, and lets the user cancel. After confirmation, the cascade (E-1 + E-2 + master update) runs atomically.
- **E-4**: When an `allEvents`-scope edit changes a published master's pattern, Graph API sync MUST reconcile: update the Graph master's recurrence, delete orphaned Graph exception events, and upsert any new exceptions/additions. A partial Graph sync is a bug.

### 6.5 Past occurrences

- **E-5**: Past dates are editable by any role who can edit the event. No temporal restriction. Historical edits are legitimate (corrections, retroactive notes).

---

## 7. DELETE

### 7.1 Scope applies here too

- **DL-0**: Same scope dialog rule as edit (E-0). Any delete action on a recurring event must prompt for `thisEvent` vs `allEvents`.

### 7.2 thisEvent delete = always add exclusion

- **DL-1**: Deleting a single occurrence (thisEvent scope) ALWAYS:
  1. Adds the occurrence date to `master.recurrence.exclusions[]` (idempotent — no-op if already there).
  2. If an exception document exists for that date, soft-deletes it.
  3. If an addition document exists for that date, soft-deletes it.
  - All three steps are atomic with respect to each other.
- **DL-2**: This guarantees I-3 and ensures the virtual occurrence does not re-materialize on the next read.

### 7.3 allEvents delete = cascade

- **DL-3**: Deleting the master (allEvents scope) soft-deletes the master AND cascade-soft-deletes all exception and addition children in one transaction.
- **DL-4**: Deleting the master does NOT modify `exclusions[]`. Restore logic (DL-6) depends on this.

### 7.4 Per role

**Viewer**: Cannot delete.

**Requester**:
- Own pending series, `thisEvent`: allowed. Adds exclusion per DL-1.
- Own pending series, `allEvents`: allowed. Withdraws the entire request. Notification emails sent to reviewers.
- Own published series: NOT allowed directly. Must use cancel-request workflow (admin intervention).
- Own rejected / draft series: same as pending.
- Others' events: not allowed.

**Admin/Approver**:
- Any series, any scope, any status.

### 7.5 Restore

- **DL-5**: Restoring a master soft-deleted at `allEvents` scope undoes the master's soft-delete AND undoes the cascade on all children. Children return to the status they held immediately before the delete (tracked via `statusHistory[]`).
- **DL-6**: Restoring a master does NOT remove entries from `exclusions[]`. Exclusions added BEFORE the delete stay excluded.
- **DL-7**: There is no UI to restore a single occurrence that was deleted via `thisEvent` scope. Restoring would require removing the exclusion and undeleting the exception doc — out of scope for V1. If needed later, specify separately.

### 7.6 Idempotency

- **DL-8**: Deleting an already-deleted document returns `200` with a no-op indicator, not `409`. Users should never see an error for re-deleting.

---

## 8. APPROVE / REJECT / RESUBMIT

### 8.1 Series as atomic unit

- **A-1**: A recurring series is approved or rejected AS A WHOLE. No per-occurrence approval or rejection. If an admin wants some occurrences but not others, they either:
  - (a) reject the series and ask the requester to resubmit with correct `exclusions`, OR
  - (b) approve the series, then delete the unwanted occurrences via `thisEvent`-scope delete (which adds them to `exclusions` per DL-1).

### 8.2 Approve (publish)

- **A-P1**: `PUT /api/admin/events/:id/publish` on the master transitions master + all non-deleted exception/addition children to `published` in one cascading operation.
- **A-P2**: Graph API sync creates ONE Graph event for the master (with recurrence pattern) plus ONE Graph event per exception and per addition. If any Graph call fails, the server returns `5xx` and the status transition is rolled back (no partial published state).
- **A-P3**: Scheduling conflict detection runs against the fully expanded series (pattern + additions - exclusions, with exception times applied). Admin may force-override with `forcePublish: true`.

### 8.3 Reject

- **A-R1**: `PUT /api/admin/events/:id/reject` on the master transitions master + all non-deleted children to `rejected` in one cascading operation (fixed in commit `644f7e6`).
- **A-R2**: Rejection reason stored on master in `roomReservationData.reviewNotes`. Displayed as a banner when the requester opens the event.
- **A-R3**: Children do not carry their own rejection reason. The series' reason applies to the whole.

### 8.4 Resubmit

- **A-S1**: Only the requester of a rejected event can resubmit. Approvers cannot.
- **A-S2**: Resubmit transitions master + all non-deleted children back to `pending` in one cascade, clears `reviewedAt` / `reviewedBy`, and pushes a `resubmit` entry to each doc's `statusHistory[]`.
- **A-S3**: Resubmit-with-edits uses `PUT /api/room-reservations/:id/edit` (master-scope only — see A-2 below) followed by a status flip. No per-occurrence resubmit.

### 8.5 Edit requests on published series

- **A-2**: Edit requests target the MASTER ONLY. Exception documents cannot have their own edit requests. Rationale:
  1. The series is the unit of approval (A-1). Requesters propose changes to the rule, not to individual dates.
  2. Per-occurrence edit requests would create a combinatorial approval queue that admins would have to reason about all at once — violates A-1's atomic principle.
- **A-2.1**: A requester's edit request on a published series may propose changes to: master fields (title, description, location, categories, services, etc.), `recurrence.pattern`, `recurrence.range`, `recurrence.additions`, `recurrence.exclusions`. It MUST NOT propose per-occurrence overrides; the UI must hide the exceptions panel in edit-request mode.
- **A-2.2**: If an admin needs to modify a single occurrence of a published series, they direct-edit the exception via `thisEvent` scope. This is an admin-only path.
- **A-2.3**: When an edit request is approved, the master is updated. The orphan-cascade rules (E-1, E-2) apply — the approval may delete exception/addition docs if the new pattern makes them invalid. The admin sees the orphan warning before approval.

---

## 9. Graph API sync (brief)

Graph sync is an implementation detail; full spec is out of scope. Three rules that the lifecycle depends on:

- **G-1**: Only events with `graphData.id` are live on Graph. Drafts / pending do not sync.
- **G-2**: A series master with recurrence creates ONE Graph event with `recurrence`. Each exception and addition creates a SEPARATE Graph event that overrides or adds to the series.
- **G-3**: Any lifecycle operation that changes pattern/range on a published series MUST reconcile Graph: update the master's recurrence, delete orphaned Graph exceptions (per E-1), upsert remaining children. Partial Graph sync is a bug (ties back to A-P2).

---

## 10. Audit targets (for the follow-up audit plan)

Each of the rules above translates to a concrete code check. Priority candidates for the first audit pass:

| Area | Expected finding |
|---|---|
| DL-1 (always add exclusion) | `DELETE /api/admin/events/:id` does not update `recurrence.exclusions` when soft-deleting an exception. Must be fixed. |
| DL-1 frontend (`RecurrenceTabContent.handleRemoveOverride`) | Does not add exclusion when removing a pattern occurrence. Must be fixed. |
| E-0 / DL-0 (scope dialog everywhere) | `RecurringScopeDialog` only wired in Calendar.jsx. Missing from MyReservations, ReservationRequests, EventManagement. Must be unified (likely via `EventReviewExperience`). |
| E-1 / E-2 (orphan cascade) | No code path currently deletes orphaned exceptions on pattern change. Must be added to master-update handler. |
| E-3 (orphan warning UI) | Not implemented. Needs design + wiring. |
| E-4 (Graph reconcile on pattern change) | Thin coverage. Needs explicit walk of master-update path. |
| A-2.1 (edit-request cannot propose per-occurrence changes) | UI state of edit-request mode does not currently hide the exceptions panel. Verify. |
| A-2.3 (orphan warning on edit-request approval) | Same as E-3 — not implemented. |
| A-P2 (Graph failure rolls back status) | Verify transaction boundary. Current state likely has partial-commit windows. |
| DL-8 (idempotent re-delete) | Currently returns `409` via OCC. Needs explicit no-op path. |
| V-1 (virtual occurrence leak) | Verify expansion layer de-dups against exceptions, additions, AND exclusions. |
| I-6 (status cascade) | Confirm all status transitions cascade (publish: done; reject: done since `644f7e6`; resubmit: verify; restore: verify). |

---

## 11. Out of scope (for this spec)

- Pattern arithmetic (DST, timezone, interval math) — handled in `recurrenceUtils.js` / `recurrenceExpansion.js`. That code is considered correct for the purposes of this spec; bugs there are addressed separately.
- Timezone storage / display — handled by the datetime architecture spec.
- `thisAndFollowing` scope — explicitly not supported. Do not add without a new spec.
- Per-occurrence approval / rejection — explicitly not supported (A-1).
- Per-occurrence edit requests — explicitly not supported (A-2).
- Single-occurrence restore UI — out of scope for V1 (DL-7).

---

## 12. Revision history

| Date | Change |
|---|---|
| 2026-04-24 | Initial spec. Decisions locked: D-0 = always add exclusion; E-1 = delete orphans (with warning); A-2 = edit requests master-only, never on exceptions; A-1 = series-atomic approval. |
