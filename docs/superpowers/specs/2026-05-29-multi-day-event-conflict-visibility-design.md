# Multi-Day Event Conflict Visibility — Design

**Date:** 2026-05-29
**Branch:** `feat/multiday-event-conflict-visibility`
**Origin:** Bug report from Mark. John set an event's End Date 10 days after the Event Date by accident, couldn't save ("there's a conflict"), and couldn't tell why — the Scheduling Assistant preview showed no conflicts because it only renders the start day.

## Problem

Two distinct, correctly-built components with mismatched scopes:

1. **No multi-day signal.** "Event Date" and "End Date" are two identical native date inputs (`RoomReservationFormBase.jsx:1842-1883`, via `DatePickerInput.jsx`). A 10-day span looks identical to a same-day event. The day-count is already computed for the duplicate-event feature (`eventTransformers.js:490-499`) but never surfaced in the form.

2. **Preview vs. save disagree.** The Scheduling Assistant only ever renders/checks the **start day**: the form passes `selectedDate={formData.startDate}` and no end date (`RoomReservationFormBase.jsx:2344`); the availability fetch queries one day (`checkDayAvailability`, `RoomReservationFormBase.jsx:907-1016`, effect dep is `formData.startDate` only); the timeline clamps multi-day events to the viewed day (`SchedulingAssistant.jsx:218-226`); the verdict counts conflicts for that one day (`SchedulingAssistant.jsx:600-647`). But on save, backend `checkRoomConflicts()` checks the **full span** (`api-server.js:2572-2649, 2776-2798`) and returns 409. So the preview truthfully says "no conflicts" for the start day while save fails on a later-day conflict the user can't see.

## Decisions (from brainstorming)

- **Scope:** full fix — multi-day indicator + honest full-span verdict + clearer conflict info.
- **Simplest, minimal UI clutter.** Bias every choice toward least code and least visual noise.
- **Must scale to very long spans (e.g. 6 months).** No multi-day timeline, no day-by-day stepper. The verdict is a **summary** capped/truncated for long spans.
- **Save policy: Warn + "Save Anyway" for staff.** Approvers/admins get a confirm showing the conflict and can proceed; guest/public reservation path stays hard-blocked. Requester (owner-edit) path stays blocked. Reuses the existing soft-conflict acknowledgment dialog.

## Design

### Part 1 — Multi-day date-field indicator
- New shared util `src/utils/dateSpanUtils.js`:
  - `computeEventSpanDays(startDate, endDate) -> number` (same-day = 0; empty/null = 0). Uses the `new Date(str + 'T00:00:00')` local-midnight pattern from `eventTransformers.js:494-497` (no UTC shift).
  - `formatDateSpanLabel(startDate, endDate) -> string | null` (null for same-day; else `Jun 18 – Jun 28 · 10 days`; spans > ~30 days append a muted `(long multi-day event)` note).
- `eventTransformers.js` migrates its inline computation to import `computeEventSpanDays` (behavior-preserving).
- Render a quiet `.multiday-span-indicator` line immediately after the `.date-attendees-row` grid (`RoomReservationFormBase.jsx:~1906`), full-width below the row (not inside the grid). Derived inline from `formData.startDate/endDate`; no new state.
- CSS in `RoomReservationForm.css`: 12px, secondary text color, no icon. Move the row's `margin-bottom` onto the indicator so spacing stays clean. Coordinate with the existing occurrence date-lock hint div at `RoomReservationFormBase.jsx:~1908` (it already occupies that slot with `marginTop:-8px; marginBottom:12px`) so the two don't collide.

### Part 2 — Full-span conflict verdict via backend dry-run (REVISED x2 during implementation)
**Discovery:** the timeline verdict (`onConflictChange`, `SchedulingAssistant.jsx:600-685`) is computed from `dedupedBlocks`, and `buildBlockFromStrings` (`:218-226`) drops events outside the start day BEFORE counting. The count is single-day **by construction** — widening the availability fetch would NOT make it honest (other-day events are discarded first). A frontend full-span recompute was rejected: it would duplicate the backend's overlap + concurrent-category rules and risk false positives.

**Initial approach (A), shipped then superseded:** scope-honest labeling only — `isMultiDaySpan` prop scoping the badge to "on start day" plus a note ("shows the start day only; all days checked on save"). Real-app testing (multi-day draft + a conflict on a MIDDLE day) showed this is insufficient: the user needs the conflict shown IN ADVANCE, not merely disclosed at save.

**Final approach (B) — live full-span verdict via a backend dry-run (guarantees preview === save):**
- New read-only `GET /api/rooms/conflict-check` runs the EXACT `checkRoomConflicts` every save path uses, for the proposed (unsaved) event window. One source of truth → no drift, no false positives. Returns `{ hardConflicts, softConflicts }` (hardConflicts already carry `eventTitle`/`startDateTime`/`locationDisplayNames` from Part 3).
- Form: debounced `checkSpanConflicts` fires for multi-day events (rooms + dates + times set), mirroring the save's `reservationForConflict` literal; result in `spanConflicts` state, passed to `SchedulingAssistant` (`spanConflicts`, `spanConflictsLoading`).
- `SchedulingAssistant`: renders the full-span verdict — real conflicts (`room · day — title`, capped at 3 + "more") in red, "No conflicts across any day" in green, or "Checking all days…". The start-day-only scope note (A) remains only as the pre-resolution fallback. Badge "on start day" scoping retained (still accurate); timeline still draws the start day only (correct for long spans).
- Part 3 also fixed the **5th** conflict-message site (draft submit, `useReviewModal.jsx:~1997`) to use `buildConflictErrorMessage`.

**Still deferred:** recurring-event full-span preview (recurring uses `checkRecurringRoomConflicts`; out of this endpoint's scope — `isMultiDaySpan` is false for recurring).

### Part 3 — Clearer conflict info (message, not a wall)
- Backend: the 409 already includes `hardConflicts[n].eventTitle` and `.startDateTime`; it's missing the room **name**. `CONFLICT_PROJECTION` (`api-server.js:2472`) **already projects** `calendarData.locationDisplayNames` — do **not** touch the projection (no-op). The real gap: `publishedConflictResults.map()` (`api-server.js:~2964`) fetches the field but **discards** it — add a normalized room-name field to the emitted conflict object there. Note `locationDisplayNames` may be a **string or an array** (normalized elsewhere at `:3205,:3225`).
- Frontend: a `buildConflictErrorMessage(conflicts)` helper in `useReviewModal.jsx` replaces the flat "N conflicts" string at the three construction points (~711, ~851, ~960). Example: `Sanctuary is booked Jun 25 (Shabbat Service). Adjust dates or rooms.` 3+: `3 conflicts (Sanctuary Jun 25, Chapel Jun 28, +1 more).` Helper must accept `locationDisplayNames` as string-or-array. Caveat: `conflict.startDateTime` is the **conflicting event's own start**, not the overlapping day within our span — exact for same-day conflicts; for a multi-day conflicting event it shows that event's start date.

### Part 4 — Save policy: Warn + "Save Anyway" for staff
**Review-corrected.** John's scenario (staff editing a PUBLISHED event) saves via `handleSave` → **`PUT /api/admin/events/:id`** (`useReviewModal.jsx:597`; conflict check ~`api-server.js:24273`). That is the path that must gain approver "Save Anyway". `PUT /api/edit-requests/:id/approve` (`:22917`) is a *different* flow (reviewing a pending EditRequest), NOT John's path — the earlier `publish-edit` route does not exist.

Conflict-check call sites and current behavior (`api-server.js`):

| Call site | Endpoint | Entry role | Force flag | Force gated to admin |
|-----------|----------|------------|------------|----------------------|
| 15999 | `POST /room-reservations/draft/:id/submit` | requester | — | blocked |
| 16393 | `PUT /room-reservations/:id/restore` | requester | — | blocked |
| 16653 | `PUT /admin/events/:id/restore` | admin | `forceRestore` | admin |
| 17658 | `PUT /room-reservations/:id/edit` | owner | — | blocked |
| ~21068 | `PUT /admin/events/:id/publish` | approver+ | `forcePublish` | admin only (gate ~21005) |
| ~22917 | `PUT /api/edit-requests/:id/approve` | approver+ | `forcePublishEdit` | admin only (gate ~22937) — different flow |
| ~24273 | `PUT /api/admin/events/:id` | approver+ | `forceUpdate` | admin only (gate ~23921) |

(`:12579` rsSched importer also calls `checkRoomConflicts` — background, not user-facing, untouched.)

- **Two-gate bug to fix:** `PUT /api/admin/events/:id` already returns `canForce: true, forceField: 'forceUpdate'` to approvers (`:24282`), but `:23921` then rejects the force: `if (updates.forceUpdate && effectiveRole !== 'admin') → 403`. An approver who clicks "Save Anyway" gets a 403. **Fix:** widen `:23921` from `effectiveRole !== 'admin'` to `!hasApproverAccess` (`hasApproverAccess` is already in scope — it gates entry at `:23911`).
- **Scope (recommended, minimal):** apply the approver-force widening to **`PUT /api/admin/events/:id` only** — it covers John's case. Leave **publish** (`:21005`) admin-only unless we explicitly decide approvers may force-publish pending events (separate policy call; default = leave as-is).
- **"Save Anyway" is NET-NEW UI, not a reuse.** No component reads `canForce` from `handleSave`'s return (`useReviewModal.jsx:712-713`) today; the only force UI is `EventManagement.jsx:990` (admin restore), separate from the modal. Build a hard-conflict force-retry affordance in the review modal modeled on the existing **soft-conflict** state-dialog (`setSoftConflictConfirmation`), which resends with `forceUpdate: true`. It is a state-driven dialog — an accepted exception to the two-click in-button confirm standard (as soft-conflict already is); call this out rather than asserting blind reuse.
- **Stays hard-blocked:** guest/public submission and the requester paths (owner-edit `:17658`, owner-restore `:16393`, draft submit `:15999`). The `!hasApproverAccess` predicate must not leak force into these.

## Files

**Create**
- `src/utils/dateSpanUtils.js`
- `src/__tests__/unit/utils/dateSpanUtils.test.js` (Vitest)
- `src/__tests__/unit/components/SchedulingAssistant.multiDayScope.test.jsx` (Vitest)

**Modify**
- `src/utils/eventTransformers.js` — use shared `computeEventSpanDays`
- `src/components/RoomReservationFormBase.jsx` — indicator render; pass `isMultiDaySpan` to SchedulingAssistant (Part 2 needs no fetch/dedup changes)
- `src/components/SchedulingAssistant.jsx` — `isMultiDaySpan` prop; scope-honest verdict badge + always-visible scope note
- `src/components/SchedulingAssistant.css` — `.sa-multiday-scope-note`
- `src/components/RoomReservationForm.css` — `.multiday-span-indicator` (mirrors occurrence-hint spacing; no date-row margin change)
- `backend/api-server.js` — `publishedConflictResults.map()` (~2964): emit normalized room name (projection already has the field); Part 4: widen `forceUpdate` gate at `:23921` to `!hasApproverAccess`
- `src/hooks/useReviewModal.jsx` (+ review-modal component) — `buildConflictErrorMessage`; net-new "Save Anyway" force-retry dialog for staff hard-conflict 409s (modeled on the soft-conflict state dialog)

## Build sequence
1. **Shared helper + indicator** (no backend, no risk): `dateSpanUtils.js` + tests; migrate `eventTransformers.js`; CSS; render indicator.
2. **Honest start-day scope** (revised — no fetch change): `isMultiDaySpan` prop → scope-honest verdict badge + always-visible scope note in SchedulingAssistant. See Part 2 note.
3. **Clearer conflict info**: emit normalized room name in `publishedConflictResults.map()` (projection already has it); `buildConflictErrorMessage` (handle string|array). Backend Jest asserting the room name appears in the 409.
4. **Save policy (Warn + Save Anyway, staff)**: widen `:23921` `forceUpdate` gate to `!hasApproverAccess` (admin-save path only); build net-new "Save Anyway" dialog wired to `canForce`/`forceField`, resending with `forceUpdate: true`. Backend Jest: approver force succeeds on `PUT /api/admin/events/:id`; requester/guest force still 403/blocked.

## Testing
- Vitest: `dateSpanUtils` (same-day=0, 1-day, 10-day, 180-day, leap-year, cross-year, null/empty/reversed); `SchedulingAssistant.multiDayScope` (note shown when multi-day; hidden single-day / no rooms).
- Jest (MongoDB Memory Server): 409 conflict payload emits a room name; approver `forceUpdate` succeeds on `PUT /api/admin/events/:id` while requester/guest force stays 403/blocked.
- Per CLAUDE.md: run only the touched test files, not the full suite.

## Timezone safety
All datetime strings stay local-time (`...T00:00:00` / `...T23:59:59`), **no Z suffix**, matching the existing backend convention. `computeEventSpanDays` uses local-midnight parsing.

## Out of scope (explicitly rejected)
- Full multi-day timeline / horizontal strip / stacked day rows (breaks for long spans).
- Day-by-day stepper as the primary mechanism (impractical for 6-month spans).
- Fully non-blocking save for all users (removes double-booking protection for guests/requesters).
- Blocking or warning on the mere existence of a multi-day event (multi-day events are legitimate; we make them visible, not forbidden).

## Review log
- **2026-05-29 — code-architecture-reviewer pass.** Corrections folded in: Part 3 — `CONFLICT_PROJECTION` already has `locationDisplayNames`; fix the `publishedConflictResults.map()` (it discards the field), handle string|array. Part 2 — must add an `endDate` slot to `lastFetchParamsRef` or the dedup guard suppresses the refetch. Part 4 — John's path is `PUT /api/admin/events/:id` (not the nonexistent `publish-edit`); two-gate force bug at `:23921` to widen to `!hasApproverAccess`; "Save Anyway" is net-new UI, not a reuse. Verified solid: most file:line refs, no OCC/SSE/status-machine impact.
- **2026-05-29 — Part 2 re-planned during implementation.** Found the verdict is single-day **by construction** (`buildBlockFromStrings` drops other-day events before counting), so widening the fetch can't make it honest, and a frontend full-span recompute would duplicate backend overlap/concurrency and risk false positives. Switched to approach (A): scope-honest labeling (`isMultiDaySpan` → "on start day" verdict + always-visible scope note); no fetch/dedup changes. Authoritative full-span detail deferred to Parts 3+4; live pre-warning (B) deferred.
- **2026-05-29 — Parts 1-3 implemented + committed** (ship-and-revert batch): span indicator, start-day-honest verdict, and room+day conflict messages. 14 + 3 + 8 new tests pass; existing suites green; production build clean. **Part 4 (Warn + Save Anyway for staff) deferred to its own focused pass** per the agreed plan. Pre-existing (not ours): 3 `eventTransformers.test.js` failures fail identically on clean HEAD.
- **2026-05-29 — Part 2 pivoted to live verdict (B) after a real-app test.** Scope-honest note (A) didn't satisfy the need — a multi-day draft with a conflict on a MIDDLE day stayed silent in the assistant until the 409. Added read-only `GET /api/rooms/conflict-check` (dry-run of `checkRoomConflicts`) + wired form/assistant to show the real full-span verdict (room · day — title / all-clear / checking). Preview === save (same function). Also fixed the draft-submit 409 message (5th site). 6 assistant tests + build green. **Backend endpoint lacks an integration test (testApp legacy); needs live verification** with the multi-day + middle-day-conflict scenario.
