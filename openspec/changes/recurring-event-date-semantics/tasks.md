## 1. Phase 2 — Codebase Verification (COMPLETE — findings captured inline)

All seven verification tasks are complete from the `/opsx:apply` Phase-2 exploration. Findings below supersede the line-number hints in later sections where they conflict.

- [x] 1.1 `src/components/RoomReservationFormBase.jsx` — date input JSX at lines 1604–1645. `startDate` input at 1614–1622 with `value={formData.startDate}`, `disabled={fieldsDisabled || isRecurringDateLocked}`. `endDate` input at 1635–1643, same pattern. Label is `{recurrencePattern ? 'Start Date' : 'Event Date'}` at line 1606. **No display transform exists** — raw `formData.*` is used directly. This is the insertion point for A.
- [x] 1.2 `src/utils/eventTransformers.js:121–200` — `transformEventToFlatStructure` has a strict `isAlreadyFlat` check at line 126: `startDate !== undefined && !event.start?.dateTime && !event.graphData?.start?.dateTime`. **Both conditions must hold.** If a virtual occurrence has BOTH flat `startDate` AND `start.dateTime` set by calendar expansion, `isAlreadyFlat` is **false** and the transformer falls through to the Graph-parsing branch, which may re-read master-derived datetimes. This is a **strong candidate for the B leak**.
- [x] 1.3 `src/components/Calendar.jsx:4107–4196` — `handleEventClick` opens scope dialog for recurring events. `handleRecurringScopeSelected` at line 4155: "allEvents" branch fetches master (line 4177–4180); "thisEvent" / non-occurrence branch at line 4190 passes the clicked event directly: `reviewModal.openModal(event, { editScope: scope })`. **Click handler is correct** — the leak is downstream, consistent with design.md Decision 2.
- [x] 1.4 Recurrence tab component is `src/components/RecurrenceTabContent.jsx`. **`readOnly` prop already exists at line 61** (`readOnly = false`). Line 130: `const canEdit = !readOnly && editScope !== 'thisEvent';`. Used via ~30 `disabled={!canEdit}` / `{canEdit && (...)}` conditionals throughout. **Current behavior when `canEdit === false`: all inputs are rendered but `disabled`** — NOT replaced with a plain-text summary. Spec C1 asserts no editable inputs should be "present on the tab" → implementation gap.
- [x] 1.5 `backend/utils/exceptionDocumentService.js` verified:
  - `EVENT_TYPE` enum at lines 20–26 (singleInstance/seriesMaster/occurrence/exception/addition)
  - `_insertOccurrenceDocument(coll, masterEvent, occurrenceDate, data, eventType, eventIdSuffix, options)` at line 101
  - `createExceptionDocument(coll, masterEvent, occurrenceDate, overrides, options)` at line 155 ← insertion point for D validation
  - `updateExceptionDocument(coll, exceptionDoc, masterEvent, newOverrides, options)` at line 191 ← insertion point for D validation
  - `findExceptionForDate(coll, seriesMasterEventId, occurrenceDate)` at line 231
  - `resolveSeriesMaster(coll, event)` at line 364 (thrown-error pattern: `new Error(...)` + `err.statusCode = 400`, `err.code = 'OrphanedException'|'MasterNotFound'|'InvalidEventType'`)
  - `mergeDefaultsWithOverrides` at line 67 **forcibly overwrites** `effective.startDate = occurrenceDate` and `effective.endDate = occurrenceDate` (lines 84–85) regardless of what was in `overrides`. This means the current write path **silently ignores** mismatched dates — exactly the "silent data loss" path design.md Decision 5 rejected. D validation will convert the silent ignore into a loud 400.
- [x] 1.6 `src/hooks/useReviewModal.jsx` extraction sites found at lines **459, 971, 1223** (drift from planned 455/966/1214) with divergent patterns:
  - 459 (save): `editScope === 'thisEvent' ? (currentItem.occurrenceDate || currentItem.start?.dateTime) : null`
  - 971 (delete): same 2-arg fallback as 459
  - 1223 (edit request): 3-arg fallback `(currentItem?.occurrenceDate || currentItem?.startDate || currentItem?.start?.dateTime?.split('T')[0])`
  - **Also a 4th site at line 1624**: `payload.occurrenceDate = currentItem?.startDate || currentItem?.start?.dateTime?.split('T')[0]` — missing `currentItem.occurrenceDate` preference entirely. Decision 2b normalization should cover all four sites.
- [x] 1.7 `formatRecurrenceSummary(pattern, range)` **already exists** at `src/utils/recurrenceUtils.js:430` — and `formatRecurrenceSummaryEnhanced(pattern, range, additions, exclusions)` at line 520 handles the additions/exclusions tail. Used by `RecurrenceTabContent.jsx:12` import and `RecurrencePatternModal.jsx`. Existing test file at `src/__tests__/unit/utils/recurrenceUtils.test.js`. **Current format:** `"Occurs every M, W\nUntil Mar 4, 2026"` (single-letter day abbrevs, newline separator, "Until" phrasing) — does NOT match spec C2 scenarios which assert on `"Weekly on Wednesdays, 4/15/2026 – 4/30/2026"` (EN-DASH, full day names, "Weekly on" phrasing). **Implementation gap** — resolved in Section 2 revision.

---

## 2. PR 1 — Recurrence summary formatter (LOCKED IN: Option C — new parallel formatter)

Decision locked 2026-04-16: add a new `formatRecurrenceSummaryCompact(pattern, range, additions, exclusions)` alongside the existing `formatRecurrenceSummary` in `recurrenceUtils.js`. Existing function untouched; existing consumers (`RecurrenceTabContent` editor tab, `RecurrencePatternModal`) keep their current "Occurs every M, W\nUntil Mar 4, 2026" phrasing. The new compact variant is used only by the read-only recurrence tab on occurrence views (Section 5).

Rationale: cleaner UX on the occurrence read-only view ("Weekly on Wednesdays, 4/15/2026 – 4/30/2026") without disturbing two other UI surfaces where the existing phrasing is already shipped and understood. Tech-debt acknowledgment: two similar formatters will coexist; JSDoc comments on each will distinguish their use cases so future contributors pick correctly.

- [x] 2.1 RED tests written in `src/__tests__/unit/utils/recurrenceFormattersCompact.test.js` — 26 cases across 5 describe groups (pattern rendering / range rendering / additions+exclusions tail / full-string format guarantees / edge cases).
- [x] 2.2 Initial run: all 26 fail with `TypeError: formatRecurrenceSummaryCompact is not a function`. RED confirmed.
- [x] 2.3 GREEN: added `formatRecurrenceSummaryCompact(pattern, range, additions = [], exclusions = [])` as new export in `src/utils/recurrenceUtils.js` (appended below `extractOccurrenceOverrideFields`). Supporting module-local helpers: `DAY_PLURAL_NAMES`, `MONTH_NAMES`, `joinListNaturally`, `parseLocalDateStr`, `formatCompactDate`. Pure synchronous function; `toLocaleDateString('en-US')` with no timezone option; EN-DASH `\u2013` separator.
- [x] 2.4 JSDoc comments added to BOTH formatters distinguishing their use cases: `formatRecurrenceSummary` → editable editor tab / pattern modal; `formatRecurrenceSummaryCompact` → read-only occurrence view. Each references the other via `@link`.
- [x] 2.5 Re-ran `npm run test:run -- recurrenceFormattersCompact` — all 26 tests pass on first compile, no iteration needed.
- [x] 2.6 Regression check: `recurrenceUtils.test.js` (33 tests) passes clean. `RecurrenceTabContent.test.jsx` has one pre-existing failure at line 316 ("Start Time" detail panel test) — confirmed pre-existing by stashing my changes and re-running: same failure present on clean `main`, unrelated to this change. **Zero new regressions from Section 2.**

---

## 3. PR 1 — Series master display transform (requirement A)

- [x] 3.1 RED: decided to test the transform at the helper level rather than via component rendering (avoids mounting the ~2000-line form). Added 8 new tests in `src/__tests__/unit/utils/eventTransformers.test.js` under `describe('getSeriesMasterDisplayDates', ...)` covering AC-A1/A2 (master shows recurrence.range dates), AC-A3 (singleInstance falls back), occurrence fallback, missing-range fallback, partial-range fallback, null-guard.
- [x] 3.2 Initial run: 9 of the 11 new test cases fail with `TypeError: getSeriesMasterDisplayDates is not a function` / import error. RED confirmed.
- [x] 3.3 GREEN: added `getSeriesMasterDisplayDates(reservation, recurrencePattern, formData)` export to `src/utils/eventTransformers.js` (appended after `sortEventsByStartTime`). Wired into `src/components/RoomReservationFormBase.jsx`: imported the helper at the top of the file; derived `{ displayStartDate, displayEndDate }` right after `isRecurringDateLocked` (line 1154+); updated both `DatePickerInput` `value=` bindings to use the derived values instead of raw `formData.startDate` / `formData.endDate`. Underlying form state and save paths untouched.
- [x] 3.4 Re-ran `npm run test:run -- eventTransformers.test` — all 8 getSeriesMasterDisplayDates tests pass. 3 unrelated pre-existing failures remain in the file (see 3.5).
- [x] 3.5 Regression check: the 3 pre-existing failures (`Reservation format > transforms reservation event with graphData correctly`, `Series/recurrence data > defaults eventType to singleInstance...`, `calendarData structure support > reads fields from calendarData when present`) are confirmed pre-existing on clean `main` via `git stash + re-run`. Zero new regressions from Section 3.

---

## 4. PR 1 — Occurrence-date resolution bug fix (requirement B) — diagnosis-first

Phase-1 exploration confirmed `Calendar.jsx handleRecurringScopeSelected` at line 4190 already passes the clicked occurrence object with `editScope: 'thisEvent'`. The user's observed bug (clicked day shows the master's creation date) therefore lives downstream of the click handler. Per design.md Decision 2, diagnose the actual leak layer BEFORE writing the GREEN fix.

**Leading hypothesis from Task 1.2:** `transformEventToFlatStructure` (`eventTransformers.js:121–163`) has a strict `isAlreadyFlat` gate at line 126: `startDate !== undefined && !event.start?.dateTime && !event.graphData?.start?.dateTime`. **Both conditions must hold** to preserve flat fields. If a calendar-expanded virtual occurrence carries `startDate = '2026-04-22'` AND `start.dateTime = '2026-04-22T09:00'`, `isAlreadyFlat === false` and the transformer drops into the Graph-parsing branch (lines 135–162), which may pull master-derived datetimes via `getEventField(event, 'startDateTime')`. This exactly matches the user's symptom. Confirm via diagnostic capture before assuming.

- [x] 4.1 RED tests written as targeted diagnostic in `src/__tests__/unit/utils/eventTransformers.test.js` under `describe('requirement B — virtual occurrence date resolution', ...)`. 3 cases using a `buildVirtualOccurrence()` helper that mirrors Calendar.jsx lines 1860–1880's occurrence shape (flat fields + Graph-shape + inherited master `calendarData`). Tests assert the resolved `startDate` / `startTime` / `endTime` match the clicked day, not master values.
- [x] 4.2 Initial run: 2 of 3 fail with `expected '2026-04-15' to be '2026-04-22'` — master's first-occurrence date leaked into the form. 1 passed (the override regression guard). RED confirmed.
- [x] 4.3 Diagnosis: the leak is in `getEventField` at `eventTransformers.js:38`. The `isRecurringOccurrence && hasOccurrenceOverride` conjunct means only OVERRIDDEN occurrences get top-level priority. Non-overridden virtual occurrences fall through to `calendarData`, which carries master values via `...event` spread during Calendar.jsx expansion. Secondary leak at line 171: `if (event.calendarData)` block unconditionally overwrites parsed times with `calendarData.startTime`/`endTime`, same master-leak pattern.
- [x] 4.4 GREEN: (a) in `getEventField`, changed line 38 from `if (event.isRecurringOccurrence && event.hasOccurrenceOverride)` to `if (event.isRecurringOccurrence)` — top-level wins for ANY virtual occurrence; (b) in the calendarData-time-preference block at line 171, added `&& !event.isRecurringOccurrence` guard so virtual occurrences keep their parsed (occurrence-specific) times. Updated inline comments to document the occurrence-vs-master semantics.
- [x] 4.5 Normalized occurrenceDate extraction via new `getOccurrenceDateKey(item)` export in `eventTransformers.js`. Returns canonical YYYY-MM-DD (strips any `T…` suffix). Preference order: `item.occurrenceDate` → `item.startDate` → `item.start?.dateTime`. Added 9 unit tests. Wired into all **four** sites in `src/hooks/useReviewModal.jsx` (lines 459, 971, 1223, and 1624 — the fourth site was previously missing the `occurrenceDate` preference entirely, now consistent).
- [x] 4.6 Scoped run: `npm run test:run -- eventTransformers.test recurrenceFormattersCompact RecurrenceTabContent` → 125 passed / 4 failed. All 4 failures are pre-existing on clean `main` (3 in eventTransformers, 1 in RecurrenceTabContent at line 316) — confirmed by prior stash-based check. Zero new regressions from Section 4.

---

## 5. PR 1 — Read-only recurrence tab on occurrence view (REVISED — prop exists, behavior gap remains)

Task 1.4 found that `RecurrenceTabContent.jsx:61` already accepts `readOnly = false` and line 130 derives `canEdit = !readOnly && editScope !== 'thisEvent'`. About 30 call sites gate write actions with `{canEdit && ...}` or `disabled={!canEdit}`. **But when `canEdit === false`, the editor JSX (frequency dropdown, day-of-week checkboxes, range pickers, additions/exclusions calendar) is still rendered, just disabled** — spec C1 says those inputs should not be present on the tab at all. The implementation gap is the **render-replacement**, not the prop plumbing.

- [x] 5.1 RED: added new describe block `readOnly / occurrence view (requirement C)` at the end of `src/__tests__/unit/components/RecurrenceTabContent.test.jsx` with 4 tests: AC-C1 (editScope=thisEvent → summary present, no mock-datepicker, no `.recurrence-tab-right`), readOnly-prop variant, AC-C3 regression (no editScope + readOnly=false → full editor renders with mock-datepicker), and additions/exclusions tail visibility.
- [x] 5.2 Initial run: 3 of 4 new tests fail (no `.recurrence-readonly-summary` element); the AC-C3 regression guard passes (full editor already present). RED confirmed.
- [x] 5.3 GREEN: added `formatRecurrenceSummaryCompact` to the existing recurrenceUtils import (left `formatRecurrenceSummary` alone per Option C). Added an early-return `if (!canEdit)` branch at the top of main render that renders `<div className="recurrence-tab-management recurrence-tab-management--readonly"><p className="recurrence-readonly-summary">{...compact summary...}</p></div>` — no editor JSX, no calendar, no occurrence list. The existing editable-path render is unchanged.
- [x] 5.4 Re-ran `npm run test:run -- RecurrenceTabContent` — 36 passed / 1 failed. The 1 failure is the pre-existing `Start Time` test at line 316 (same as before Section 2 — confirmed pre-existing on clean main). All 4 new readOnly tests pass.
- [x] 5.5 Regression check: no separate `RoomReservationReview` test file exists (Glob returned none); the RecurrenceTabContent test file IS the regression surface, and 32 of its 33 pre-existing tests continue to pass (the 1 failure was pre-existing). No DOM-shape tests anywhere else would pick up the readonly summary since it only renders for occurrence-scope views.

---

## 6. PR 1 — Scoped test suite verification

- [x] 6.1 Ran `npm run test:run -- recurrenceFormattersCompact eventTransformers.test RecurrenceTabContent recurrenceUtils.test` → **162 passed / 4 failed** across 4 test files. All 4 failures are pre-existing on clean `main` (3 in eventTransformers, 1 in RecurrenceTabContent line 316). Zero new regressions from Sections 2–5.
- [x] 6.2 Ran `npm run lint` and filtered errors to the 8 files touched by this change (recurrenceUtils.js, eventTransformers.js, RoomReservationFormBase.jsx, RecurrenceTabContent.jsx, useReviewModal.jsx, and the 3 test files). All errors shown in those files are pre-existing baseline issues (unused imports, hook-dep warnings, etc.) — none introduced by this PR. The new `recurrenceFormattersCompact.test.js` file has zero lint errors.
- [x] 6.3 Did NOT run the full 523-test backend suite (per CLAUDE.md) — PR 1 is frontend-only, no backend touchpoints.

---

## 7. PR 1 — Commit and open PR

- [ ] 7.1 Draft commit message per CLAUDE.md `feat(scope): summary` format — keep summary ≤ 72 chars, no double quotes in commit text, include test counts, include `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
- [ ] 7.2 Create commit with only the PR 1 files (no PR 2 changes staged)
- [ ] 7.3 Push branch, open PR with bulleted summary of requirements satisfied (A-series, B-series, C-series)
- [ ] 7.4 Wait for automated bot review, resolve every finding (fix or justify), continue until bot returns a clean status

---

## 8. PR 2 — Phase 2 backend verification (helper-boundary placement)

- [ ] 8.1 Read the three thisEvent blocks to confirm they all call `createExceptionDocument` / `updateExceptionDocument`:
  - `PUT /api/admin/events/:id` at `backend/api-server.js:22795` (handler begins line 22753) — thisEvent block spans ~22795–22840; `resolveSeriesMaster` at 22804; `findExceptionForDate` at 22828; `updateExceptionDocument` at 22831–22834; `createExceptionDocument` at 22836–22839.
  - `PUT /api/room-reservations/draft/:id` at `backend/api-server.js:14399` (handler begins line 14322) — thisEvent block spans ~14399–14445; `resolveSeriesMaster` at 14411; exception create/update at 14432–14445.
  - `POST /api/admin/events/:id/publish-edit` at `backend/api-server.js:21309` (handler begins line 21179) — thisEvent block spans ~21309–21371; `resolveSeriesMaster` at 21318; exception create/update at 21358–21371.
  Confirm each block's existing try/catch already handles thrown errors with `err.statusCode` + `err.code` + `err.message` (from `resolveSeriesMaster`). Since the DATE_IMMUTABLE guard will be enforced *inside* the helpers, the call sites themselves need no new validation code — at most a catch-clause extension to translate `DATE_IMMUTABLE` into the 400 response envelope (or, if the existing catch is generic enough, no change at all).
- [ ] 8.2 Read `backend/utils/exceptionDocumentService.js` around `_insertOccurrenceDocument`, `createExceptionDocument`, and `updateExceptionDocument`. Confirm each receives `dateKey` and a proposed-overrides object. Confirm the thrown-error pattern `resolveSeriesMaster` uses (`new Error()` with `err.statusCode = 400; err.code = 'OrphanedException'`) — the new `_validateOccurrenceDateNotChanged` will follow the same shape with `code: 'DATE_IMMUTABLE'`. Verify the helpers' call-site tree: if any consumer bypasses them and writes directly to MongoDB, flag it — the helper-level guard would not protect such a path and we'd either need an additional downstream guard or a direct-write deprecation.
- [ ] 8.3 Review existing 400 envelope patterns for consistency — `VERSION_CONFLICT` response in `conflictSnapshotFields.js` / `concurrencyUtils.js`; `OrphanedException` / `MasterNotFound` / `InvalidEventType` thrown by `resolveSeriesMaster`. The 400 response body should be `{ error: code, message: ..., details?: ... }` to match the convention. Note whether call sites currently standardize on `error` or `code` at the top level and follow that pattern.
- [ ] 8.4 Grep the frontend for all call sites that POST/PUT to the three occurrence-write endpoints with `editScope: 'thisEvent'` — likely `src/hooks/useReviewModal.jsx`, plus any approval/edit-request flow helpers. For each site, verify the payload construction sets `startDate === occurrenceDate` (and same for `endDate`). If any site sends divergent values, flag them for client-side fix BEFORE the server guard lands (per the Risk entry in design.md). If they all already match, the Risk is mitigated without code changes.
- [ ] 8.5 Confirm `PUT /api/room-reservations/:id/edit` (`backend/api-server.js:16304`) remains master-only — no `editScope` parsing, no call to `resolveSeriesMaster`, no `createExceptionDocument` / `updateExceptionDocument`. If an exception document's `_id` could somehow reach this endpoint (e.g., via a misbehaving client), make a note in Open Questions for a follow-up change — do NOT add defensive validation here as part of PR 2.
- [ ] 8.6 Inspect `backend/__tests__/__helpers__/testApp.js` dual-write behavior (per post-mortem tech debt): identify whether the test harness routes writes through `createExceptionDocument` / `updateExceptionDocument` or has its own direct path. If routing through the helpers, the DATE_IMMUTABLE guarantee applies to testApp.js automatically and no parity wiring is needed. If there are direct-write paths, document which and decide whether PR 2 adds guards there or leaves them to the future dual-write retirement (see design.md Non-Goals).

---

## 9. PR 2 — Occurrence date UI lock (requirement "Occurrence date inputs are disabled")

- [ ] 9.1 RED: add Vitest cases covering AC-D1 (startDate + endDate inputs have `disabled` attribute on occurrence view), AC-D2 (helper text visible and matches approved copy), AC-D3 (time inputs are NOT disabled on same view — regression guard)
- [ ] 9.2 Run scoped `npm run test:run -- RoomReservationFormBase` — confirm failures
- [ ] 9.3 GREEN: in `RoomReservationFormBase.jsx`, derive `isOccurrenceView` from event scope; apply `disabled={isOccurrenceView}` to startDate and endDate inputs; render helper text below date inputs with the final approved wording (see design doc Open Questions)
- [ ] 9.4 Re-run tests until green

---

## 10. PR 2 — Backend DATE_IMMUTABLE guard inside exception-document helpers

Per design.md Decision 5, the validation is enforced structurally inside `createExceptionDocument` and `updateExceptionDocument` — not duplicated at call sites. This means the GREEN step touches *one* module; the three thisEvent blocks need at most a catch-clause extension.

- [ ] 10.1 RED: create `backend/__tests__/integration/occurrenceDateImmutability.test.js` covering every scenario in the "Server rejects occurrence date mutations" requirement, spanning all three endpoints to verify the guarantee is endpoint-agnostic:
  - AC-D4 primary: admin PUT thisEvent with mismatched `startDate` vs `occurrenceDate` → 400 `DATE_IMMUTABLE` + no exception written
  - AC-D4 coverage: same rejection shape at draft PUT + publish-edit
  - AC-D5: time-only edit (startTime changes, startDate matches occurrenceDate) → 200
  - AC-D6 part 1: same-value date re-send (body's `startDate === occurrenceDate`) → 200
  - "Omitted startDate/endDate in request body is accepted" scenario → 200
  - AC-D6 part 2: direct-API bypass on any of the three endpoints → same 400
  Use `createRecurringSeriesMaster` from `backend/__tests__/__helpers__/eventFactory.js`. Structure the tests so each endpoint has a describe block; share payload fixtures where possible.
- [ ] 10.2 RED (unit-level): create or extend `backend/__tests__/unit/exceptionDocumentService.test.js` with isolated cases for the validation behavior — calling `createExceptionDocument` and `updateExceptionDocument` with mismatched `overrides.startDate` vs `dateKey` and asserting the thrown error shape (`statusCode: 400`, `code: 'DATE_IMMUTABLE'`). This exercises the guard without any HTTP layer.
- [ ] 10.3 Run scoped `cd backend && npm test -- occurrenceDateImmutability exceptionDocumentService` — confirm every scenario fails (integration + unit)
- [ ] 10.4 GREEN: inside `backend/utils/exceptionDocumentService.js`, add a module-private helper `_validateOccurrenceDateNotChanged(overrides, dateKey)` that:
  - Throws `{ statusCode: 400, code: 'DATE_IMMUTABLE', message: <wording> }` when `overrides?.startDate !== undefined && overrides.startDate !== dateKey`
  - Same check for `overrides.endDate`
  - No-op on omitted fields (only validates when `overrides.startDate` or `overrides.endDate` is actually present)
  - Throws using `new Error(...)` with `err.statusCode = 400; err.code = 'DATE_IMMUTABLE'` — matching the existing `resolveSeriesMaster` error-shape pattern (see lines ~28–36 of the same module)
  Invoke the helper at the top of `createExceptionDocument` and at the top of `updateExceptionDocument`, before any write logic, so every caller — present and future — inherits the guarantee structurally. The helper is not exported (underscore prefix); unit tests exercise it through the public helpers.
- [ ] 10.5 Call-site catch extension (minimal): in each of the three thisEvent blocks (`api-server.js:22795`, `14399`, `21309`), confirm that the existing try/catch around `createExceptionDocument` / `updateExceptionDocument` properly surfaces `err.statusCode` + `err.code` + `err.message` as the 400 response. If the current catch does this generically (per `resolveSeriesMaster`'s error pattern), no change is needed. If it hard-codes specific codes, add `DATE_IMMUTABLE` to the passthrough list. This is a read-and-verify step, not a wiring step — the helpers do the validation.
- [ ] 10.6 testApp.js parity check: `backend/__tests__/__helpers__/testApp.js` — per Section 8.6, if testApp routes writes through the production helpers, the guarantee applies automatically with zero changes. If testApp has direct-write paths (known tech debt: dual-write to `occurrenceOverrides` arrays), confirm those direct paths are NOT tested for DATE_IMMUTABLE by the tests in 10.1 — the guarantee is specific to the exception-document helper path by design (see design.md Non-Goals entry on dual-write retirement).
- [ ] 10.7 Re-run `cd backend && npm test -- occurrenceDateImmutability exceptionDocumentService` until every RED test is green
- [ ] 10.8 Regression check: run `cd backend && npm test -- editConflict pendingEdit rejectedEdit recurringPublish publishConflict saveConflict exceptionDocumentSave exceptionDocumentDelete` — these exercise adjacent occurrence-edit flows, publish-edit, and the Bug-A/Bug-B tests that already shipped. Expect all green; zero regressions, because the helpers' new validation only fires on mismatched dates and all existing tests send `overrides.startDate === dateKey` (or omit the fields).

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
