## Context

A scheduling sheet day renders as a table: event posts are columns, starter and custom labels are rows, and each intersection is a cell holding an ordered list of segments (free text, person chips, location chips) plus an optional note. Today every cell edit opens `SheetCellEditor`, a modal dialog rendered over a backdrop. The modal owns the unified `@` mention picker (people plus a Locations group), the `#` location shortcut, the per-person call-time override, the note textarea, and Save/Cancel.

The modal was the right first cut: it has no layout constraints, so the picker could be built without solving positioning. But the editing pattern this grid actually serves is spreadsheet-shaped — many short values entered in sequence while reading across neighbouring columns — and a modal is hostile to it in three specific ways. It hides the grid the user is copying from. It costs a full open/close cycle per cell. And because committing a value (Enter, or a picker click) and dismissing the dialog (Save cell) are separate user actions, content can sit in the input while the dialog closes around it.

Two structural facts constrain any in-cell design and are the reason this document exists:

1. `.ss-grid-scroll` sets `overflow-x: auto` and `overflow-y: auto`, and the header row and label column are `position: sticky` at z-indexes 2 through 4. A suggestion list rendered inside a cell is clipped by that scroll container and can be occluded by the sticky chrome.
2. Cell writes are deliberately ungated. The structure endpoint uses optimistic concurrency with `expectedVersion`, but a cell write is a targeted `$set` on one cell path plus an `$inc` of `_version`, with no version gate. Different cells never conflict; the same cell is last-write-wins with a one-cell blast radius.

## Goals / Non-Goals

**Goals:**
- Edit a cell in place, with the rest of the grid visible and scrollable throughout.
- Anchor the `@` suggestion list to the cell being edited, offering people, locations, and times.
- Provide spreadsheet keyboard semantics so a column of values can be entered without reaching for the mouse.
- Never silently discard typed content, on any exit path.
- Keep one definition of suggestion behavior shared by the in-cell editor and the retained expanded editor.
- Keep read-only users entirely out of edit mode.

**Non-Goals:**
- Changing the stored cell shape, the cell-write endpoint, or any backend validation.
- Touch and small-screen refinement of in-cell editing. This grid is desktop- and print-oriented, and a portaled suggestion list interacting with an on-screen keyboard is a separate problem.
- Multi-cell selection, fill-down, copy/paste ranges, or any other spreadsheet bulk operation.
- Moving note editing into the cell.
- Reordering, resizing, or otherwise restructuring the grid. That surface is owned by `scheduling-sheet-structure-reorder`.

## Decisions

### Extract the suggestion behavior into one shared hook

The mode detection (`@` for people and locations, `#` for locations only, otherwise plain text), the match lists with their five-item cap and honest overflow count, the time parsing, the unassigned-placeholder path, and the not-a-user external-person path move into a single `useMentionPicker` hook. Both the in-cell editor and the retained modal consume it. The hook holds no DOM knowledge; presentation stays with each surface.

This is the decision the rest of the design depends on. The alternative — build the in-cell editor by copying the modal's picker JSX — produces two definitions of what `@` means, which drift the first time a suggestion type is added to one surface and not the other. The same argument produced `parseTimeToken` as the single definition of a sheet time: consistency is worth more when it is structural than when it is a convention contributors have to remember.

Alternative considered: a shared presentational component instead of a hook. Rejected because the two surfaces genuinely need different layout — the modal stacks its picker below a full-width input, the cell floats one over the grid — while needing identical behavior. A hook splits along that seam; a component does not.

### Render the suggestion list in a portal, positioned from the cell rect

The list renders through a portal into `document.body` with `position: fixed`, positioned from the editing cell's `getBoundingClientRect()`, at a z-index above the sticky grid chrome. It repositions on scroll of the grid container and on window resize, and flips above the cell when there is not enough room below.

This follows directly from the overflow and sticky facts in Context. Anything rendered inside the cell is clipped.

Alternative considered: removing `overflow` from `.ss-grid-scroll` so an absolutely positioned list could escape. Rejected because the scroll container is what makes a wide sheet usable and what keeps the sticky header and label column working.

Alternative considered: a fixed-position list anchored to the grid rather than the cell. Rejected because the suggestion list must read as belonging to the cell being edited; a list that appears in a constant location is a modal with extra steps.

### Keep the modal as the expanded editor, do not delete it

The modal remains, reached by an explicit affordance on the cell rather than by a plain click, and remains the only place a note is edited. Cells with many chips can also be opened there when the in-cell footprint gets awkward.

Notes are long-form, comparatively rare, and want room. Forcing them into a grid cell would trade a good modal for a cramped popover. Keeping the modal also means its existing behavior stays under test as a regression guard through the refactor, rather than being replaced wholesale.

Alternative considered: retire the modal and move notes into a second cell-anchored popover. Rejected as a larger change with no user benefit proportional to it, and it would invalidate the existing cell-editor test suite instead of extending it.

### Commit on Enter, Tab, and blur; revert only on Escape

A cell commits its value when the user presses Enter, presses Tab, or moves focus away. Escape is the single path that discards, restoring the cell to a snapshot taken when editing began.

Blur-commit is safe here precisely because of the ungated single-cell write model in Context: there is no version gate to go stale and no multi-field payload to half-apply, so an incidental commit costs at most one cell that the user can retype. The rule to preserve is the one the modal violated — no exit path silently discards typed content — and making discard require a deliberate Escape is the clearest form of it.

Alternative considered: commit only on Enter and Tab, discarding on blur. Rejected because it reintroduces exactly the defect that motivated this change, in a surface where blur is far easier to trigger accidentally than closing a dialog.

### Suggestion clicks must win the race against blur

Pointer interactions in the suggestion list suppress the default mousedown behavior so the list can act before the input's blur handler commits and tears the list down. The existing event-mention list in the column header already does this for the same reason, and the in-cell list inherits the constraint.

This is a small detail with an outsized failure mode: without it, clicking a suggestion commits the raw typed term instead of the picked chip, intermittently and depending on event ordering.

### The grid owns two distinct cell states

`SchedulingSheetGrid` tracks a focused cell and an editing cell as separate state. Arrow keys move focus when nothing is being edited; typing or clicking promotes the focused cell to editing; Enter commits and moves focus down; Tab commits and moves focus right; Escape drops from editing back to focused without leaving the grid.

Collapsing these into one state makes arrow-key navigation impossible to express, because an editing cell must be allowed to use arrow keys for text caret movement.

Alternative considered: editing-only, with no focused state and no arrow navigation. Rejected because arrow navigation is a large part of why spreadsheet entry is fast, and adding it later would mean revisiting every key handler.

### Enter advances downward

Enter commits and moves to the cell below; Tab commits and moves right. The dominant entry pattern on these sheets is filling one row concept for one event at a time and, more often, filling a column of times down a single event post. Down-on-Enter with right-on-Tab is also the convention every spreadsheet the staff already use follows, so it needs no explanation.

At the last row of a column, Enter commits without advancing rather than wrapping to the next column, because wrapping moves the user somewhere they did not ask to go.

### Read-only users get no editing surface at all

When the grid is not editable, cells render no in-cell editor, no suggestion list, no expand affordance, and ignore editing key handlers entirely. This matches how every other structural control in this grid is gated: absent rather than disabled.

## Risks / Trade-offs

- **Portal positioning drifts from the cell during grid scroll or resize** → Position is recomputed on scroll of the grid container and on window resize, and the list flips above the cell near the viewport bottom. This is the highest-uncertainty part of the change and should be verified against a wide sheet scrolled in both axes, with the sticky header and label column in view.

- **Blur-commit fires when the user clicks a suggestion** → Suppress default mousedown in the suggestion list so selection resolves before blur, as the existing column-header mention list already does. Covered by an explicit test rather than left to event ordering.

- **A cell grows as chips are added, shifting the rows below mid-edit** → Accept vertical growth of the editing cell and keep the committed cell's rendering unchanged, so layout settles back on commit. Cells that grow awkwardly large are the case the retained expanded editor exists for.

- **Blur-commit makes accidental edits easier than the modal did** → Bounded by construction: one cell, last-write-wins, retypeable. Escape remains an explicit, discoverable discard. The alternative risks silent data loss, which is worse than a retyped cell.

- **Refactoring the modal to consume the shared hook regresses its behavior** → The modal's existing test suite is kept intact and unmodified through the refactor, so any behavior change surfaces as a failure rather than as a silent difference between the two surfaces.

- **In-cell editing is poor on touch devices** → Explicitly out of scope. The expand affordance reaches the existing modal, which remains usable on touch, so no surface becomes unreachable.

- **Print output picks up editing chrome** → The print stylesheet already hides drag handles and move menus; in-cell editor and suggestion-list chrome are added to the same rules, and a portaled list must not be printed at all.

## Open Questions

- Whether a plain single click should enter edit mode immediately, or first focus the cell and require a second click or a keystroke to edit. Immediate editing matches the current click-to-edit expectation; focus-first matches spreadsheets more closely and makes arrow navigation reachable by mouse. The specs assume immediate editing, which preserves today's muscle memory.
- Whether Tab at the last column should wrap to the first column of the next row or stop. Stopping is assumed, consistent with Enter at the last row.
