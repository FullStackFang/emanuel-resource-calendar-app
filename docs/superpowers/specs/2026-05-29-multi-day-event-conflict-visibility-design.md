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
- CSS in `RoomReservationForm.css`: 12px, secondary text color, no icon. Move the row's `margin-bottom` onto the indicator so spacing stays clean in both same-day and multi-day cases.

### Part 2 — Honest full-span verdict (no new endpoint)
The existing `/api/rooms/availability` endpoint (`api-server.js:14911-15014`) already queries any range correctly (incl. recurring expansion). The form just wasn't sending the end date.
- `checkDayAvailability` gains an `endDate` argument; when multi-day, the API call uses `endDateTime = ${endDate}T23:59:59` (keep local-time, **no Z suffix**). The `date` arg still drives the timeline's display day (start day).
- Add `formData.endDate` to the fetch effect dep array (`RoomReservationFormBase.jsx:~1016`). Existing abort/stale-request guards are unaffected.
- `SchedulingAssistant.jsx` gains optional `endDate` and `isMultiDaySpan` props.
  - Timeline rendering unchanged — still draws the **start day only** (correct for arbitrarily long spans), with `effectiveDate` staying `selectedDate`.
  - Header note when multi-day: `Showing start day (Jun 18). Full span: Jun 18 – Jun 28.`
  - Verdict (the `sa-summary` block, `SchedulingAssistant.jsx:2217-2228`): when `isMultiDaySpan && totalConflicts > 0`, render a summarized list built from the already-present per-room conflict detail — `Sanctuary – Shabbat Service (Jun 25)` — capped at 3 with `+N more`. Room name from `selectedRooms`, date from `conflict.startDateTime.split('T')[0]`.
- `onConflictChange` contract unchanged (already emits `{ hasHardConflicts, hardConflictCount }`); counts become honest automatically once the data covers the full span.

### Part 3 — Clearer conflict info (message, not a wall)
- Backend: the 409 already includes `hardConflicts[n].eventTitle` and `.startDateTime`; it's missing the room **name**. Add `calendarData.locationDisplayNames` to `CONFLICT_PROJECTION` and to the `publishedConflictResults.map()` return (`api-server.js:~2964`).
- Frontend: a `buildConflictErrorMessage(conflicts)` helper in `useReviewModal.jsx` replaces the flat "N conflicts" string at the three construction points (~711, ~851, ~960). Example: `Sanctuary is booked Jun 25 (Shabbat Service). Adjust dates or rooms.` 3+: `3 conflicts (Sanctuary Jun 25, Chapel Jun 28, +1 more).`

### Part 4 — Save policy: Warn + "Save Anyway" for staff
Conflict-check call sites and current behavior (`api-server.js`):

| Line  | Endpoint                                   | Role      | Hard block | Existing force flag |
|-------|--------------------------------------------|-----------|-----------|---------------------|
| 15999 | `POST /room-reservations/draft/:id/submit` | requester | yes       | —                   |
| 16393 | `PUT /room-reservations/:id/restore`       | requester | yes       | —                   |
| 16653 | `PUT /admin/events/:id/restore`            | admin     | yes       | `forceRestore`      |
| 17658 | `PUT /room-reservations/:id/edit`          | owner     | yes       | —                   |
| 21068 | `PUT /admin/events/:id/publish`            | admin     | yes       | `forcePublish`      |
| 23042 | `PUT /admin/events/:id/publish-edit`       | admin     | yes       | `forcePublishEdit` (isAdmin-gated) |
| 24273 | `PUT /admin/events/:id`                     | admin     | yes       | `forceUpdate`       |

- **Staff save paths** (admin save, publish, publish-edit, admin restore): ensure `canForce: true` is returned to **approvers**, not just admins, and that the frontend surfaces a **"Save Anyway"** confirm (reuse the soft-conflict dialog pattern in `useReviewModal.jsx:677-707`) instead of a dead-end error.
- **Stays hard-blocked:** guest/public reservation submission, and the requester paths (owner-edit, owner-restore, draft submit) — requesters/guests must not double-book.
- **VERIFY during planning:** the exact role→endpoint mapping (which endpoints approvers actually call to save a published event like John's), and whether `forcePublishEdit`'s `isAdmin` gate should widen to approver. This determines the precise edit points.

## Files

**Create**
- `src/utils/dateSpanUtils.js`
- `src/__tests__/dateSpanUtils.test.js` (Vitest)

**Modify**
- `src/utils/eventTransformers.js` — use shared `computeEventSpanDays`
- `src/components/RoomReservationFormBase.jsx` — indicator render; `checkDayAvailability` endDate arg + call site + effect dep; new SchedulingAssistant props
- `src/components/SchedulingAssistant.jsx` — `endDate`/`isMultiDaySpan` props; header note; summarized verdict
- `src/components/RoomReservationForm.css` — `.multiday-span-indicator`; date-row margin move
- `backend/api-server.js` — `CONFLICT_PROJECTION` + conflict map: add `locationDisplayNames`; Part 4 role/force adjustments
- `src/hooks/useReviewModal.jsx` — `buildConflictErrorMessage`; "Save Anyway" affordance for staff 409s

## Build sequence
1. **Shared helper + indicator** (no backend, no risk): `dateSpanUtils.js` + tests; migrate `eventTransformers.js`; CSS; render indicator.
2. **Widen availability fetch**: `checkDayAvailability` endDate arg + call site + effect dep; SchedulingAssistant props + header note + summarized verdict.
3. **Clearer conflict info**: `CONFLICT_PROJECTION` + map; `buildConflictErrorMessage`. Backend Jest test for `locationDisplayNames`.
4. **Save policy (Warn + Save Anyway, staff)**: confirm role/force mapping, grant `canForce` to approvers on staff paths, FE "Save Anyway" confirm. Backend tests per touched endpoint.

## Testing
- Vitest: `dateSpanUtils` (same-day=0, 1-day, 10-day, 180-day, leap-year boundary, null/empty); fetch uses `endDate` when multi-day.
- Jest (MongoDB Memory Server): `checkRoomConflicts` returns `locationDisplayNames`; staff vs. requester/guest force behavior on touched endpoints.
- Per CLAUDE.md: run only the touched test files, not the full suite.

## Timezone safety
All datetime strings stay local-time (`...T00:00:00` / `...T23:59:59`), **no Z suffix**, matching the existing backend convention. `computeEventSpanDays` uses local-midnight parsing.

## Out of scope (explicitly rejected)
- Full multi-day timeline / horizontal strip / stacked day rows (breaks for long spans).
- Day-by-day stepper as the primary mechanism (impractical for 6-month spans).
- Fully non-blocking save for all users (removes double-booking protection for guests/requesters).
- Blocking or warning on the mere existence of a multi-day event (multi-day events are legitimate; we make them visible, not forbidden).
