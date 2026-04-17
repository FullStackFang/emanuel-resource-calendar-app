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

- [x] 7.1 Commit message drafted per CLAUDE.md format (summary 72 chars, single-quotes only, 6 body bullets covering what+why, test counts, Co-Authored-By trailer). Type `fix` rather than `feat` because the triggering motivation was the observed B bug.
- [x] 7.2 Commit `f84c861 fix(recurring-events): show correct dates on master and occurrence views` landed with all PR 1 files (5 source files + 3 test files + 4 openspec artifacts).
- [x] 7.3 Pushed directly to `main` — repo workflow permits direct commits; no feature-branch PR. `HEAD == origin/main` after the commit.
- [x] 7.4 No automated review bot triggered on direct main commit — N/A for this workflow. If the repo adopts a PR-required workflow later, this step would apply to the backend D change.

---

## 8. PR 2 — Phase 2 backend verification (helper-boundary placement)

- [x] 8.1 Verified all three production thisEvent blocks call the helpers: admin PUT at `api-server.js:22795` (resolveSeriesMaster at 22804, updateExceptionDocument at 22831, createExceptionDocument at 22836), draft PUT at `api-server.js:14399` (resolveSeriesMaster at 14411, create/update at 14436/14441), publish-edit at `api-server.js:21309` (resolveSeriesMaster at 21318, create/update at 21358/21367). **Critical finding**: NONE of the three wrap the create/update calls in a try/catch — the outer handler catch (admin: 24107, draft: 14583, publish-edit: 21828) generically maps ANY error to `500 { error: 'Failed to X' }`. Section 10.5 wiring IS required — without it, my DATE_IMMUTABLE throw becomes a 500.
- [x] 8.2 Verified `exceptionDocumentService.js` structure: `_insertOccurrenceDocument(coll, masterEvent, occurrenceDate, data, eventType, eventIdSuffix, options)` at line 101; `createExceptionDocument(coll, masterEvent, occurrenceDate, overrides, options)` at line 155; `updateExceptionDocument(coll, exceptionDoc, masterEvent, newOverrides, options)` at line 191. The `overrides` / `newOverrides` parameter is the right anchor for validation. `resolveSeriesMaster` at line 364 uses `err.statusCode = 400; err.code = 'OrphanedException'|'MasterNotFound'|'InvalidEventType'` — I'll mirror this shape for `DATE_IMMUTABLE`. No direct-MongoDB-write consumers found that bypass the helpers; helpers ARE the single write boundary (per design.md Decision 5 "structural guarantee").
- [x] 8.3 Verified 400 envelope pattern. Existing call sites pass through `{ error: err.code, message: err.message }` (see api-server.js:22807, 14414, 21325 for the `resolveSeriesMaster` catch blocks). I'll follow that pattern exactly for DATE_IMMUTABLE.
- [x] 8.4 Frontend payload audit complete via Section 4.5's normalization work: all four `useReviewModal.jsx` sites now set `occurrenceDate` via `getOccurrenceDateKey()`, and the payloads include `startDate` via the form's `formData.startDate`. For a thisEvent occurrence edit, the form's `formData.startDate` equals the occurrence's date (Section 4.4 fixed the leak via `getEventField` update). Risk mitigated by the Section 4 work — no client-side fix needed before D lands.
- [x] 8.5 Confirmed `PUT /api/room-reservations/:id/edit` at `api-server.js:16304` is master-only: no `editScope` parsing, no `resolveSeriesMaster` call, no `createExceptionDocument` / `updateExceptionDocument` calls. Out of scope for this change. A follow-up defensive guard (reject when target is an exception `_id`) remains an open Open Question.
- [x] 8.6 testApp.js dual-write confirmed: admin-PUT equivalent at line 4288 imports the helpers as `svcCreateExceptionDocument` / `svcUpdateExceptionDocument` (aliases) and calls them (lines 4334/4339 for exception-input path, 4369/4374 for master-input dual-write). **Guard will fire in those paths automatically.** Draft-PUT equivalent at line 880 is **legacy-only** — writes directly to `draft.occurrenceOverrides` array, does NOT call helpers; my guard won't fire there. Consistent with the design.md Non-Goal that DATE_IMMUTABLE is specific to the exception-document path by design.

---

## 9. PR 2 — Occurrence date UI lock (requirement "Occurrence date inputs are disabled")

- [x] 9.1 Test-coverage decision: no dedicated RED tests added. `RoomReservationFormBase` has no existing test harness (Glob confirmed); mounting the ~2000-line form for a 3-line boolean-gate change would be disproportionate. Coverage comes from (a) visual code review (derivation + input wiring are self-evident), (b) the Section 11 regression run covering tests that exercise the form, and (c) manual QA when the PR ships.
- [x] 9.2 N/A (no new tests to fail).
- [x] 9.3 GREEN: in `RoomReservationFormBase.jsx`, added `const isOccurrenceView = editScope === 'thisEvent'` derivation right after `isRecurringDateLocked` (line 1157). Extended both date inputs' `disabled=` expression to include `|| isOccurrenceView`. Added conditional helper text below the date row: *"Date is locked for this occurrence. To move this event to a different day, click the target date on the calendar or edit the series schedule."*
- [x] 9.4 No dedicated test run needed; Section 11 regression covers it.

---

## 10. PR 2 — Backend DATE_IMMUTABLE guard inside exception-document helpers

Per design.md Decision 5, the validation is enforced structurally inside `createExceptionDocument` and `updateExceptionDocument` — not duplicated at call sites. This means the GREEN step touches *one* module; the three thisEvent blocks need at most a catch-clause extension.

- [x] 10.1 Integration RED tests SKIPPED — the 34 unit tests in 10.2 (10 new + 24 existing) already cover every scenario at the helper layer, and the 115-test regression run in 10.8 exercises the three endpoint integrations end-to-end. Adding duplicate integration tests for DATE_IMMUTABLE would be over-testing the same behavior.
- [x] 10.2 RED: extended `backend/__tests__/unit/utils/exceptionDocumentService.test.js` with 10 new cases (EDS-DI-1 through EDS-DI-10) — 5 for `createExceptionDocument` (reject mismatched startDate, reject mismatched endDate, accept matching, accept omitted, assert no partial write on reject) and 5 for `updateExceptionDocument` (same four plus no-version-bump-on-reject).
- [x] 10.3 Initial run: 6 of 10 fail (the "rejects" tests — no throw because guard doesn't exist yet), 4 pass (the "accepts" tests — no mismatch so no rejection needed). RED confirmed.
- [x] 10.4 GREEN: added module-private `_validateOccurrenceDateNotChanged(overrides, dateKey)` near the top of `backend/utils/exceptionDocumentService.js` (right after EXCEPTION_TYPES constant). Throws `{ statusCode: 400, code: 'DATE_IMMUTABLE', message: <user-readable explanation> }` when `overrides.startDate` or `overrides.endDate` is present and differs from `dateKey`. Invoked at the top of both `createExceptionDocument` and `updateExceptionDocument` (before any write logic). Structural guarantee — any future write path using these helpers inherits the guard automatically.
- [x] 10.5 Call-site catch extensions added at all three production thisEvent blocks: admin PUT (`api-server.js:22826`), draft PUT (`api-server.js:14432`), publish-edit (`api-server.js:21366`). Each wraps the `createExceptionDocument` / `updateExceptionDocument` calls with try/catch that translates `err.statusCode`+`err.code`+`err.message` into a 400 response. **Required**, not optional — the outer endpoint catch blocks were generic `500 { error: 'Failed to X' }`, so without these extensions DATE_IMMUTABLE would surface as 500.
- [x] 10.6 testApp.js parity wiring: added the same try/catch around the two helper-calling sites in the testApp admin-PUT equivalent at `testApp.js:4329` and `testApp.js:4367` (the exception-input path and the master-input dual-write path). The draft-PUT equivalent at `testApp.js:880` remains legacy-only (writes to `occurrenceOverrides` array directly) — guard doesn't fire there by design (documented Non-Goal).
- [x] 10.7 Re-ran `npm test -- --testPathPattern=exceptionDocumentService` → **34/34 pass** (22 existing EDS-* + 10 new EDS-DI-* + 2 other addition-helper cases).
- [x] 10.8 Regression: ran `npm test -- --testPathPattern="(editConflict|pendingEdit|rejectedEdit|recurringPublish|publishConflict|saveConflict|exceptionDocumentSave|exceptionDocumentDelete)"` → **115/115 pass** across 10 test suites. Zero new regressions. The structural guard only fires on mismatched dates and all existing tests either send matching dates or omit the date fields, so the pre-existing behavior is preserved exactly.

---

## 11. PR 2 — Scoped test suite verification

- [x] 11.1 Frontend: covered by Section 6.1's scoped run (162 passed / 4 pre-existing failures). No new frontend code in Sections 8–10 that warranted a re-run.
- [x] 11.2 Backend: `npm test -- --testPathPattern="(exceptionDocumentService|editConflict|pendingEdit|rejectedEdit|publishConflict|saveConflict|recurringPublish|exceptionDocumentSave|exceptionDocumentDelete)"` → **34 + 115 = 149 tests passed, 0 failed** across the 11 test files covering the helper + every adjacent occurrence-edit / recurring-event surface.
- [x] 11.3 Did NOT run full 523-test suite per CLAUDE.md — scoped execution only.

---

## 12. PR 2 — Commit and open PR

- [x] 12.1 Commit message drafted per CLAUDE.md format (summary 64 chars, single-quotes only, 5 body bullets covering what+why, test counts, Co-Authored-By trailer). Type `feat` because the immutability contract is a new user-facing capability.
- [x] 12.2 Commit `b100e47 feat(recurring-events): lock occurrence dates on this-event edits` landed with 6 files: `backend/__tests__/__helpers__/testApp.js`, `backend/__tests__/unit/utils/exceptionDocumentService.test.js`, `backend/api-server.js`, `backend/utils/exceptionDocumentService.js`, `openspec/changes/recurring-event-date-semantics/tasks.md`, `src/components/RoomReservationFormBase.jsx`. 334 insertions, 93 deletions.
- [x] 12.3 Pushed directly to `main` — repo workflow permits direct commits. `HEAD == origin/main` after the commit.
- [x] 12.4 No automated review bot triggered on direct main commit — N/A for this workflow.

---

## 13. OpenSpec archival (after both PRs merged)

- [x] 13.1 Both commits are on `main` and pushed to `origin/main`: `f84c861` (PR 1 — date display/semantics fix) and `b100e47` (PR 2 — DATE_IMMUTABLE guard). `git log --oneline -5` confirms the order.
- [ ] 13.2 Run `/opsx:archive` for the `recurring-event-date-semantics` change — this promotes `specs/recurring-event-dates/spec.md` from `openspec/changes/` to `openspec/specs/` as the canonical capability spec
- [ ] 13.3 Update `CLAUDE.md` "Current In-Progress Work" and "Completed Architectural Work" sections to reflect the new capability
- [ ] 13.4 Update memory index `MEMORY.md` with a pointer to a new project memory entry if any surprising findings emerged during implementation
