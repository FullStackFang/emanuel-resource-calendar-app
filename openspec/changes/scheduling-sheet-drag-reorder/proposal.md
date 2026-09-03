## Why

Scheduling sheets currently allow admins to add, rename, link, and delete columns and custom rows, but not reorder them after creation. Admins need to arrange event columns and newly added rows into the working order used by staff without deleting and recreating sheet structure.

## What Changes

- Add direct drag reordering for scheduling sheet columns from the column header.
- Add drag reordering for user-created custom rows from the row label area.
- Keep starter rows, such as Location, Call Time, Doors Open, Begins, and Ends, locked in their seeded order.
- Preserve all column ids, row ids, linked-event metadata, notes, and cell contents while reordering.
- Provide non-drag move controls as the accessible fallback for columns and reorderable custom rows.

## Capabilities

### New Capabilities
- `scheduling-sheet-structure-reorder`: Covers user-facing reorder behavior for scheduling sheet columns and custom rows.

### Modified Capabilities

## Impact

- Frontend scheduling sheet grid: `src/components/scheduling/SchedulingSheetGrid.jsx`.
- Scheduling sheet styling: `src/components/scheduling/SchedulingSheets.css`.
- Scheduling sheet component tests for column and row reorder behavior.
- Backend persistence is expected to keep using ordered `columns[]` and `rows[]` arrays; no database schema migration is expected.
