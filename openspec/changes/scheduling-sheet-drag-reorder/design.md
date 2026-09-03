## Context

Scheduling sheets render a table whose columns are event posts and whose rows are starter or custom labels. The current UI supports adding, renaming, deleting, and event-linking columns, plus adding, renaming, and deleting rows. Order is currently whatever order exists in `day.columns` and `day.rows`.

Admins need to rearrange the sheet after columns and custom rows are created. Starter rows are operational anchors used for event prefill and staff reading order, so they must remain fixed. Custom rows are user-authored structure and should be reorderable as a group below the starter rows.

## Goals / Non-Goals

**Goals:**
- Add direct drag handles to column headers for reordering columns.
- Add row-label drag handles for reordering custom rows.
- Preserve row ids, column ids, linked-event snapshots, cell data, and notes.
- Keep starter rows locked and visually distinct from reorderable custom rows.
- Provide keyboard/menu fallback actions for the same reorder operations.
- Keep changes scoped to the scheduling sheet surface and its existing `onStructure` persistence path.

**Non-Goals:**
- Reordering individual cells independently of their row or column.
- Allowing starter rows to move, including Location, Call Time, Doors Open, Begins, and Ends.
- Writing linked-event changes back to Microsoft Graph.
- Adding a new database collection, migration, or external drag-and-drop dependency unless native events prove insufficient.

## Decisions

### Use explicit drag handles, not whole-header dragging

Column drag starts from a small handle inside `.ss-col-header`; row drag starts from a handle inside custom `.ss-row-label`. This avoids collisions with existing behaviors: double-click rename, delete confirmation, link refresh, and cell editing.

Alternative considered: make the entire header/row label draggable. That is faster to discover accidentally but increases accidental structure changes and conflicts with existing click targets.

### Persist reordered arrays through `onStructure`

Reorder operations produce a new ordered `columns` or `rows` array and call the existing `onStructure` path. Cell keys are built from row id and column id, so reordering array positions should not require rewriting cells.

Alternative considered: store separate `order` numbers on each row/column. That adds persistence complexity without a current need because the ordered arrays already define render order.

### Lock starter rows as a fixed prefix

The grid already derives `starterRows` and `customRows` and renders starter rows before custom rows. Reordering applies only to `customRows`; the saved `rows` array should keep starter rows first, followed by the reordered custom rows.

Alternative considered: allow all rows to reorder but block prefill-sensitive labels only. That makes the behavior harder to explain and risks breaking event-prefill expectations if a starter row is moved out of the anchor area.

### Include menu/keyboard fallback actions

Drag is the primary interaction, but each reorderable column and custom row also needs move actions: move left/up, move right/down, move to start/top, and move to end/bottom. Disabled states prevent no-op moves at the boundaries.

Alternative considered: ship drag only. That leaves keyboard and assistive technology users without equivalent control.

## Risks / Trade-offs

- Accidental reorder while trying to rename or delete -> limit drag start to explicit handles and keep delete as its existing two-click confirmation.
- Native HTML drag-and-drop has uneven mobile ergonomics -> keep menu move controls as the reliable fallback and test pointer/touch behavior before implementation is considered done.
- Persisting a reordered `rows` array could accidentally move starter rows if implementation uses the raw row index -> implement reorder helpers that operate on `customRows` only and rebuild `starterRows + customRows`.
- Visual density can suffer if handles add too much chrome -> use compact icon-sized handles and reveal stronger affordance on hover/focus.
- Tests may be brittle with drag simulation -> unit test reorder helper behavior directly and component-test the exposed buttons/menu fallback, with one focused drag interaction test if the test environment supports it reliably.

## Migration Plan

No data migration is expected. Existing sheets already store ordered row and column arrays; unchanged sheets continue rendering in their current order.

Rollback is deleting the UI affordances and reorder handlers. Data remains valid because reordered arrays are still normal scheduling sheet structure.

## Open Questions

- Should columns reorder immediately on drop, or show a toast confirming the saved order? The current recommendation is immediate save through the existing structure path with inline status only if the existing sheet surface already has one.
- Should row handles be hidden for starter rows or shown disabled with a lock state? The current recommendation is hidden for starter rows to avoid suggesting a forbidden action.
