## Why

Every edit to a scheduling sheet cell currently goes through a modal dialog: click a cell, wait for an overlay, type, click Save cell, watch the overlay close. Filling one day's Call Time row across eight event columns costs eight modal round-trips, and the modal hides the rest of the grid at exactly the moment the user is copying values across it. The modal also carries a defect class of its own — content left in its input is not part of what Save commits — because committing a value and dismissing a dialog are two separate actions the user has to perform in the right order.

Sheet cells are the one surface in this application whose editing pattern is spreadsheet-shaped: many small values, entered in sequence, across a visible grid. A modal is the wrong instrument for that, and the `@` mention picker it hosts is the part users most want closer to the cell.

## What Changes

- Add in-cell editing for scheduling sheet cells. Clicking an editable cell turns it into an editor in place; the surrounding grid stays visible and scrollable.
- Move the unified `@` mention picker into the cell. Typing `@` opens a suggestion list anchored to the cell being edited, offering people, locations, and times; `#` continues to narrow to locations only.
- Add spreadsheet keyboard semantics: Enter commits and advances to the cell below, Tab commits and advances to the cell on the right, Escape reverts the cell to its pre-edit value, and arrow keys move the focused cell when no cell is being edited.
- Commit a cell on blur, matching the existing cell-write concurrency model, so leaving a cell never silently discards typed content.
- Extract the mention/suggestion behavior into a single shared definition consumed by both the in-cell editor and the retained modal, so the two surfaces cannot drift.
- Retain the existing modal editor as the expanded editor for cell notes and for cells the user chooses to open in full. It is reached by an explicit affordance rather than by a plain cell click.
- Keep read-only users entirely out of edit mode: no in-cell editor, no suggestion list, no keyboard commits.

## Capabilities

### New Capabilities
- `scheduling-sheet-inline-editing`: Covers in-cell editing of scheduling sheet cells, the cell-anchored suggestion list, keyboard navigation and commit semantics across the grid, and the division of responsibility between the in-cell editor and the retained expanded editor.

### Modified Capabilities

<!-- None. The grid's cell editing entry point does change - clicking a cell now
     edits in place rather than opening the dialog - but `scheduling-sheet-grid`
     has not been promoted to `openspec/specs/` yet, so there is no base spec to
     write a delta against. That entry-point behavior is stated as a requirement
     in the new capability instead, matching how `scheduling-sheet-drag-reorder`
     handled the same situation. -->


## Impact

- Frontend scheduling sheet grid: `src/components/scheduling/SchedulingSheetGrid.jsx` gains focused-cell and editing-cell state plus grid keyboard navigation.
- New frontend modules under `src/components/scheduling/`: a shared suggestion hook, an in-cell editor component, and a portaled suggestion list component.
- Existing modal editor `src/components/scheduling/SheetCellEditor.jsx` is refactored to consume the shared suggestion hook. Its externally observable behavior is preserved.
- Scheduling sheet styling `src/components/scheduling/SchedulingSheets.css`, including the print stylesheet, which must hide in-cell editing chrome alongside the editing chrome it already hides.
- Frontend tests for the scheduling sheet grid and cell editor; new suites for the shared hook, the in-cell editor, and grid keyboard navigation.
- No backend change. Cell writes continue to use the existing ungated single-cell endpoint, the stored cell shape is unchanged, and no database migration is required.
