# Tasks: reassign-modal-clergy-grid

- [x] 1.1 ReassignOwnerControl.jsx: render the picker inside a centered
      `category-modal` overlay (header/content/footer, ESC + overlay +
      Cancel + X close, scroll lock); trigger unchanged.
- [x] 1.2 ReassignOwnerControl.css: drop the inline dropdown box styles,
      add scoped `.reassign-owner-modal` deltas.
- [x] 2.1 RoomReservationFormBase.jsx: move the Reassign trigger into the
      Requester cell; delete the `.reassign-owner-cell` full-span cell.
- [x] 2.2 RoomReservationFormBase.jsx: replace the Clergy cell with the
      full-width two-column row (Rabbis | Cantors) + gated Edit link.
- [x] 2.3 RoomReservationFormBase.jsx: remove the Additional Information
      clergy button/summary/Clear block.
- [x] 2.4 RoomReservationForm.css: remove `.reassign-owner-cell`, add
      clergy row styles (+ mobile single-column collapse).
- [x] 3.1 Update RoomReservationFormBase.test.jsx: RA-14..16 modal cases,
      CG-1..4 grid clergy cases, CLS-1/2/4/5/6 updated for two columns,
      CL-1..5 removed with the block they tested.
- [x] 3.2 RoomReservationFormBase.test.jsx 47/47 green; the three other
      suites referencing the form base (useFloorPlan, eventPayloadBuilder,
      useReviewModal.prefetchParams) 20/20 green.
- [x] 3.3 D4 revision: Requester and Clergy cell headers become the action
      buttons (shared `.info-cell-action-header` chip + pencil glyph, plain
      label fallback); RA-2/3 and CG-3 lock the fallback. 47/47 green.
- [ ] 4.1 Manual check on dev: open the Reassign modal from the Requester
      header, round-trip a transfer, open the clergy modal from the Clergy
      header, confirm mobile collapse and header/label alignment.
