## 1. Server storage (tests first)

- [x] 1.1 Add failing `sheetCells.test.js` cases: text + location details round-trip normalized and in order; person inside `details` → invalid; >10 details → invalid; segments + details over `MAX_SEGMENTS_PER_CELL` → invalid; absent / empty `details` → no field on the stored segment; `extractTaggedEmails` identical with and without details
- [x] 1.2 Extend `validateCell` in `backend/utils/sheetCells.js` to normalize `details` through the same per-type rules as top-level text/location segments (D1)
- [x] 1.3 Add a `schedulingSheets.test.js` integration case: a cell PUT with details persists them and a nested-person PUT returns 400

## 2. Recipient surfaces (tests first)

- [x] 2.1 Add failing tests: `assignmentSchedule.test.js` for `formatDetails` and the itinerary line; `icsBuilder.test.js` for details in DESCRIPTION with DTSTART/DTEND unchanged; `schedulingSheetEmail.test.js` for another person's details never reaching Stephen
- [x] 2.2 Add `details` to `extractDayAssignments` entries in `backend/api-server.js`
- [x] 2.3 Add pure `formatDetails` to `backend/utils/assignmentSchedule.js` and use it in `buildAssignmentsHtml`
- [x] 2.4 Append the formatted details line to the `.ics` DESCRIPTION in `backend/utils/icsBuilder.js`
- [x] 2.5 Update SE-25 to the 15-key set including `details`, with a comment naming this change; confirm the `GET /api/my-assignments` projection keeps `details`

## 3. Picker and group logic (tests first)

- [x] 3.1 Add failing unit tests for pure helpers in `useMentionPicker.js`: `splitMentionTokens` (space-@ splitting, multi-word tokens, embedded `@`) and `collectDetailVocabulary` (whole sheet, text details only, case-merge by frequency, other sheets excluded)
- [x] 3.2 Add failing `useMentionPicker.test.jsx` cases for `detailMode`: text row is default and time-normalized, no placeholder/outsider rows, locations/people pick-only, vocabulary rows above the text row with 5-row cap + overflow count; lookup mode unchanged
- [x] 3.3 Implement the helpers and `detailMode` in `useMentionPicker.js`; add a `detail` choice kind handled by `applyChoice`

## 4. Editors (tests first)

- [x] 4.1 Add failing `SchedulingSheetGrid.inlineEditing.test.jsx` cases: pick person then `@615pm`/`@Greenwald`/`@Task` → one grouped segment; second person starts a new group; plain text stays top-level; space-@ finalizes; paste of a multi-token line; Backspace removes details then the person; × removes one detail; Enter on `@Al` adds text not Alan
- [x] 4.2 Implement the open group in `InlineCellEditor.jsx` (track open group index, route detail choices into it, space-@ finalize, paste, Backspace, render details inside the chip)
- [x] 4.3 Apply the same behavior in `SheetCellEditor.jsx`, sharing pure group helpers so the two editors cannot drift; add its tests
- [x] 4.4 Pass the sheet's detail vocabulary from `SchedulingSheetGrid.jsx` to both editors (memoized on sheet data)

## 5. Rendering

- [x] 5.1 Render details inside the person chip in the grid (`SchedulingSheetGrid.jsx`) and style them in `SchedulingSheets.css`, including print; add a grid render test
- [x] 5.2 Add a failing `schedulingSheetPdf.test.js` case, then append details to the person block in `src/utils/schedulingSheetPdf.js`
- [x] 5.3 Show `details` on My Assignments entries; add a test to the My Assignments suite

## 6. Verification

- [x] 6.1 Run the touched backend suites (`sheetCells`, `schedulingSheets`, `schedulingSheetEmail`, `assignmentSchedule`, `icsBuilder`) and compare against a stash baseline (SE-30 / SS-31..33 are pre-existing reds)
- [x] 6.2 Run the touched frontend suites and lint the touched files; compare against the stash baseline
- [ ] 6.3 Manual on dev (live MSAL): type `@Stephen @615pm @Greenwald @Task` in a cell, confirm one grouped chip, reuse a detail from another day via suggestion, download the PDF, send a preview to self and confirm details in the email body and the `.ics` description with times unchanged
