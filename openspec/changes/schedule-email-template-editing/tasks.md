## 1. Permission

- [x] 1.1 Write failing tests in `permissionUtils.test.js`: `canEditEmailTemplates` true for approver/admin, false for viewer/requester, false for a requester in department 'events'
- [x] 1.2 Add `canEditEmailTemplates` to `ROLE_PERMISSIONS` and `getPermissions` in `backend/utils/permissionUtils.js`
- [x] 1.3 Thread it through the frontend permission chain (`usePermissions`, role simulation) and extend `usePermissions.contract.test.jsx`

## 2. Template endpoint gates (backend)

- [x] 2.1 Write failing integration tests (use `createAppForTest`): approver gets 200 on templates list/get/save/preview/reset; requester and events-dept requester get 403; approver gets 403 on `/config`, `/settings`, `/test`
- [x] 2.2 Add a `requireTemplateEditor(req, res)` helper and switch the five template routes to it; leave the three settings routes on `isAdmin`
- [x] 2.3 Write failing tests for `expectedUpdatedAt` on template PUT (stale → 409 `TEMPLATE_CHANGED` with current content and no write; `null` vs existing override → 409; omitted → last-write-wins)
- [x] 2.4 Implement the `expectedUpdatedAt` precondition in `PUT /api/admin/email/templates/:id`

## 3. Shared per-recipient render (backend)

- [x] 3.1 Extract scope/grouping (`planScope` → `scopeDays` → `scopeLabel` → `byEmail`) and `renderScheduleEmail(...)` from the send handler into helpers; existing `schedulingSheetEmail.test.js` must stay at its measured baseline (record pass/fail counts before touching it)
- [x] 3.2 Add `assignmentEmailBody` to the sheet GET response beside `assignmentEmailSubject`, with a test that a stored override wins over the default

## 4. Preview and test-send endpoints (backend)

- [x] 4.1 Write failing tests for `POST /api/scheduling-sheets/:id/email/preview`: output equals what the send path renders for the same recipient/scope; 400 `RECIPIENT_NOT_IN_SCOPE` for unknown or placeholder recipients; case-insensitive match; 403 for non-managers; no `emailLog`/`_version`/`lastModifiedAt` change
- [x] 4.2 Implement the preview endpoint
- [x] 4.3 Write failing tests for `POST .../email/test-send`: exactly one send, addressed to `req.user.email`, a body `to` ignored; subject prefixed `[Preview] `; `.ics` of the previewed person only when `includeCalendar === true`; PDF attachment honoured with the same limit and warnings; no `emailLog` write; delivery-disabled → `{ sent: false, skipped: true }`
- [x] 4.4 Implement the test-send endpoint (through `withGraphRetry`)

## 5. Shared EmailTemplateEditor (frontend)

- [x] 5.1 Write tests for `src/components/shared/EmailTemplateEditor.jsx`: read-only mode renders no editor controls; dirty state reported via `onDirtyChange`; Save sends `expectedUpdatedAt`; 409 `TEMPLATE_CHANGED` keeps the draft and offers reload; Reset uses two-step in-button confirmation
- [x] 5.2 Extract the editor from `EmailTestAdmin.jsx` into the shared component and use it in the Templates tab; Email Management's sample-data preview stays

## 6. Email Management access (frontend)

- [x] 6.1 Write tests: non-admin approver sees the Templates tab only, no request to `/api/admin/email/config`; admin sees both tabs; requester redirected; approver sees the nav link
- [x] 6.2 Gate the `/admin/email-test` route on `canEditEmailTemplates`, hide the Settings tab and its loaders for non-admins, and add the nav link for non-admin approvers

## 7. Email Schedules panel (frontend)

- [x] 7.1 Add `previewSchedule` and `testSendSchedule` mutations in `useSchedulingSheets.js`; `SchedulingSheets.jsx` attaches the PDF to test-send the same way `sendSchedules` does
- [x] 7.2 Write tests in `SchedulingSheets.components.test.jsx`: Message section collapsed by default and read-only without permission; Edit visible with permission; dirty editor disables send with the explanation; discard re-enables; preview recipient picker renders the returned HTML in an iframe; 'Send preview to me' toasts success, reports delivery-disabled, and never marks anyone as sent
- [x] 7.3 Implement the Message section, the preview picker + iframe, and the 'Send preview to me' button in `EmailSchedulesPanel.jsx` (+ CSS, matching the panel's horizontally dense layout)

## 8. Verification

- [x] 8.1 Run the touched backend and frontend test files; compare against the red-main baseline measured by stash, and record counts here
  - Backend (6 touched suites): 220 passed / 4 failed. The 4 are SE-30 and SS-31..33, measured failing before either file was touched (schedulingSheetEmail 50/1, schedulingSheets 38/3) — the orphaned-cell family from 3bcbf1c. New: emailTemplateAccess 11/11, schedulingSheetEmailPreview 18/18, permissionUtils 73/73 (+4).
  - Frontend (full suite, HEAD measured by `git stash push -u`): HEAD 2171 passed / 11 failed / 4 files; with the change 2197 passed / 11 failed / 4 files. +26 = exactly the added tests (ETE 10, EMA 7, SEP-23..30 8, contract 1); identical failing set (RschedImport 6, eventTransformers 3, RecurrenceTabContent 1, SEP-9 1). The documented '10 / 3' baseline predates SEP-9 (3bcbf1c).
  - Mutation-checked: honouring a body `to` in test-send fails STS-1; dropping `!templateDirty` from the send gate fails SEP-25.
- [x] 8.2 Lint the touched frontend files (0 errors; 6 warnings, all on pre-existing lines)
- [ ] 8.3 Manual on dev (live MSAL): as an approver, edit and save the schedule template from the panel and see it in Email Management; preview two different recipients; send a preview to self with .ics and PDF and confirm nobody is marked sent; as an events-dept requester, confirm the read-only message and no Email Management access
- [x] 8.4 Update CLAUDE.md 'Current In-Progress Work' with what shipped
