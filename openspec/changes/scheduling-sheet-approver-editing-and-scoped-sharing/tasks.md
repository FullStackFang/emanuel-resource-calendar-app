## 1. Baseline and regression reproduction

- [x] 1.1 Reproduce Scheduling Sheet access and row creation locally with a non-Events approver and an Events manager; record whether denial, Enter-only interaction, or mutation failure explains the original report.
- [x] 1.2 Run only related permission, scheduling component, schedulingSheets, and schedulingSheetEmail test files as a baseline; record existing failures separately without running the full suite.
- [x] 1.3 Add failing regressions for non-Events approver access and button-based row creation, including retained input after a failed save.

## 2. Full management permission and row controls

- [x] 2.1 Extend backend canManageAssignments and frontend approver simulation while preserving Events-department access; verify route/navigation and all protected operation families using the existing gate.
- [x] 2.2 Add accessible Add Row button and Enter parity, pending-state duplicate protection, success notification, and input retention until persistence succeeds.
- [x] 2.3 Add failing drag/keyboard tests for moving starter rows across custom rows while preserving ids, cells, notes, and role metadata.
- [x] 2.4 Extend existing reorder helpers and controls to all rows; preserve boundary behavior and read-only exclusions, and remove obsolete starter-prefix expectations from focused tests.

## 3. Stable metadata roles

- [x] 3.1 Add failing role-resolution tests covering legacy labels, duplicate labels, explicit-role precedence, null roles, renamed legacy rows, copies, and older clients omitting role properties.
- [x] 3.2 Add backend role validation, new-day seeding, copy preservation, and normalization on structural save; preserve persisted roles on legacy writes and reject duplicate or invalid explicit roles.
- [x] 3.3 Update frontend and backend metadata consumers, including assignment extraction and event prefill, to use the documented compatibility rule; verify renamed/reordered rows retain time/location semantics in body and ICS inputs.
- [x] 3.4 Add a keyboard-accessible row metadata-role action with assign/remove behavior and duplicate-role error feedback; test recovery after a metadata row is deleted.

## 4. Structural deletion integrity

- [ ] 4.1 Write failing tests showing deleted rows/columns disappear from recipient lists, My Assignments, email extraction, and ICS, including historical orphaned cells.
- [ ] 4.2 Clean removed cells and recompute taggedEmails in the same version-checked structural mutation; validate cell targets atomically so late cell writes cannot recreate orphaned content.
- [ ] 4.3 Filter orphaned cells in all assignment and recipient readers; verify concurrent cell-before-delete conflicts and delete-before-cell rejection without changing ordinary per-cell last-write-wins behavior.
- [ ] 4.4 Verify pending local edits are coordinated with structural actions and version conflicts retain the user's intended row input.

## 5. Distribution scope contract and planner

- [x] 5.1 Add failing backend tests for selected nonconsecutive days, combined/perDay grouping, mixed scope, duplicate/foreign/unknown days, empty or ineligible recipients, stale/missing versions, and legacy request compatibility.
- [x] 5.2 Implement a focused scope/group planner with chronological groups and per-recipient membership; normalize legacy inputs without accepting ambiguous old/new formats.
- [x] 5.3 Add new-client day-version preflight before any send and capture one set of server documents for body/ICS generation; verify a 409 sends no messages.
- [ ] 5.4 Validate per-group attachment metadata against the plan and preserve optional legacy attachment support; test unknown groups and scope mismatches without delivering mail.

## 6. Shared selection and scoped PDF output

- [x] 6.1 Write failing panel tests for current/all/custom day selection, eligible roster reset, explicit empty selection, message/person counts, grouping, and confirmation reset after every setting change.
- [ ] 6.2 Implement reusable day selection in email and export surfaces with combined/per-day grouping and independent default-on PDF/ICS toggles; disable send during local edits or active delivery.
- [ ] 6.3 Add failing PDF tests proving unselected days are excluded from combined and per-day output and filenames identify the covered dates.
- [ ] 6.4 Generate PDFs through the existing renderer using captured selected-day subsets; build attachmentsByGroup and expectedDayVersions from the same snapshot, preserving lazy loading.
- [ ] 6.5 Implement combined download and explicit per-day download links, object URL cleanup, the 31-day combined guard, and aggregate upload-size preflight; verify no silent omissions or automatic multi-download dependence.

## 7. Delivery outcomes and sent coverage

- [ ] 7.1 Write failing integration tests for per-recipient/per-day partial failure, disabled delivery, attachment degradation, log-write failure, and an edit occurring during send.
- [ ] 7.2 Send planned recipient/group messages through a bounded worker pool using existing email templates/service and ICS builder; preserve stable ICS identity and isolate results without automatic ambiguous-outcome retries.
- [ ] 7.3 Return per-delivery dates, outcomes, and actual attachment status, preserving legacy top-level summaries; show message totals, unique people, and actionable warnings in the panel.
- [ ] 7.4 Record successful assigned-day coverage with sent day version and group id; retain timestamp compatibility for old logs and do not stamp disabled or failed sends.
- [ ] 7.5 Add failing aggregate-status tests for unsent-before-sent order, partial coverage, stale coverage, and unassigned days; implement order-independent status calculation and honest unknown-network-outcome messaging.

## 8. Verification and specification reconciliation

- [ ] 8.1 Run the changed frontend permission/route/grid/panel/PDF/helper tests and backend permission/schedulingSheets/schedulingSheetEmail/metadata tests only; record exact commands and results.
- [ ] 8.2 Run required lint/build checks appropriate to touched files; resolve failures in touched files and distinguish unrelated baseline failures.
- [ ] 8.3 Verify locally in the browser as a non-Events approver: add/rename/move/delete rows, assign metadata roles, reload persistence, concurrent-edit errors, and selected-date email preview with mocked delivery.
- [ ] 8.4 Inspect generated combined and per-day PDFs and mocked outgoing body/ICS payloads for matching dates, shared-grid versus personal content, Unicode labels, and size-limit feedback; send no real emails without explicit authorization.
- [ ] 8.5 Reconcile overlapping requirements from scheduling-sheets and scheduling-sheet-drag-reorder before archival so admin/Events-only access, fixed starter ordering, and old distribution scope do not survive as contradictory canonical requirements; retain unfinished unrelated checks.
- [ ] 8.6 Record compatibility/rollback limitations and verification evidence, provide a ready-to-use commit message, and leave deployment to the user.

### Slice landed 2026-09-10: day selection + scoped PDF (combined only)

Tasks 5.1-5.3 and 6.1 are complete. `perDay` grouping was explicitly deferred by
the requester, which leaves these partially done — recorded here rather than
ticked, so the checkboxes do not overstate what shipped:

- **5.4** not started. `attachmentsByGroup` only has meaning with more than one
  group, so combined-only keeps the legacy single `attachment` field. The server
  refuses `grouping: "perDay"` with 400 `UNSUPPORTED_GROUPING` (SE-42) instead of
  silently sending one combined email.
- **6.2** email surface only. The day rail is in `EmailSchedulesPanel`; the export
  surface, per-day grouping, and "disable send while local edits are pending" are
  not done.
- **6.3** combined output only (SPS-1). Per-day output does not exist yet, and PDF
  filenames still name the workbook + first date rather than the covered dates.
- **6.4** selected-day subsets, `expectedDayVersions` from the same snapshot, and
  lazy loading are done; `attachmentsByGroup` is not.
- **6.5** the 31-day guard is done as a REFUSAL (the renderer truncates and notes
  it on the cover, which misrepresents a send). Per-day download links, object-URL
  cleanup for them, and the aggregate upload-size preflight are not done.
- **7.x** untouched: coverage is still stamped per day by the existing emailLog
  path, so mixed coverage still reads "changed since sent" rather than the
  "partially sent" the spec describes.

Also deviating from design.md deliberately: `includePdf` is a decision between the
panel and `SchedulingSheets.sendSchedules` and is stripped before the request —
the server only ever sees whether an `attachment` arrived, so adding a server
field it would not read was avoided.

**Blocked on task 4, which is another session's work in progress.** SE-30,
SS-31, SS-32, SS-33 and SEP-9 (orphaned cells from deleted rows/columns) were
already failing before this slice and still are; day selection neither worsens
nor fixes them.
