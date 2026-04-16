## 1. Phase 2 — Codebase Verification (before any code)

- [ ] 1.1 Read `src/components/RoomReservationFormBase.jsx` around lines 1600–1645 — confirm exact JSX for "Reservation Start Date" / "End Date" inputs, confirm `isRecurringDateLocked` flag source, identify where `formData.startDate` and `formData.endDate` are read for rendering
- [ ] 1.2 Read `src/utils/eventTransformers.js:121–364` — confirm `transformEventToFlatStructure` already preserves flat `startDate`/`endDate` when passed on the event object; note precedence rules
- [ ] 1.3 Read `src/components/Calendar.jsx` around lines 4119–4180 — trace what object is passed into `reviewModal.openModal` for (a) "This Event" branch (line ~4133) and (b) "All Events" branch (line ~4165); confirm whether the "This Event" branch currently re-reads master fields or uses the virtual occurrence
- [ ] 1.4 Locate the recurrence tab component — grep for `RecurrenceTabContent` or recurrence tab JSX, identify the container file and how `readOnly` can be threaded in (reuse existing prop chain if present)
- [ ] 1.5 Read `backend/utils/exceptionDocumentService.js` — confirm the exports `resolveSeriesMaster`, `createExceptionDocument`, `updateExceptionDocument`, `findExceptionForDate`, `_insertOccurrenceDocument`, and the `EVENT_TYPE` enum (lines 20–26). Note the existing thrown-error pattern (`{ statusCode, code, message }`) used by `resolveSeriesMaster` — `validateOccurrenceDateNotChanged` will follow the same shape. Also read the DELETE handler's exception branch at `api-server.js:24200–24391` to see how the `editScope: 'thisEvent'` cascade and `recurrence.exclusions` upkeep work, so the new guard integrates cleanly with the landed infrastructure.
- [ ] 1.6 Read `src/hooks/useReviewModal.jsx` at lines 455, 966, 1214 — verify the three current `occurrenceDate` extraction patterns described in design.md Decision 2b. Report the concrete field references at each site (e.g., `currentItem.start?.dateTime` vs `currentItem?.startDate || currentItem?.start?.dateTime?.split('T')[0]`) so the Section 4 diagnosis has a baseline to compare against.
- [ ] 1.7 Read `src/components/RecurrencePatternModal.jsx` (already verified during Phase 1 exploration) plus whatever component renders the recurrence tab on the review modal — grep for `RecurrencePatternModal` invocations and identify the parent tab container that owns the `readOnly` decision for Section 5.

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

## 4. PR 1 — Occurrence-date resolution bug fix (requirement B) — diagnosis-first

Phase-1 exploration confirmed `Calendar.jsx handleRecurringScopeSelected` at line 4190 already passes the clicked occurrence object with `editScope: 'thisEvent'`. The user's observed bug (clicked day shows the master's creation date) therefore lives downstream of the click handler. Per design.md Decision 2, diagnose the actual leak layer BEFORE writing the GREEN fix — otherwise we risk patching the wrong layer.

- [ ] 4.1 RED: add failing tests that assert on the **final rendered** `startDate` / `endDate` in the review modal (not just the intermediate handoff). Cover AC-B1 (click 4/22 + "This Event" → rendered `startDate` is `'2026-04-22'`), AC-B2 (exception doc override shows overridden date), AC-B3 ("All Events" from occurrence → master view uses series range from requirement A's transform). Tests should simulate a click on a virtual occurrence and inspect the form inputs after the modal opens.
- [ ] 4.2 Run scoped tests — confirm all three fail
- [ ] 4.3 **DIAGNOSE** the leak layer. Add temporary `console.log` (or a test-time capture) at three checkpoints to trace the occurrence object's `startDate` / `start.dateTime` as it flows through:
  - Checkpoint A: what `Calendar.jsx:4190` passes into `reviewModal.openModal`
  - Checkpoint B: what `useReviewModal` stores in its internal state (lines ~455, 966, 1214 neighborhood)
  - Checkpoint C: what `transformEventToFlatStructure` returns before the form binds to it
  - Checkpoint D: what `formData.startDate` resolves to at render time
  Run a failing test from 4.1 and record where the date first diverges from `'2026-04-22'`. Report the findings inline with the test output. **Do not write the GREEN code yet.**
- [ ] 4.4 GREEN (conditional on 4.3 diagnosis):
  - **If the leak is in `useReviewModal.jsx`:** normalize the three extraction sites (lines 455, 966, 1214) into a single helper (either inside the hook or exported from `src/utils/eventTransformers.js`) that prefers the virtual occurrence's own `startDate` / `start.dateTime` over any master-derived fallback. Apply to all three sites.
  - **If the leak is in `transformEventToFlatStructure`:** reorder precedence in `src/utils/eventTransformers.js` so a flat `startDate` or `start.dateTime` on the incoming event wins over `calendarData.startDate`. Add a unit test pinning the precedence.
  - **If the leak is in `RoomReservationFormBase.jsx`:** fix the `value=` binding or the derivation that chooses between `formData.startDate` and any alternative source for occurrences.
  The GREEN fix targets exactly the identified layer. Do not touch the other two — blind fixes will cause confusion later.
- [ ] 4.5 Normalize `occurrenceDate` extraction across the three `useReviewModal.jsx` sites (Decision 2b) independent of 4.4's outcome. Even if the display leak was elsewhere, the inconsistent extraction patterns at 455, 966, 1214 are a latent foot-gun worth removing now (small scope, shared test coverage).
- [ ] 4.6 Re-run scoped tests covering `RoomReservationFormBase`, `Calendar`, `useReviewModal`, and `eventTransformers` — all three B-requirement tests must now pass, and the Decision 2b helper has unit coverage.

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

## 8. PR 2 — Phase 2 backend verification (three occurrence-write sites)

- [ ] 8.1 Read the three thisEvent blocks:
  - `PUT /api/admin/events/:id` at `backend/api-server.js:22795` (handler begins line 22753) — thisEvent block spans ~22795–22840; `resolveSeriesMaster` at 22804; `findExceptionForDate` at 22828; `updateExceptionDocument` at 22831–22834; `createExceptionDocument` at 22836–22839.
  - `PUT /api/room-reservations/draft/:id` at `backend/api-server.js:14399` (handler begins line 14322) — thisEvent block spans ~14399–14445; `resolveSeriesMaster` at 14411; exception create/update at 14432–14445.
  - `POST /api/admin/events/:id/publish-edit` at `backend/api-server.js:21309` (handler begins line 21179) — thisEvent block spans ~21309–21371; `resolveSeriesMaster` at 21318; exception create/update at 21358–21371.
  Confirm the natural insertion point for the new `validateOccurrenceDateNotChanged` call is immediately after `resolveSeriesMaster` returns and before the exception write. Document the exact line numbers for each site.
- [ ] 8.2 Read `backend/utils/exceptionDocumentService.js` around the export list and around `resolveSeriesMaster`'s thrown-error shape. Confirm the existing pattern: throw `new Error(...)` augmented with `err.statusCode = 400; err.code = 'OrphanedException'` (etc.). The new `validateOccurrenceDateNotChanged` helper will follow the same shape with `code: 'DATE_IMMUTABLE'` so call sites can catch uniformly.
- [ ] 8.3 Review existing 400 envelope patterns for consistency — `VERSION_CONFLICT` response in `conflictSnapshotFields.js` / `concurrencyUtils.js`; `OrphanedException` / `MasterNotFound` / `InvalidEventType` thrown by `resolveSeriesMaster`. The 400 response body should be `{ error: code, message: ..., details?: ... }` to match the convention. Note whether the call sites currently standardize on `error` or `code` at the top level and follow that pattern.
- [ ] 8.4 Grep the frontend for all call sites that POST/PUT to the three occurrence-write endpoints with `editScope: 'thisEvent'` — likely `src/hooks/useReviewModal.jsx`, plus any approval/edit-request flow helpers. For each site, verify the payload construction sets `startDate === occurrenceDate` (and same for `endDate`). If any site sends divergent values, flag them for client-side fix BEFORE the server guard lands (per the Risk entry in design.md). If they all already match, the Risk is mitigated without code changes.
- [ ] 8.5 Confirm `PUT /api/room-reservations/:id/edit` (`backend/api-server.js:16304`) remains master-only — no `editScope` parsing, no call to `resolveSeriesMaster`, no `createExceptionDocument` / `updateExceptionDocument`. If an exception document's `_id` could somehow reach this endpoint (e.g., via a misbehaving client), make a note in Open Questions for a follow-up change — do NOT add defensive validation here as part of PR 2.

---

## 9. PR 2 — Occurrence date UI lock (requirement "Occurrence date inputs are disabled")

- [ ] 9.1 RED: add Vitest cases covering AC-D1 (startDate + endDate inputs have `disabled` attribute on occurrence view), AC-D2 (helper text visible and matches approved copy), AC-D3 (time inputs are NOT disabled on same view — regression guard)
- [ ] 9.2 Run scoped `npm run test:run -- RoomReservationFormBase` — confirm failures
- [ ] 9.3 GREEN: in `RoomReservationFormBase.jsx`, derive `isOccurrenceView` from event scope; apply `disabled={isOccurrenceView}` to startDate and endDate inputs; render helper text below date inputs with the final approved wording (see design doc Open Questions)
- [ ] 9.4 Re-run tests until green

---

## 10. PR 2 — Backend DATE_IMMUTABLE validation at three occurrence-write sites

- [ ] 10.1 RED: create `backend/__tests__/integration/occurrenceDateImmutability.test.js` covering every scenario in the "Server rejects occurrence date mutations" requirement:
  - AC-D4 primary: admin PUT thisEvent with mismatched `startDate` vs `occurrenceDate` → 400 `DATE_IMMUTABLE` + no exception written
  - AC-D4 coverage: same rejection shape at draft PUT + publish-edit
  - AC-D5: time-only edit (startTime changes, startDate matches occurrenceDate) → 200
  - AC-D6 part 1: same-value date re-send (body's `startDate === occurrenceDate`) → 200
  - "Omitted startDate/endDate in request body is accepted" scenario → 200
  - AC-D6 part 2: direct-API bypass on any of the three endpoints → same 400
  Use `createRecurringSeriesMaster` from `backend/__tests__/__helpers__/eventFactory.js`. Structure the tests so each endpoint has a describe block; share payload fixtures where possible.
- [ ] 10.2 Run scoped `cd backend && npm test -- occurrenceDateImmutability` — confirm every scenario fails
- [ ] 10.3 GREEN (helper): add `validateOccurrenceDateNotChanged(incomingBody, occurrenceDate)` to `backend/utils/exceptionDocumentService.js`. Colocate with `resolveSeriesMaster`. Implementation rules:
  - If `incomingBody.startDate` is present AND `incomingBody.startDate !== occurrenceDate`: throw `{ statusCode: 400, code: 'DATE_IMMUTABLE', message: <wording> }` (new `Error` with fields set, matching the pattern `resolveSeriesMaster` uses at lines ~28–36 of exceptionDocumentService.js).
  - Same check for `incomingBody.endDate`.
  - Omitted fields pass through (don't require presence).
  - No-op when `startDate === occurrenceDate` (both values match).
  - Export from the module alongside existing exports.
  - Write a unit-test file `backend/__tests__/unit/exceptionDocumentService.test.js` (or extend one if it exists) covering the helper in isolation before wiring into endpoints.
- [ ] 10.4 GREEN (admin PUT wiring): in `backend/api-server.js:22795` thisEvent block, insert the helper call immediately after `resolveSeriesMaster` returns (line 22804) and before `findExceptionForDate` / `createExceptionDocument` / `updateExceptionDocument` (lines 22828–22840). Wrap the call in try/catch that translates `err.statusCode`+`err.code`+`err.message` into the 400 response envelope per Section 8.3. Pass `updates.occurrenceDate` as the anchor and the full `updates` body (or relevant date-carrying fields) as `incomingBody`.
- [ ] 10.5 GREEN (draft PUT wiring): same integration at `backend/api-server.js:14399` thisEvent block — after `resolveSeriesMaster` at 14411, before exception create/update at 14432–14445. Pass `occurrenceDate` and the request body.
- [ ] 10.6 GREEN (publish-edit wiring): same integration at `backend/api-server.js:21309` thisEvent block — after `resolveSeriesMaster` at 21318, before exception create/update at 21358–21371. Note: for publish-edit, the anchor is `pendingEditRequest.occurrenceDate` (stored on the pending edit request), and the date-carrying fields are the *proposed* fields from the pending edit request body — not from the current PUT body. Verify the anchor source during wiring.
- [ ] 10.7 Mirror the same three wirings in `backend/__tests__/__helpers__/testApp.js` — the test harness must apply `validateOccurrenceDateNotChanged` at the same points so test parity is preserved (per CLAUDE.md / project convention).
- [ ] 10.8 Re-run `cd backend && npm test -- occurrenceDateImmutability exceptionDocumentService` until every RED test is green
- [ ] 10.9 Regression check: run `cd backend && npm test -- editConflict pendingEdit rejectedEdit recurringPublish publishConflict saveConflict editConflict` — these exercise adjacent occurrence-edit flows and publish-edit; expect all green, zero regressions

---

## 11. PR 2 — Scoped test suite verification

- [ ] 11.1 Frontend: `npm run test:run -- RoomReservationFormBase` — expect green
- [ ] 11.2 Backend: `cd backend && npm test -- occurrenceDateImmutability exceptionDocumentService editConflict pendingEdit rejectedEdit publishConflict saveConflict recurringPublish recurringConflict` — expect green, zero regressions across the adjacent occurrence-edit + recurring-event test surface
- [ ] 11.3 Do NOT run the full 523-test suite; scoped execution only per CLAUDE.md

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
