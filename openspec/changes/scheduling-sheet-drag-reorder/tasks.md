## 1. Reorder Helpers And Tests

- [x] 1.1 Add focused tests for column reorder helper behavior: moving left/right/across positions preserves column object ids and order.
- [x] 1.2 Add focused tests for custom row reorder helper behavior: starter rows remain locked as the prefix and custom rows reorder below them.
- [x] 1.3 Implement small pure helper functions for reordering columns and custom rows without mutating the existing arrays.

## 2. Column Header Drag

- [x] 2.1 Add explicit column drag handles to editable column headers without changing rename, linked-event, refresh, or delete controls.
- [x] 2.2 Wire native drag events so dropping a column updates `day.columns` through `onStructure({ columns })`.
- [x] 2.3 Add column move fallback controls: move left, move right, move to start, and move to end, with boundary no-ops disabled or omitted.
- [x] 2.4 Add component tests proving column reorder calls `onStructure` with the expected reordered columns and preserves linked-event metadata.

## 3. Custom Row Drag

- [x] 3.1 Add explicit row drag handles only to editable custom row labels.
- [x] 3.2 Wire native drag events so dropping a custom row updates `day.rows` through `onStructure({ rows })` while preserving starter row order.
- [x] 3.3 Add custom row move fallback controls: move up, move down, move to top, and move to bottom, with boundary no-ops disabled or omitted.
- [x] 3.4 Add component tests proving custom row reorder calls `onStructure` with starter rows locked and custom rows reordered.

## 4. Styling And Accessibility

- [x] 4.1 Add compact scheduling-sheet CSS for drag handles, hover/focus states, active drag state, and drop target state.
- [x] 4.2 Ensure reorder handles and fallback controls are hidden for read-only users.
- [x] 4.3 Ensure reorder controls have accessible names and keyboard reachable fallback actions.
- [x] 4.4 Respect reduced-motion preferences for any reorder transition or drag-state animation.

## 5. Verification

- [x] 5.1 Run the focused scheduling sheet component tests only.
- [x] 5.2 Run frontend typecheck or lint command if the touched files require it.
- [ ] 5.3 Manually verify in the browser that column drag, custom row drag, fallback moves, boundary states, and read-only mode behave correctly.
