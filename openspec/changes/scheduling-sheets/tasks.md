# Tasks: scheduling-sheets

## 1. Permission pipeline

- [x] 1.1 Add `canManageAssignments` to `permissionUtils.js` (function + `getPermissions()` output) with unit tests beside the `canManageCalendarMarkers` ones
- [x] 1.2 Add `requireAssignmentManager` middleware in `api-server.js` using `findUserByIdentity` DB re-fetch (test: token without department claim + events-dept DB record -> authorized; facilities approver -> 403)
- [x] 1.3 Thread `canManageAssignments` through `RoleSimulationContext`/`usePermissions` and assert in the permissions contract test

## 2. Collections and data layer

- [x] 2.1 Wire `templeEvents__SchedulingSheets` and `templeEvents__SchedulingSheetDays` collection handles at BOTH api-server sites (startup `withRetryCollection` block and `injectedDb` test-harness branch)
- [x] 2.2 Create indexes: `{ sheetId: 1, date: 1 }` (unique) and `{ taggedEmails: 1, date: 1 }` on day docs
- [x] 2.3 Implement segment validation + `taggedEmails` recomputation as a pure util (`backend/utils/sheetCells.js`): validate segment types/caps, lowercase person emails, extract distinct emails; unit-test including client-supplied-taggedEmails-ignored case

## 3. Workbook and day endpoints

- [x] 3.1 Workbook CRUD: `GET/POST/PUT/DELETE /api/scheduling-sheets` (+ cascade delete of days); integration tests via `createAppForTest` incl. gate scenarios
- [x] 3.2 Day CRUD: create (seed 5 starter rows, reject `DUPLICATE_DATE` per workbook, allow same date cross-workbook), delete, list days per workbook
- [x] 3.3 Structural update endpoint (title, rows, columns, event link/unlink) via `conditionalUpdate()` with 409 `VERSION_CONFLICT` test
- [x] 3.4 Cell write endpoint: targeted `$set` on one cell path + `$inc _version`, no version gate; recompute `taggedEmails` server-side; tests: different-cell concurrency both persist, invalid segment 400
- [x] 3.5 Copy-a-day and copy-a-workbook endpoints (structure+people carry, dates re-seeded in order, `emailLog` reset, count-mismatch behavior); tests per spec scenarios
- [x] 3.6 `GET /api/scheduling-sheets/user-lookup?q=` gated by `requireAssignmentManager` (capped results); test: events-dept requester gets matches (regression guard against reusing `GET /api/users`)
- [x] 3.7 Lookup cap fix (bug found live 2026-09-03): an UNQUERIED lookup returns the whole directory — the @ picker prefetches once and filters client-side, so the 25-cap made users sorting past the cut unfindable; typed `q` lookups keep the cap (SS-27)

## 4. My Assignments (derived)

- [x] 4.1 `GET /api/my-assignments`: taggedEmails equality query + own-cells extraction (effective call time = override ?? column Call Time); tests: own-cells-only, case-insensitive token email, empty list
- [x] 4.2 Frontend `MyAssignments` screen (any authenticated user): grouped by day naming the workbook, empty state with refresh affordance, `deriveListLoadingState` binding; firstPaint test

## 5. Schedule email

- [x] 5.1 `ASSIGNMENT_SCHEDULE` template + `CTA_CONFIG` entry in `emailTemplates.js` (day-scoped subject, sheet title in body, notes + effective call time, CTA -> My Assignments); EU-14 passes
- [x] 5.2 `POST /api/scheduling-sheets/:sheetId/email`: scope resolution (day | whole sheet, optional recipients subset), one email per distinct person, `Promise.allSettled` fan-out, per-recipient results; test: 1 bad address of 7 -> 6 sent + failure reported
- [x] 5.3 Placeholder hard-block: 422 `UNRESOLVED_PLACEHOLDERS` with zero dispatches; `allowPlaceholders` honored for admin only; tests for all three spec scenarios
- [x] 5.4 `emailLog` append on success + stale computation (`lastModifiedAt > sentAt`) exposed in the day payload; test: edit-after-send reads stale

## 6. Workbook frontend

- [x] 6.1 Route `/admin/scheduling-sheets` + `RequireAssignmentManager` guard + nav wiring in `App.jsx` (Admin dropdown for admins, top-level link for events-dept non-admins); route test incl. non-manager redirect and deep-link `?sheet&date`
- [x] 6.2 Workbook shell: sheet picker dropdown (per-year grouping, New Scheduling Sheet flow with seed dates + copy-from), day tabs (app pill-tab styling per mockup), '+' day panel, rename/delete day via overflow menu with two-step in-button confirm; empty workbook auto-opens creation panel
- [x] 6.3 Grid component: frozen label column, starter-row band, add row/column, cell editor with ordered segments (text + chips), horizontal scroll container (`overflow-x: auto`), sticky column headers
- [x] 6.4 `@` person picker (user-lookup endpoint, 5-cap + overflow, external escape hatch, placeholder confirm) and `#` location picker; chip rendering for the three assignee kinds; per-person call-time override editor
- [x] 6.5 Cell notes (corner marker + popover), event-link column flow (picker of day +/-1 published events, snapshot prefill, drift flag with explicit refresh, deleted-event degradation), soft double-booking warning
- [x] 6.6 Email Schedules panel: recipient list with per-person sent/not-sent/stale status, placeholder rows greyed with hard-block messaging (+ admin override), two-step confirm, per-recipient results rendering
- [x] 6.7 `@media print` stylesheet: active sheet only, rows grow, chrome stripped
- [x] 6.8 Component/unit tests for 6.2-6.6 (picker gate, two-step confirms, drift flag, block messaging) + firstPaint test for the workbook screen
- [x] 6.9 Unified '@' mention UX (user feedback 2026-09-03): '@' in column-name inputs (add + rename) replaces the link dropdown — event options show date/times, picking links the column and prefills empty starter rows (Location chips, Call Time from setup, Doors Open, Begins, Ends); '@' in cells offers people AND a Locations group ('#' stays as location-only shortcut); prefill cell writes sequenced after the structure write succeeds; tests SSG-8..10, SCE-7

## 7. Verification

- [x] 7.1 Run the new backend + frontend suites; measure full-suite baseline by stash-diff (red-main protocol) and confirm no new regressions; lint touched files vs HEAD
- [ ] 7.2 Manual end-to-end on dev (live MSAL): create '2026 High Holy Days' with disjoint days, build a grid with all chip kinds, print, day-scoped and workbook-scoped sends to a test mailbox, placeholder block + admin override, My Assignments as a tagged non-manager, events-dept requester full round-trip (nav, lookup, edit), non-manager redirect
