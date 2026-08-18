# Tasks: Save Conflict Delta Gate

Test-first throughout (write the failing case, then implement). Backend
suites run in isolation — never the full suite. Main is red (see CLAUDE.md
"Testing"); measure the baseline of every touched suite by stash before
blaming a change.

## 0. Already shipped (commit 584bc9d)

- [x] 0.1 `ReviewModal` Save no longer disabled by `hardConflictBlocks`;
      Approve/Publish keeps the gate. `ReviewModal.saveConflictGate.test.jsx`
      SCG-1..4.
- [x] 0.2 `useReviewModal.handleSave` hard-409 toast prefers `data.message`,
      no dead 'force override' hint.
- [x] 0.3 proposal.md / design.md Rev 2 (post architecture review).

## 1. Baseline

- [x] 1.1 Record pre-change counts (clean tree). Measured 2026-08-17 on `main`
      (red baseline — see CLAUDE.md "Testing"). `conflictTier.test.js` does NOT
      exist; `thisEvent` coverage lives in adminOccurrenceEdit / ownerOccurrenceEdit /
      draftOccurrenceEdit / occurrenceOverridePersistence.
      Combined 8-suite run (editConflict, recurringConflict, publishRecurringConflict,
      saveConflict, adminOccurrenceEdit, ownerOccurrenceEdit,
      occurrenceOverridePersistence, draftOccurrenceEdit):
      **36 failed / 45 passed / 81 total; 4 failed suites, 4 passed.**
      - editConflict (EC-1..4): **ALL 4 FAIL at baseline with 403, not 409** —
        the owner-edit route returns 403 before the conflict check (pre-existing
        auth-helper drift, NOT conflict logic). Design's "EC-1..4 must stay 409"
        assumed a green baseline; reality is 403. Goal for this change: no
        regression (stay 403), not turn them green.
      - Failing suites: editConflict, adminOccurrenceEdit, draftOccurrenceEdit,
        occurrenceOverridePersistence. Passing: recurringConflict,
        publishRecurringConflict, saveConflict, ownerOccurrenceEdit.
      - Frontend `ReviewModal.saveConflictGate.test.jsx`: **4 passed.**

## 2. Pure helper — `backend/utils/conflictDelta.js`

- [x] 2.1 Write `backend/__tests__/unit/conflictDelta.test.js` (CD-1..):
      String-normalised ids (ObjectId vs string equal); per-room intersection
      with `requestRoomIds`; non-master entry key `${id}::${room}`;
      master-derived entry key adds `::${occurrenceStartDateTime}`;
      recurring key `${occurrenceDate}::${id}::${room}`;
      `introducedConflicts` returns proposed entries whose key set is not a
      subset of baseline keys, and a `preexisting` list for the rest; empty
      baseline → everything introduced; identical sets → nothing.
- [x] 2.2 Implement `conflictKey(entry, requestRoomIds)` and
      `introducedConflicts(baselineHard, proposedHard, requestRoomIds)`
      (pure, no db, deps-free like `concurrencyRules.js`).

## 3. Checker result shapes (additive)

- [x] 3.1 Test: `checkRoomConflicts()` master occurrence qualifier — DEVIATION:
      function is unexported (house pattern drives internals via endpoints, see
      recurringConflict.test.js:596); locked end-to-end by SCG-3 in
      saveConflictDelta.test.js instead of a brittle internal harness. Original:
      carries `occurrenceStartDateTime` equal to the overlapping occurrence,
      not the master's stored series start (extend `conflictTier.test.js` or
      a new `conflictShape.test.js`).
- [x] 3.2 Implement: keep `_occurrenceStartDateTime` through to
      `publishedConflictResults` (~api-server.js 2918) as
      `occurrenceStartDateTime` (undefined for non-master entries).
- [x] 3.3 Test: `checkRecurringRoomConflicts()` per-date `hardConflicts[]`
      entries carry `rooms` (ObjectIds) next to `roomNames`.
- [x] 3.4 Implement in both push sites (~3100 single, ~3120 master) from
      `conflict.calendarData?.locations`. Confirm `flattenRecurringConflicts`
      spreads it through unchanged.

## 4. `PUT /api/admin/events/:id` — general branch

- [x] 4.1 New suite `backend/__tests__/integration/events/saveConflictDelta.test.js`
      (use `createAppForTest`, not testApp.js — see memory
      `two-backend-test-harnesses`). Cases from design.md "Test plan":
      SCG-1 (drop colliding room → 200), SCG-2 (introduce → 409 `deltaGate`,
      `hardConflicts` = introduced only, `preexistingConflicts` present),
      SCG-3 (same weekly master, different occurrence → 409),
      SCG-4 (recurring: drop the colliding room → 200),
      SCG-5 (recurring: introduce on 2/10 → 409, `conflictingOccurrences: 2`),
      SCG-6 (extend overlap with same non-recurring neighbour → 200),
      SCG-7 (clean proposed → exactly one conflict query batch; spy on
      `Collection.prototype.find` per the `publishRollback` precedent),
      SCG-13 (stale `_version` + would-be conflict → `VERSION_CONFLICT`, no
      conflict query issued).
- [x] 4.2 Implement OCC-first: compare request `_version`/`expectedVersion`
      to the fetched `event._version` before the conflict block (~25368);
      return the existing `VERSION_CONFLICT` envelope. Confirm the later
      `conditionalUpdate` is untouched (defence in depth).
- [x] 4.3 Implement delta on the single branch (~25409): run proposed
      `checkRoomConflicts`; if hard non-empty, run baseline with
      `cd.startDateTime/endDateTime`, `cd.locations`, stored buffers via the
      same `??` chain, `cd.categories`, same `excludeId`/`calendarOwner`;
      `introducedConflicts` → 409 contract per design D3 or fall through.
- [x] 4.4 Implement delta on the recurring branch (~25378): baseline
      `checkRecurringRoomConflicts` with stored recurrence/rooms/times/buffers;
      key per date; 409 only when introduced non-empty; `recurringConflicts`
      in the body filtered to introduced dates, `conflictingOccurrences`
      recomputed accordingly. Recurrence PATTERN change needs no special
      case — new dates produce new keys.
- [x] 4.5 Run `saveConflictDelta.test.js` + `editConflict` + `recurringConflict`
      + `conflictTier` + `publishRecurringConflict` in isolation; all at or
      above baseline (EC-1..4 and RCC-13 must still be 409 — they are
      introduced-conflict cases).

## 5. `PUT /api/room-reservations/:id/edit` — general branch (incl. resubmit)

- [x] 5.1 Add to `saveConflictDelta.test.js`: owner drops a colliding room →
      200; owner introduces → 409 `canForce: false`; rejected→pending
      resubmit that carries (not introduces) a collision → 200 and status
      `pending`.
- [x] 5.2 Implement delta at ~18183 with the same helper; `canForce: false`.

## 6. Occurrence (`thisEvent`) branches — admin AND owner

- [x] 6.1 Extract a shared `checkOccurrenceConflictDelta({ masterDoc,
      existingException, dateKey, overrideData, excludeIds, calendarOwner })`
      helper (api-server.js or `services/occurrenceConflictService.js` with
      injected deps, per `conflictReportService` precedent). Baseline =
      effective occurrence before override; proposed = after; buffers from
      `masterDoc.calendarData` (`??` chain); exclusion =
      `resolveSeriesExclusionIds(master._id)`.
- [x] 6.2 Tests SCG-8/9/10/11/12: approver removes an inherited colliding
      room while others still collide → 200 (field-report repro); approver
      adds a colliding room → 409 `canForce: false`; admin same → 409
      `canForce: true, forceField: 'forceUpdate'`, and 200 with
      `forceUpdate: true`; buffer-only collision (master 30-min setup) →
      caught; requester `thisEvent` into collision → 409 `canForce: false`.
- [x] 6.3 Wire the helper into `PUT /api/admin/events/:id` thisEvent branch
      (~25092, before `createExceptionDocument`/`updateExceptionDocument`) and
      `PUT /api/room-reservations/:id/edit` thisEvent branch (~18028).
- [x] 6.4 Confirm existing `thisEvent` suites match baseline.

## 7. Frontend

- [x] 7.1 `ReviewModal.saveConflictGate.test.jsx` SCG-5: requester
      Save & Resubmit enabled under `hasSchedulingConflicts` with changes;
      disabled with 'Make a change first…' without changes.
- [x] 7.2 `ReviewModal.jsx` ~648: drop `hardConflictBlocks` and
      `blockOnConflict` from the Save & Resubmit button; comment mirrors the
      Save rationale.
- [x] 7.3 `useReviewModal.handleSave`: no code change expected (already
      prefers `data.message`); assert the new server wording surfaces via an
      existing hook test or add one case to `useReviewModal.forcePublish.test.jsx`.

## 8. Docs

- [x] 8.1 CLAUDE.md "Current In-Progress Work": add a section for this change
      (root cause, delta rule, key qualifier gotcha, buffer gotcha, which
      paths keep whole-state, test names) and add the client Save-gate note.
- [x] 8.2 `architecture-notes.md`: one paragraph under conflict detection —
      "save = delta, publish/approve/restore = whole-state", with the master
      occurrence-qualifier rationale.

## 9. Manual verification (dev, live MSAL, writes to real events)

- [ ] 9.1 As approver: open the pending Religious School series, remove Room
      402 from ALL occurrences → saves (previously 409). Re-add a room that
      collides with RS Sunday → 409 toast names the introduced conflict only.
- [ ] 9.2 As approver: on the 2026-11-08 occurrence, add Wise Hall (Mitzvah
      Day) → 409, no force; remove it again → 200.
- [ ] 9.3 As admin: same as 9.2 → 409 with force → `forceUpdate` succeeds.
- [ ] 9.4 As requester (own pending request that already collides): shrink
      it → 200; move it onto a published event → 409.
- [ ] 9.5 Publish of a still-colliding pending event as approver → still
      blocked (whole-state unchanged).
