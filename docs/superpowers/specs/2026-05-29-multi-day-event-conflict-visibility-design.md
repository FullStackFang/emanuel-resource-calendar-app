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

### Part 2 — Honest full-span verdict (no new endpoint)
The existing `/api/rooms/availability` endpoint (`api-server.js:14911-15014`) already queries any range correctly (incl. recurring expansion). The form just wasn't sending the end date.
- `checkDayAvailability` gains an `endDate` argument; when multi-day, the API call uses `endDateTime = ${endDate}T23:59:59` (keep local-time, **no Z suffix**). The `date` arg still drives the timeline's display day (start day).
- Add `formData.endDate` to the fetch effect dep array (`RoomReservationFormBase.jsx:~1016`) **and** to the `lastFetchParamsRef` dedup guard (init ~622, seed ~632, compare ~1002-1006). **Critical:** the dedup guard currently compares only `roomIds/date/excludeEventId`; without an `endDate` slot it silently suppresses the refetch when only the end date changes — defeating the whole fix. The abort/stale-request guards themselves are unaffected.
- `SchedulingAssistant.jsx` gains optional `endDate` and `isMultiDaySpan` props.
  - Timeline rendering unchanged — still draws the **start day only** (correct for arbitrarily long spans), with `effectiveDate` staying `selectedDate`.
  - Header note when multi-day: `Showing start day (Jun 18). Full span: Jun 18 – Jun 28.`
  - Verdict (the `sa-summary` block, `SchedulingAssistant.jsx:2217-2228`): when `isMultiDaySpan && totalConflicts > 0`, render a summarized list built from the already-present per-room conflict detail — `Sanctuary – Shabbat Service (Jun 25)` — capped at 3 with `+N more`. Room name from `selectedRooms`, date from `conflict.startDateTime.split('T')[0]`.
- `onConflictChange` contract unchanged (already emits `{ hasHardConflicts, hardConflictCount }`); counts become honest automatically once the data covers the full span.

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
- `src/__tests__/dateSpanUtils.test.js` (Vitest)

**Modify**
- `src/utils/eventTransformers.js` — use shared `computeEventSpanDays`
- `src/components/RoomReservationFormBase.jsx` — indicator render; `checkDayAvailability` endDate arg + call site + effect dep; new SchedulingAssistant props
- `src/components/SchedulingAssistant.jsx` — `endDate`/`isMultiDaySpan` props; header note; summarized verdict
- `src/components/RoomReservationForm.css` — `.multiday-span-indicator`; date-row margin move
- `backend/api-server.js` — `publishedConflictResults.map()` (~2964): emit normalized room name (projection already has the field); Part 4: widen `forceUpdate` gate at `:23921` to `!hasApproverAccess`
- `src/hooks/useReviewModal.jsx` (+ review-modal component) — `buildConflictErrorMessage`; net-new "Save Anyway" force-retry dialog for staff hard-conflict 409s (modeled on the soft-conflict state dialog)

## Build sequence
1. **Shared helper + indicator** (no backend, no risk): `dateSpanUtils.js` + tests; migrate `eventTransformers.js`; CSS; render indicator.
2. **Widen availability fetch**: `checkDayAvailability` endDate arg + call site + effect dep; SchedulingAssistant props + header note + summarized verdict.
3. **Clearer conflict info**: emit normalized room name in `publishedConflictResults.map()` (projection already has it); `buildConflictErrorMessage` (handle string|array). Backend Jest asserting the room name appears in the 409.
4. **Save policy (Warn + Save Anyway, staff)**: widen `:23921` `forceUpdate` gate to `!hasApproverAccess` (admin-save path only); build net-new "Save Anyway" dialog wired to `canForce`/`forceField`, resending with `forceUpdate: true`. Backend Jest: approver force succeeds on `PUT /api/admin/events/:id`; requester/guest force still 403/blocked.

## Testing
- Vitest: `dateSpanUtils` (same-day=0, 1-day, 10-day, 180-day, leap-year boundary, null/empty); fetch uses `endDate` when multi-day.
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
- **2026-05-29 — code-architecture-reviewer pass.** Corrections folded in: Part 3 — `CONFLICT_PROJECTION` already has `locationDisplayNames`; fix the `publishedConflictResults.map()` (it discards the field), handle string|array. Part 2 — must add an `endDate` slot to `lastFetchParamsRef` or the dedup guard suppresses the refetch. Part 4 — John's path is `PUT /api/admin/events/:id` (not the nonexistent `publish-edit`); two-gate force bug at `:23921` to widen to `!hasApproverAccess`; "Save Anyway" is net-new UI, not a reuse. Verified solid: Part 2 no-new-endpoint premise, availability response carries title/date for the verdict, most file:line refs, no OCC/SSE/status-machine impact.
