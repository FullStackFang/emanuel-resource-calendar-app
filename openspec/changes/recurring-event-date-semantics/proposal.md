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
  - `src/hooks/useReviewModal.jsx` — normalize inconsistent `occurrenceDate` extraction across the save/delete/edit-request sites (lines 455, 966, 1214 currently use divergent fallback patterns) and ensure the modal displays the clicked-occurrence's own date rather than master-derived data.
  - `src/utils/eventTransformers.js` — `transformEventToFlatStructure` (verify occurrence's own date is preserved; candidate fix site if the leak lives here rather than in `useReviewModal`).
  - `src/components/Calendar.jsx` — `handleEventClick` + scope dialog flow. Phase-1 exploration confirmed this layer already passes the correct occurrence object (line 4190); listed here only in case Phase-2 diagnosis locates the leak at the payload-construction step.
  - Recurrence tab component (location to be confirmed during implementation) — new `readOnly` mode.
  - New utility: `src/utils/recurrenceFormatters.js` exporting `formatRecurrenceSummary(recurrence)`.
- **Backend code** (second PR only):
  - `backend/api-server.js` — date-immutability validation added to the three occurrence-write sites: `PUT /api/admin/events/:id` (thisEvent block at line 22795), `PUT /api/room-reservations/draft/:id` (thisEvent block at line 14399), `POST /api/admin/events/:id/publish-edit` (thisEvent block at line 21309). Each rejects changes to `startDate`/`endDate` on occurrence/exception documents with `400 DATE_IMMUTABLE`.
  - `backend/utils/exceptionDocumentService.js` — gains a new exported helper `validateOccurrenceDateNotChanged(incomingBody, occurrenceDate)` colocated with the existing `resolveSeriesMaster` / `createExceptionDocument` helpers that the three write sites already use.
- **Tests**:
  - Vitest suites for `RoomReservationFormBase`, `Calendar`, `eventTransformers`, and new `recurrenceFormatters`.
  - Jest suite for the occurrence-edit endpoint (second PR).
  - No full-suite runs — scoped execution per `CLAUDE.md`.
- **Data / schema**: no changes. Top-level `startDate`/`endDate` on series masters remain the first-occurrence date for Microsoft Graph sync compatibility.
- **User-facing**: read-only fields show different (more meaningful) values on recurring events; clicking a single day finally shows that day; occurrence date editing is disabled with a helper message. No migrations, no new settings, no user training required.
- **Out of scope / explicitly rejected**: auto-extending a series range when an occurrence is moved; detaching an occurrence into a standalone event; any timezone refactor beyond operating in ET within new code paths.
