## 1. Extract The Shared Suggestion Behavior

- [ ] 1.1 Add tests for a `useMentionPicker` hook covering mode detection for `@`, `#`, and plain text, the five-match cap with its overflow count, the locations group under `@`, and the time entry offered when the term reads as a time.
- [ ] 1.2 Add tests for the hook's pending-input rule: the segment the input currently represents, including time normalization and the untouched non-time case.
- [ ] 1.3 Implement `useMentionPicker` in `src/components/scheduling/`, lifting mode detection, match lists, time parsing, and pending-input handling out of `SheetCellEditor` with no DOM knowledge.
- [ ] 1.4 Refactor `SheetCellEditor` to consume the hook, leaving its existing test suite unmodified so any behavior change surfaces as a failure.
- [ ] 1.5 Verify the existing cell-editor tests still pass unchanged.

## 2. Portaled Suggestion List

- [ ] 2.1 Add tests for a `CellSuggestionList` component covering render of person, location, and time entries, the overflow count, the placeholder and not-a-user escape hatches, and the free-text fallback for an unmatched location term.
- [ ] 2.2 Add a test proving pointer selection resolves before a blur commit, so a picked entry is added rather than the raw typed term.
- [ ] 2.3 Implement `CellSuggestionList` rendering through a portal into `document.body` with fixed positioning derived from a supplied rect.
- [ ] 2.4 Implement repositioning on grid scroll and window resize, and flipping above the anchor cell when there is insufficient room below.
- [ ] 2.5 Add a test proving the list is not clipped by the grid scroll area and renders above the sticky header and label column.

## 3. In-Cell Editor

- [ ] 3.1 Add tests for an `InlineCellEditor` component covering render of existing segments, segment removal, chip addition from each suggestion kind, and absence of any note field.
- [ ] 3.2 Add tests for commit and discard semantics: Enter commits, blur commits, Escape restores the pre-edit snapshot, and text left in the input is included in every commit path.
- [ ] 3.3 Add a test proving an existing cell note is retained unchanged when the cell is committed from the in-cell editor.
- [ ] 3.4 Implement `InlineCellEditor` consuming `useMentionPicker` and `CellSuggestionList`, taking a pre-edit snapshot when editing begins.
- [ ] 3.5 Implement time normalization on commit through the shared time parser.

## 4. Grid Wiring And Keyboard Navigation

- [ ] 4.1 Add tests for `SchedulingSheetGrid` focused-cell and editing-cell state: clicking an editable cell enters edit mode in place and opens no dialog.
- [ ] 4.2 Add tests for keyboard navigation: Enter commits and advances down, Enter in the last row commits without wrapping, Tab commits and advances right, arrow keys move focus only when not editing, and Escape returns from editing to focused.
- [ ] 4.3 Implement focused-cell and editing-cell state in `SchedulingSheetGrid` as two distinct pieces of state.
- [ ] 4.4 Implement the grid key handlers and the commit-then-advance transitions, routing saves through the existing cell save path.
- [ ] 4.5 Replace the plain cell click that opened the dialog with in-cell editing, and add the explicit expand affordance that opens `SheetCellEditor` for notes and full editing.
- [ ] 4.6 Add a test proving the expand affordance opens the full editor with note editing available.

## 5. Read-Only And Print

- [ ] 5.1 Add tests proving a read-only grid renders no in-cell editor, no suggestion list, and no expand affordance, and that Enter and Tab save nothing.
- [ ] 5.2 Implement the read-only gate so editing controls are absent rather than disabled, matching the existing structural controls.
- [ ] 5.3 Add in-cell editor, expand affordance, and suggestion list to the print stylesheet rules that already hide editing chrome, and confirm a portaled list does not print.

## 6. Styling

- [ ] 6.1 Add scheduling-sheet CSS for the focused cell, the editing cell, and the portaled suggestion list, reusing the existing picker styling so both surfaces read as one component.
- [ ] 6.2 Ensure the editing cell may grow vertically as chips are added without disturbing committed cell rendering after commit.
- [ ] 6.3 Wrap any transitions in a reduced-motion media query, matching the existing scheduling sheet styles.

## 7. Verification

- [ ] 7.1 Run the scheduling sheet test suites and confirm every existing test still passes alongside the new ones.
- [ ] 7.2 Run the full frontend suite and confirm the failure count matches the documented pre-existing baseline.
- [ ] 7.3 Run lint on all touched files and confirm no new warnings.
- [ ] 7.4 Mutation-check the highest-risk behaviors: removing the mousedown suppression must fail the suggestion-versus-blur test, and binding commit to Enter only must fail the blur-commit test.
- [ ] 7.5 Manual verification on dev with a live session: enter a column of times by keyboard alone, tag people and locations from within a cell, scroll a wide sheet in both axes with a suggestion list open, confirm Escape discards, open the expanded editor for a note, and confirm a read-only session has no editing surface.
