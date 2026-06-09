## Why

Temple staff need to mark whole days as **Holidays** or **Office Closed** — information that affects the calendar globally rather than being a bookable event. Today there is no way to show "the office is closed" or "which holiday falls on this day," either in the app or on the shared Outlook calendar. As a result, the day carries no at-a-glance context and there is nothing to discourage booking a room on a day the building is closed.

## What Changes

- Introduce **Calendar Markers**: each marker is a `holiday` or `officeClosed` entry covering a single date or a date range (e.g. an 8-day festival), stored in a new `templeEvents__CalendarMarkers` collection kept **separate from events** so markers are automatically excluded from every event query, the approval queue, counts, search, conflict detection, and export.
- Markers render as a light **transparent-wash ribbon** at the top of the day in Month, Week, and Day views — gold for Holiday, red for Office Closed — repeated across every day of a multi-day range. The existing "today" highlight is untouched.
- An optional per-marker `warnOnReservation` flag surfaces a **soft, non-blocking advisory** in booking forms when the selected date carries the flag. This is advisory only: no hard block, and `checkRoomConflicts()` is unchanged.
- Markers with `pushToOutlook` enabled materialize as **all-day Microsoft Graph events** on the main TempleEvents calendar — `showAs: oof` for Office Closed, `free` for Holiday — created, patched, and deleted in step with the marker (mirroring the event publish flow).
- Add an admin-only **"Holidays & Closures"** management screen (create/edit/delete) following the app's in-button confirmation pattern.
- Extend `graphEventBuilder` with all-day event support (`isAllDay` + exclusive midnight end date).

## Capabilities

### New Capabilities
- `calendar-markers`: The marker domain — the marker entity and its fields, admin-only CRUD management, validation (type, date range, flags), storage in `templeEvents__CalendarMarkers`, and the read API that feeds the calendar and booking forms.
- `calendar-marker-display`: How markers surface in the UI — the transparent-wash ribbon across Month/Week/Day views (including multi-day ranges) and the soft, non-blocking reservation advisory shown in booking forms for `warnOnReservation` days.
- `calendar-marker-outlook-sync`: Materializing markers as all-day Microsoft Graph events on the shared calendar (`isAllDay`, `showAs` derived from type), kept in sync on marker create/update/delete, with the Graph id stored back on the marker.

### Modified Capabilities
<!-- None. No existing spec's requirements change; markers live in their own collection and rendering path. -->

## Impact

- **Backend** (`backend/api-server.js`, `backend/services/graphApiService.js`, `backend/utils/graphEventBuilder.js`): new `templeEvents__CalendarMarkers` collection + indexes; new admin CRUD routes and a read endpoint; all-day support in the Graph payload builder; marker→Graph create/patch/delete lifecycle.
- **Frontend** (`src/components/Calendar.jsx`, `MonthView.jsx`, `WeekView.jsx`, `DayView.jsx`, related CSS, plus a new admin screen and booking-form banner): a marker query + `markersByDate` map, the ribbon rendering, the management UI, and the advisory banner.
- **Data**: one new collection. No migration of existing events; nothing is moved or rewritten.
- **Tests**: new Jest coverage (marker CRUD/validation, Graph all-day mapping, sync lifecycle) and Vitest coverage (ribbon rendering across views, multi-day spans, advisory banner).
- **No breaking changes.** Existing events, calendar loads, and Graph sync paths are unaffected.
