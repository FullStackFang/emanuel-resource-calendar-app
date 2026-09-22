## Why

A scheduling sheet cell can hold several chips, but nothing ties a time, a room
or a duty to the PERSON it is about — a cell reading `Stephen · 6:15 PM ·
Greenwald · Usher` is four loose chips, and with two people in the cell nobody
can tell whose 6:15 it is. Typing it is also worse than it looks: the picker
reads the whole input box as one term, so `@Stephen @615pm @Greenwald @Task`
matches nobody and Enter saves the entire line as plain text — Stephen is no
longer tagged, gets no email, and drops off My Assignments.

## What Changes

- One typed line can carry several `@` tokens. The first person on the line
  owns every token after it as a **detail**; a second explicitly-picked person
  starts a second group. A line with no person behaves exactly as today.
- The picker becomes **token-aware**: it acts on the token under the caret, not
  the whole box. A detail token defaults to "Add '<term>' as text" and never
  offers the placeholder / outsider rows; time, location and person rows apply
  only when explicitly picked, so typed text never silently turns into a
  person or a room.
- **Detail suggestions** come from text details already used on the same
  sheet (deduplicated case-insensitively), listed above the "Add as text" row —
  no new collection or admin list.
- A **live preview** under the input shows how the line will be grouped before
  it is committed.
- Person segments gain an optional `details` array (text and location segments
  only). `callTimeOverride`, `taggedEmails`, conflict warnings and `.ics`
  DTSTART/DTEND are untouched: details are labels, never inputs to any
  computation.
- The group renders as one chip in the grid, both cell editors (a detail can be
  removed individually), print, and the workbook PDF.
- The person sees their own details in the schedule email itinerary, on My
  Assignments, and in their `.ics` DESCRIPTION.
- `GET /api/my-assignments` entries gain a `details` field — a deliberate,
  additive widening of the key set locked by SE-25.

## Capabilities

### New Capabilities
- `scheduling-sheet-grouped-mentions`: parsing a multi-token `@` line into
  person groups, token-aware suggestions including sheet-derived detail
  suggestions, the `details` field on person segments (validation and
  storage), and where a person's details render — sheet surfaces (grid,
  editors, print, PDF) and recipient surfaces (email itinerary, My
  Assignments, `.ics` DESCRIPTION).

### Modified Capabilities
<!-- The scheduling-sheet capabilities live in unarchived changes
     (scheduling-sheets, scheduling-sheet-inline-cell-editing), not in
     openspec/specs/, so there is no archived spec to delta against. The
     SE-25 key-set widening is specified in the new capability instead. -->

## Impact

- **Frontend:** `src/components/scheduling/useMentionPicker.js` (token-aware
  mode, detail suggestions), new pure line parser beside it,
  `InlineCellEditor.jsx`, `SheetCellEditor.jsx`, `CellSuggestionList.jsx`,
  `SchedulingSheetGrid.jsx` (chip render, detail vocabulary),
  `SchedulingSheets.css`, `src/utils/schedulingSheetPdf.js`,
  My Assignments component.
- **Backend:** `backend/utils/sheetCells.js` (`validateCell` accepts and
  normalizes `details`), `extractDayAssignments` in `api-server.js`,
  `backend/utils/assignmentSchedule.js` (itinerary), `backend/utils/icsBuilder.js`
  (DESCRIPTION).
- **API:** `GET /api/my-assignments` entries add `details` (additive).
  Cell write body accepts `details` on person segments; older clients that
  never send it are unaffected.
- **Data:** no migration. Existing person segments simply have no `details`.
- **No** change to Graph, `templeEvents__Events`, conflict detection, call
  times or `taggedEmails`.
