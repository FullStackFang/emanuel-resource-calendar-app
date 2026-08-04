# Reassign as a centered modal + clergy in the Submitter Information grid

Date: 2026-08-04
Status: approved (user-approved in-session)

## Problem

1. The Reassign control expands inline inside the Submitter Information grid.
   A cell growing from one trigger line to a ~200px picker reflows every cell
   after it — jarring.
2. Clergy assignment on the Additional Information tab lives in a large
   button + summary block in the section below the Submitter Information
   grid, while the grid itself already shows a display-only Clergy cell.
   Two surfaces for one fact, and the editable one is far from the display.

## Decisions

### D1: ReassignOwnerControl opens a centered modal

- The small "Reassign" trigger link stays, but moves inside the Requester
  info-cell (under the email). The full-span `.reassign-owner-cell` grid cell
  is deleted — it existed only to give the inline picker width.
- Clicking the trigger opens a centered overlay modal reusing the
  `category-modal-overlay` / `category-modal` pattern ClergySelectorModal
  already uses, with a scoped `.reassign-owner-modal` class for deltas.
  No new global modal CSS (the codebase has a history of unscoped modal
  leaks).
- Header: "Reassign Owner" + close X. ESC, overlay click, close X, and
  Cancel all close and reset picker state. Body scroll locked via
  `useScrollLock`.
- Content: unchanged internals — a current-owner line, search box, capped
  5-match list with honest overflow count, pending-transfer view
  (current -> chosen + Change), inline error line.
- Footer: Cancel + the existing two-step commit button (Reassign ->
  pulsing "Confirm?" -> "Reassigning..."). Commit renders only after a
  selection, as before.
- All existing data-testids survive (`reassign-owner-picker` moves onto the
  modal content wrapper), so the RA test series keeps its selectors.

### D2: Clergy becomes a full-width row in the Submitter Information grid

- The single display-only Clergy cell is replaced by a full-span row
  (`grid-column: 1 / -1`, testid `clergy-cell-submitter` kept) containing:
  - a label line: "Clergy" plus a small "Edit" link (styled like the
    Reassign trigger, testid `clergy-edit-submitter`). The link opens the
    existing shared ClergySelectorModal and renders only when
    `!fieldsDisabled` — the same gate the removed button had.
  - two sub-columns: Rabbis | Cantors, each listing assigned names or an
    em-dash when that role is empty. The row always renders, so "nobody
    assigned" stays distinguishable from a load failure (D7 rationale from
    approver-event-reassignment survives).
- Both column headers always render. This changes the old CLS-4 contract
  ("only the assigned role is claimed") — the column header may name an
  unassigned role, but that column shows an em-dash and no entries.

### D3: The Additional Information clergy block is removed

- The `Clergy` button, summary row, and Clear action below the grid are
  deleted. Clear All still exists inside the modal. The Event Details tab
  clergy button is untouched, so the modal keeps two entry points: Event
  Details button + grid Edit link, driving the same single mounted modal
  and the same assignedRabbi/assignedCantor state.

### D4: Cell headers are the action (revision, same session)

The separate "Reassign" / "Edit" text links were too quiet. The cell headers
themselves are now the affordance:

- "Requester" and "Clergy" render as small bordered header-buttons
  (`.info-cell-action-header`): identical typography to `.info-cell-label`,
  plus a 1px `--border-default` chip and a shared pencil glyph
  (`InfoCellEditIcon`). Negative margins cancel the chip's padding so the
  label text stays flush with static labels in sibling cells.
- Clicking "Requester" opens the reassign modal; clicking "Clergy" opens the
  clergy modal. `aria-haspopup='dialog'`; aria-labels ("Reassign requester",
  "Edit clergy assignments") keep the visible label in the accessible name.
- When the action is unavailable (non-approver / unsaved event / fields
  disabled) the header falls back to the plain static `.info-cell-label` —
  same words, no dead chrome.
- `ReassignOwnerControl` gained `triggerClassName` / `triggerContent` /
  `triggerAriaLabel` props; its wrapper is `display: contents` so the
  trigger sits directly in the cell's flex column. The standalone link
  styles remain as the component default.

## Out of scope

- No backend surface. No change to the reassign endpoint, OCC flow, or
  clergy persistence.
- ReviewModal / useReviewModal (separate in-progress work in the tree).

## Tests

- `RoomReservationFormBase.test.jsx`:
  - RA-1..13 survive with selectors intact; add modal-presentation cases
    (overlay renders, Cancel/X/ESC close and reset).
  - CL-1..5 (additional-tab clergy block) are removed; replaced by grid
    Edit-link cases: opens the shared modal probe, hidden when fields are
    disabled, save-through-modal updates the cell (probe mock gains an
    onSave hook).
  - CLS series updated for the two-column structure.
- Verification: run `RoomReservationFormBase.test.jsx`; frontend baseline
  (10 failures / 3 files) unchanged.
