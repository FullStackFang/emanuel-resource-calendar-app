## Why

Users are confused by what "Reservation Start/End Date" means on recurring events. On a series master the fields display the first-occurrence date (a single day), but the label and context suggest they represent the entire series span. When a user clicks a single occurrence in the calendar (e.g., 4/20 of a weekly series), the review modal shows the series-creation date (e.g., 4/16) instead of the clicked day. And on that same single-occurrence view, the recurrence tab is fully editable — inviting users to change the pattern of the whole series from what they thought was a one-day edit.

Together these produce a system where no field shows what the user thinks it shows, and any edit can silently affect more than the intended scope.

## What Changes

- **Series master view**: the read-only "Reservation Start Date" / "Reservation End Date" inputs display `recurrence.range.startDate` → `recurrence.range.endDate` (the series span). Underlying DB fields are unchanged; this is a display-layer transform only.
- **Single-occurrence view ("This Event")**: the review modal shows the *clicked occurrence's own date* — not the series creation date. Exception overrides (e.g., an occurrence moved from 4/22 to 4/23) are honored.
- **Recurrence tab on single-occurrence view**: replaced with a plain-text summary (e.g., `"Weekly on Wednesdays, 4/15/2026 – 4/30/2026"`). No editable controls on this view. Editing the series requires opening "All Events".
- **Occurrence date immutability** (second PR — see `tasks.md`): date inputs on "This Event" are disabled at the UI level. The three backend endpoints that write occurrence/exception documents (`PUT /api/admin/events/:id`, `PUT /api/room-reservations/draft/:id`, `POST /api/admin/events/:id/publish-edit`) reject date changes to those documents with `400 DATE_IMMUTABLE`. Time-of-day edits remain allowed. The owner-edit endpoint `PUT /api/room-reservations/:id/edit` is intentionally out of scope — it is master-only and has no occurrence code path.
- **Non-changes**: the recurrence modal editing UX is untouched. No schema migration. No changes to how series masters are stored or synced to Microsoft Graph. No change to existing TimezoneContext plumbing — new code paths simply follow the existing `toLocalISOString()` pattern and operate in ET.

## Capabilities

### New Capabilities
- `recurring-event-dates`: how recurring event dates (series span vs. individual occurrence dates) are displayed in the review modal, how clicked-occurrence resolution works, how the recurrence tab renders in read-only vs. editable modes, and how occurrence date immutability is enforced end-to-end.

### Modified Capabilities
<!-- None. No existing openspec/specs/ capability covers recurring event dates; all requirements are new. -->

## Impact

- **Frontend code**:
  - `src/components/RoomReservationFormBase.jsx` — date input rendering (display-layer transform for masters; `disabled` on occurrence view per D).
  - `src/hooks/useReviewModal.jsx` — normalize inconsistent `occurrenceDate` extraction across **four** save/delete/edit-request sites at lines 459, 971, 1223, and 1624 (line-number drift from earlier plan: 455→459, 966→971, 1214→1223, plus the fourth site at 1624 that uses a more divergent fallback pattern). Ensure the modal displays the clicked-occurrence's own date rather than master-derived data.
  - `src/utils/eventTransformers.js` — `transformEventToFlatStructure`: the `isAlreadyFlat` gate at line 126 is strict (`startDate !== undefined && !start?.dateTime && !graphData?.start?.dateTime`), so a virtual occurrence with both flat `startDate` AND `start.dateTime` drops into the Graph-parsing branch. Leading hypothesis for the B-leak; candidate fix site if diagnosis confirms.
  - `src/components/Calendar.jsx` — `handleEventClick` + scope dialog flow. Phase-2 verification confirmed this layer already passes the correct occurrence object (line 4190); listed for completeness, expected no changes.
  - `src/components/RecurrenceTabContent.jsx` — **already accepts a `readOnly` prop** (line 61) and derives `canEdit = !readOnly && editScope !== 'thisEvent'` (line 130), but currently renders the editor JSX disabled rather than replaced. Work here is the render-replacement: when `canEdit === false`, render a single `<p>` with the recurrence summary text instead of the disabled editor.
  - `src/utils/recurrenceUtils.js` — adds a new `formatRecurrenceSummaryCompact(pattern, range, additions, exclusions)` export alongside the existing `formatRecurrenceSummary` at line 430 and `formatRecurrenceSummaryEnhanced` at line 520. Existing functions unchanged — existing consumers (`RecurrenceTabContent` editor tab, `RecurrencePatternModal`) keep their current phrasing. The new compact variant produces the spec's "Weekly on Wednesdays, 4/15/2026 – 4/30/2026" format for the read-only recurrence summary on occurrence views only. Both functions receive JSDoc comments naming their intended consumers.
- **Backend code** (second PR only):
  - `backend/utils/exceptionDocumentService.js` — `createExceptionDocument` and `updateExceptionDocument` gain a date-immutability check that compares the proposed `overrides.startDate` / `overrides.endDate` against the `dateKey` (= `occurrenceDate`). On mismatch, they throw `{ statusCode: 400, code: 'DATE_IMMUTABLE', message: ... }` following the existing error-shape pattern used by `resolveSeriesMaster`. The validation is **structural to the helpers** — any future write path that uses them gets the guard for free. A small module-private helper (e.g., `_validateOccurrenceDateNotChanged(overrides, dateKey)`) factors the check so both public helpers share one implementation.
  - `backend/api-server.js` — **no new wiring**. The three thisEvent blocks (`PUT /api/admin/events/:id` at line 22795, `PUT /api/room-reservations/draft/:id` at line 14399, `POST /api/admin/events/:id/publish-edit` at line 21309) already call `createExceptionDocument` / `updateExceptionDocument`, so the guard fires automatically. Their existing try/catch (which already handles `OrphanedException` / `MasterNotFound` / `InvalidEventType` thrown by `resolveSeriesMaster`) needs a minimal extension to translate `DATE_IMMUTABLE` into the 400 response — matching the same 400-envelope shape.
- **Tests**:
  - Vitest suites for `RoomReservationFormBase`, `Calendar`, `eventTransformers`, and new `recurrenceFormatters`.
  - Jest suite for the occurrence-edit endpoint (second PR).
  - No full-suite runs — scoped execution per `CLAUDE.md`.
- **Data / schema**: no changes. Top-level `startDate`/`endDate` on series masters remain the first-occurrence date for Microsoft Graph sync compatibility.
- **User-facing**: read-only fields show different (more meaningful) values on recurring events; clicking a single day finally shows that day; occurrence date editing is disabled with a helper message. No migrations, no new settings, no user training required.
- **Out of scope / explicitly rejected**: auto-extending a series range when an occurrence is moved; detaching an occurrence into a standalone event; any timezone refactor beyond operating in ET within new code paths.
