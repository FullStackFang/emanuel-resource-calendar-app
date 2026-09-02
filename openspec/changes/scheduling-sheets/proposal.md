# Proposal: Scheduling Sheets

## Why

Holiday staffing (High Holy Days, Purim, etc.) is coordinated on a printed Excel sheet: a grid of events-as-columns and roles-as-rows with people's names in cells. Nothing in the app covers this, so the artifact lives outside the system — no emailing someone their own schedule, no "what are my assignments" view, no year-over-year reuse. The team wants this in-app, but explicitly as a **scheduling artifact builder, not a calendar feature**: nothing here writes to Outlook, the events collection, or any approval workflow.

## What Changes

- New **Scheduling Sheet** (workbook) entity grouping any set of days, adjacent or disjoint (e.g. "2026 High Holy Days" = Sep 11, 12, 20, 21). Each day is a spreadsheet-style tab.
- New **day-sheet grid** editing surface: events/posts as columns, freeform rows (five starter rows seeded per day — Location, Call Time, Doors Open, Begins, Ends — all renameable/deletable), free text in any cell, add row/column anywhere.
- **Smart chips as opt-in enhancements**: `@` tags a person (app user, external name+email, or unresolved placeholder), `#` tags a location from `templeEvents__Locations`. Linking a column to a published event prefills name/times/location (sugar only; no write-back, no live coupling beyond a drift flag).
- **Derived My Assignments view**: any logged-in user sees their upcoming assignments, derived from `@` person chips across all sheets (email join key, lowercased).
- **Per-person schedule emails**: one email per distinct tagged person covering their cells for a day or the whole workbook, via the existing `emailService`/`emailTemplates` registry (new `ASSIGNMENT_SCHEDULE` template). Per-recipient failure isolation. Sends are hard-blocked while unresolved placeholder chips remain (admin override).
- New permission `canManageAssignments` = `isAdmin || department === 'events'`, threaded through the same pipeline as `canManageCalendarMarkers` (backend gate middleware with DB re-fetch, `getPermissions()`, frontend route guard, nav).
- New user-lookup endpoint gated by the assignment-manager gate itself (NOT `GET /api/users`, which is `canManageUsers`-gated and would 403 events-dept requesters).
- Print stylesheet so the active day-sheet prints like the Excel original (plain `@media print`; no `@react-pdf/renderer`).

## Capabilities

### New Capabilities

- `scheduling-sheet-workbooks`: workbook + day lifecycle — create/rename/delete scheduling sheets, add/remove day tabs, copy a day or a whole workbook (structure carries, dates cleared/re-seeded, weekday-drift warning), picker/tab navigation, deep link by workbook+date, permission gate.
- `scheduling-sheet-grid`: the day-sheet editing surface — columns (free-standing or event-linked with drift flag), freeform rows with seeded starter rows, cell editing with free text, `@` person chips (user/external/placeholder), `#` location chips, cell notes, per-person call-time override, soft double-booking warning, print view.
- `scheduling-assignments-view`: the derived read-only "My Assignments" surface for any authenticated user, grouped by day, matched on lowercased chip email.
- `scheduling-schedule-email`: the ASSIGNMENT_SCHEDULE email — day-scoped and workbook-scoped sends, one message per distinct person, recipient panel with placeholder hard-block + admin override, per-recipient results, `lastEmailedAt`/stale tracking.

### Modified Capabilities

(none — fully isolated from existing capabilities; no event/reservation/marker spec changes)

## Impact

- **New collections**: `templeEvents__SchedulingSheets` (workbook docs) and `templeEvents__SchedulingSheetDays` (one doc per day-sheet holding columns/rows/cells; assignments are derived from chips, not stored separately). Wired at BOTH `api-server.js` collection-assignment sites (startup + `injectedDb` test-harness branch).
- **Backend**: new `/api/scheduling-sheets/*` route family + `/api/my-assignments`; `requireAssignmentManager` middleware; `canManageAssignments` in `permissionUtils.js`; `ASSIGNMENT_SCHEDULE` in `emailTemplates.js` (+ `CTA_CONFIG`; EU-14 forces classification); index on chip emails for the my-assignments query.
- **Frontend**: new workbook route/screen (`/admin/scheduling-sheets`), My Assignments screen, nav + route-guard wiring in `App.jsx` (mirrors Calendar Markers placement), `canManageAssignments` through `RoleSimulationContext`/`usePermissions`.
- **No impact** on: events/reservations collections, Graph sync, conflict detection, approval queues, search, SSE event contracts (sheet updates may add a scoped SSE topic later; v1 uses standard query refetch).
- **Known QA caveat**: role simulation simulates role, not department — an admin previewing an events-dept requester sees assignment nav only if their real account is in the events department (same as Calendar Markers).
