## Why

Users are confused by what "Reservation Start/End Date" means on recurring events. On a series master the fields display the first-occurrence date (a single day), but the label and context suggest they represent the entire series span. When a user clicks a single occurrence in the calendar (e.g., 4/20 of a weekly series), the review modal shows the series-creation date (e.g., 4/16) instead of the clicked day. And on that same single-occurrence view, the recurrence tab is fully editable — inviting users to change the pattern of the whole series from what they thought was a one-day edit.

Together these produce a system where no field shows what the user thinks it shows, and any edit can silently affect more than the intended scope.

## What Changes

- **Series master view**: the read-only "Reservation Start Date" / "Reservation End Date" inputs display `recurrence.range.startDate` → `recurrence.range.endDate` (the series span). Underlying DB fields are unchanged; this is a display-layer transform only.
- **Single-occurrence view ("This Event")**: the review modal shows the *clicked occurrence's own date* — not the series creation date. Exception overrides (e.g., an occurrence moved from 4/22 to 4/23) are honored.
- **Recurrence tab on single-occurrence view**: replaced with a plain-text summary (e.g., `"Weekly on Wednesdays, 4/15/2026 – 4/30/2026"`). No editable controls on this view. Editing the series requires opening "All Events".
- **Occurrence date immutability** (second PR — see `tasks.md`): date inputs on "This Event" are disabled at the UI level. Backend `PUT /api/room-reservations/:id/edit` rejects date changes to occurrence/exception documents with `400 DATE_IMMUTABLE`. Time-of-day edits remain allowed.
- **Non-changes**: the recurrence modal editing UX is untouched. No schema migration. No changes to how series masters are stored or synced to Microsoft Graph. No change to existing TimezoneContext plumbing — new code paths simply follow the existing `toLocalISOString()` pattern and operate in ET.

## Capabilities

### New Capabilities
- `recurring-event-dates`: how recurring event dates (series span vs. individual occurrence dates) are displayed in the review modal, how clicked-occurrence resolution works, how the recurrence tab renders in read-only vs. editable modes, and how occurrence date immutability is enforced end-to-end.

### Modified Capabilities
<!-- None. No existing openspec/specs/ capability covers recurring event dates; all requirements are new. -->

## Impact

- **Frontend code**:
  - `src/components/RoomReservationFormBase.jsx` — date input rendering (display-layer transform for masters).
  - `src/components/Calendar.jsx` — `handleEventClick` + scope dialog flow (fix occurrence-date resolver).
  - `src/utils/eventTransformers.js` — `transformEventToFlatStructure` (verify occurrence's own date is preserved).
  - Recurrence tab component (location to be confirmed during implementation) — new `readOnly` mode.
  - New utility: `src/utils/recurrenceFormatters.js` exporting `formatRecurrenceSummary(recurrence)`.
- **Backend code** (second PR only):
  - `backend/api-server.js` — `PUT /api/room-reservations/:id/edit` gains date-immutability validation for occurrence/exception documents. Returns `400 DATE_IMMUTABLE`.
- **Tests**:
  - Vitest suites for `RoomReservationFormBase`, `Calendar`, `eventTransformers`, and new `recurrenceFormatters`.
  - Jest suite for the occurrence-edit endpoint (second PR).
  - No full-suite runs — scoped execution per `CLAUDE.md`.
- **Data / schema**: no changes. Top-level `startDate`/`endDate` on series masters remain the first-occurrence date for Microsoft Graph sync compatibility.
- **User-facing**: read-only fields show different (more meaningful) values on recurring events; clicking a single day finally shows that day; occurrence date editing is disabled with a helper message. No migrations, no new settings, no user training required.
- **Out of scope / explicitly rejected**: auto-extending a series range when an occurrence is moved; detaching an occurrence into a standalone event; any timezone refactor beyond operating in ET within new code paths.
