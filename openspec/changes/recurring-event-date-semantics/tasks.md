## 1. Phase 2 — Codebase Verification (before any code)

- [ ] 1.1 Read `src/components/RoomReservationFormBase.jsx` around lines 1600–1645 — confirm exact JSX for "Reservation Start Date" / "End Date" inputs, confirm `isRecurringDateLocked` flag source, identify where `formData.startDate` and `formData.endDate` are read for rendering
- [ ] 1.2 Read `src/utils/eventTransformers.js:121–364` — confirm `transformEventToFlatStructure` already preserves flat `startDate`/`endDate` when passed on the event object; note precedence rules
- [ ] 1.3 Read `src/components/Calendar.jsx` around lines 4119–4180 — trace what object is passed into `reviewModal.openModal` for (a) "This Event" branch (line ~4133) and (b) "All Events" branch (line ~4165); confirm whether the "This Event" branch currently re-reads master fields or uses the virtual occurrence
- [ ] 1.4 Locate the recurrence tab component — grep for `RecurrenceTabContent` or recurrence tab JSX, identify the container file and how `readOnly` can be threaded in (reuse existing prop chain if present)
- [ ] 1.5 Read memory file `project_exception_as_document.md` — confirm how exception documents are fetched during click resolution so scenario B2 can be implemented correctly

---

## 2. PR 1 — Recurrence summary formatter (new utility)

- [ ] 2.1 RED: create `src/utils/recurrenceFormatters.test.js` with failing Vitest cases covering every scenario in the `formatRecurrenceSummary` requirement: daily / weekly (single day + multiple days + interval > 1) / monthly / yearly; range types endDate / numbered / noEnd; additions + exclusions tail; empty additions + exclusions (no tail)
- [ ] 2.2 Run the new test file — confirm all cases fail (file does not exist yet)
- [ ] 2.3 GREEN: create `src/utils/recurrenceFormatters.js` exporting `formatRecurrenceSummary(recurrence)` — pure synchronous function, no React, no async, no timezone conversions; uses `toLocaleDateString('en-US')` and the EN-DASH separator per design doc
- [ ] 2.4 Re-run `npm run test:run -- recurrenceFormatters` until green; iterate on edge cases from RED failures
- [ ] 2.5 No regression check needed — brand-new file with no consumers yet

---

## 3. PR 1 — Series master display transform (requirement A)

- [ ] 3.1 RED: add Vitest cases to the `RoomReservationFormBase` test file (create if absent) covering: AC-A1 (master shows `recurrence.range.startDate`), AC-A2 (master shows `recurrence.range.endDate` when range extends beyond first occurrence), AC-A3 (singleInstance shows top-level dates), and the "missing recurrence range falls back gracefully" scenario
- [ ] 3.2 Run scoped `npm run test:run -- RoomReservationFormBase` — confirm the new A-requirement tests fail
- [ ] 3.3 GREEN: in `RoomReservationFormBase.jsx`, at the point the `startDate` / `endDate` inputs render `value=`, derive a display value: when `eventType === 'seriesMaster'` AND `recurrence.range.startDate` is truthy, use `recurrence.range.startDate`; otherwise fall back to `formData.startDate`. Same pattern for endDate. DO NOT modify `formData` itself — transform at render only
- [ ] 3.4 Re-run the RoomReservationFormBase test file until green
- [ ] 3.5 Regression check: run `npm run test:run -- eventTransformers` to confirm transformer is still used identically by all existing callers

---

## 4. PR 1 — Occurrence-date resolution bug fix (requirement B)

- [ ] 4.1 RED: add Calendar / click-handler tests (or extend existing ones) for AC-B1 (click 4/22 + "This Event" → modal receives `startDate = endDate = '2026-04-22'`), AC-B2 (exception document override flows through to modal), AC-B3 ("All Events" from occurrence → master opened with series range — cross-checked against requirement A)
- [ ] 4.2 Run scoped tests — confirm failure (current code leaks master's first-occurrence date into the "This Event" branch)
- [ ] 4.3 GREEN: fix `Calendar.jsx` `handleEventClick` / scope-dialog handler so the "This Event" branch passes the virtual occurrence's own resolved `startDate` / `endDate` / `startDateTime` / `endDateTime` into `reviewModal.openModal`. For AC-B2, look up any exception document for the clicked slot before opening the modal and prefer the override's date
- [ ] 4.4 Verify `transformEventToFlatStructure` preserves those flat fields without re-reading master data (should already be the case per `eventTransformers.js:126` precedence rule — confirm during Phase 2)
- [ ] 4.5 Re-run scoped Calendar tests until green

---

## 5. PR 1 — Read-only recurrence tab on occurrence view (requirement C)

- [ ] 5.1 RED: add a component test covering AC-C1 (occurrence view renders summary paragraph, no editable recurrence inputs) and AC-C3 regression (master / singleInstance views keep editable controls)
- [ ] 5.2 Confirm tests fail against current behavior (recurrence tab is always editable)
- [ ] 5.3 GREEN: in the recurrence tab component (located in task 1.4), derive `readOnly` from `eventType === 'occurrence'` or equivalent scope signal. When `readOnly === true`, render a single `<p>` element whose text comes from `formatRecurrenceSummary(recurrence)` — no form controls
- [ ] 5.4 Re-run the recurrence-tab tests until green
- [ ] 5.5 Regression check: verify master / singleInstance tests for the recurrence tab (if any exist) still pass — add one if the editable-path is currently untested

---

## 6. PR 1 — Scoped test suite verification

- [ ] 6.1 Run frontend tests scoped to affected files in one batch: `npm run test:run -- RoomReservationFormBase Calendar recurrenceFormatters eventTransformers` — expect all green, zero regressions
- [ ] 6.2 Run `npm run lint` to confirm no lint violations introduced
- [ ] 6.3 Do NOT run the full 523-test backend suite (per CLAUDE.md); PR 1 is frontend-only, no backend touchpoints

---

## 7. PR 1 — Commit and open PR

- [ ] 7.1 Draft commit message per CLAUDE.md `feat(scope): summary` format — keep summary ≤ 72 chars, no double quotes in commit text, include test counts, include `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
- [ ] 7.2 Create commit with only the PR 1 files (no PR 2 changes staged)
- [ ] 7.3 Push branch, open PR with bulleted summary of requirements satisfied (A-series, B-series, C-series)
- [ ] 7.4 Wait for automated bot review, resolve every finding (fix or justify), continue until bot returns a clean status

---

## 8. PR 2 — Phase 2 backend verification

- [ ] 8.1 Read `backend/api-server.js` PUT `/api/room-reservations/:id/edit` implementation — identify current validation flow, where `expectedVersion` check happens, and where calendarData fields are merged
- [ ] 8.2 Identify how occurrence / exception documents are distinguished from masters in that endpoint (`eventType === 'occurrence'`, `seriesMasterId` presence, or other flag)
- [ ] 8.3 Review existing 400 patterns for consistency — e.g., `VERSION_CONFLICT` response shape in `conflictSnapshotFields.js` / `concurrencyUtils.js` — so `DATE_IMMUTABLE` follows the same envelope

---

## 9. PR 2 — Occurrence date UI lock (requirement "Occurrence date inputs are disabled")

- [ ] 9.1 RED: add Vitest cases covering AC-D1 (startDate + endDate inputs have `disabled` attribute on occurrence view), AC-D2 (helper text visible and matches approved copy), AC-D3 (time inputs are NOT disabled on same view — regression guard)
- [ ] 9.2 Run scoped `npm run test:run -- RoomReservationFormBase` — confirm failures
- [ ] 9.3 GREEN: in `RoomReservationFormBase.jsx`, derive `isOccurrenceView` from event scope; apply `disabled={isOccurrenceView}` to startDate and endDate inputs; render helper text below date inputs with the final approved wording (see design doc Open Questions)
- [ ] 9.4 Re-run tests until green

---

## 10. PR 2 — Backend DATE_IMMUTABLE validation (requirement "Server rejects occurrence date mutations")

- [ ] 10.1 RED: create (or extend) a Jest test file — e.g., `backend/__tests__/integration/occurrenceDateImmutability.test.js` — covering AC-D4 (different startDate on occurrence → 400 DATE_IMMUTABLE + unchanged doc), AC-D5 (time-only change → 200), AC-D6 part 1 (same-value date re-send → no-op, 200), AC-D6 part 2 (direct API bypass returns same 400)
- [ ] 10.2 Run scoped `cd backend && npm test -- occurrenceDateImmutability` — confirm failures
- [ ] 10.3 GREEN: in `backend/api-server.js` PUT `/api/room-reservations/:id/edit`, before any write, compare incoming `startDate` / `endDate` against persisted values. If different AND document is an occurrence/exception, return 400 with `{ code: 'DATE_IMMUTABLE', message: <wording> }`. Abort write entirely (no partial update)
- [ ] 10.4 Ensure the same validation is applied in `testApp.js` (test harness) to keep test parity per project convention
- [ ] 10.5 Re-run scoped Jest tests until green
- [ ] 10.6 Regression check: run `cd backend && npm test -- editConflict pendingEdit rejectedEdit` (affected occurrence-edit tests) — expect all green

---

## 11. PR 2 — Scoped test suite verification

- [ ] 11.1 Frontend: `npm run test:run -- RoomReservationFormBase` — expect green
- [ ] 11.2 Backend: `cd backend && npm test -- occurrenceDateImmutability editConflict pendingEdit rejectedEdit` — expect green
- [ ] 11.3 Do NOT run the full suite; scoped execution only per CLAUDE.md

---

## 12. PR 2 — Commit and open PR

- [ ] 12.1 Draft commit message per CLAUDE.md format with PR 2 scope (`feat(room-reservations): lock occurrence dates on edit`), new + modified test counts, Co-Authored-By line
- [ ] 12.2 Create commit with only PR 2 files
- [ ] 12.3 Push branch, open PR with bulleted summary linking back to the spec file paths
- [ ] 12.4 Resolve all automated bot findings until clean status

---

## 13. OpenSpec archival (after both PRs merged)

- [ ] 13.1 Confirm PR 1 and PR 2 are merged to `main` and both deployed/verified in the intended environment
- [ ] 13.2 Run `/opsx:archive` for the `recurring-event-date-semantics` change — this promotes `specs/recurring-event-dates/spec.md` from `openspec/changes/` to `openspec/specs/` as the canonical capability spec
- [ ] 13.3 Update `CLAUDE.md` "Current In-Progress Work" and "Completed Architectural Work" sections to reflect the new capability
- [ ] 13.4 Update memory index `MEMORY.md` with a pointer to a new project memory entry if any surprising findings emerged during implementation
