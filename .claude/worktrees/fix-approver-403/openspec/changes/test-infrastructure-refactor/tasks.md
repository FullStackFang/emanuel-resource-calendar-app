## 1. Centralize Connection Helpers

- [x] 1.1 Update `testSetup.js`: add `connectToGlobalServer(suiteName)` that connects to `process.env.MONGODB_TEST_URI`, creates database `test_<suiteName>`, calls `createCollections()`, and returns `{ db, client }`
- [x] 1.2 Update `testSetup.js`: add `disconnectFromGlobalServer(client, db)` that drops the database and closes the client connection
- [x] 1.3 Remove `getServerOptions()` and standalone `MongoMemoryServer.create()` from `testSetup.js` (keep `createCollections` and `clearCollections`)

## 2. Migrate Integration Test Files (batch 1: A-E)

- [x] 2.1 Migrate `adminOccurrenceEdit.test.js` — replace MongoMemoryServer boilerplate with `connectToGlobalServer`/`disconnectFromGlobalServer`
- [x] 2.2 Migrate `approverChanges.test.js`
- [x] 2.3 Migrate `calendarLoad.test.js`
- [x] 2.4 Migrate `categoryConcurrentRules.test.js`
- [x] 2.5 Migrate `concurrency.test.js`
- [x] 2.6 Migrate `conflictTier.test.js`
- [x] 2.7 Migrate `deltaSyncOverrides.test.js`
- [x] 2.8 Migrate `departmentEdit.test.js`
- [x] 2.9 Migrate `draftOccurrenceEdit.test.js`
- [x] 2.10 Migrate `draftSubmit.test.js`
- [x] 2.11 Migrate `editConflict.test.js`
- [x] 2.12 Migrate `editRequest.test.js`
- [x] 2.13 Migrate `eventAdminRestore.test.js`
- [x] 2.14 Migrate `eventDelete.test.js`
- [x] 2.15 Migrate `eventPublish.test.js`
- [x] 2.16 Run full suite — verify all tests in batch 1 pass

## 3. Migrate Integration Test Files (batch 2: E-R)

- [x] 3.1 Migrate `eventReject.test.js`
- [x] 3.2 Migrate `eventUpdate.test.js`
- [x] 3.3 Migrate `eventUpdatedNotification.test.js`
- [x] 3.4 Migrate `myEventsView.test.js`
- [x] 3.5 Migrate `ownerRestore.test.js`
- [x] 3.6 Migrate `pendingEdit.test.js`
- [x] 3.7 Migrate `pendingEditConflict.test.js`
- [x] 3.8 Migrate `proposedChangesMerge.test.js`
- [x] 3.9 Migrate `publishConflict.test.js`
- [x] 3.10 Migrate `publishEditConflict.test.js`
- [x] 3.11 Migrate `publishEditGraphSync.test.js`
- [x] 3.12 Migrate `publishRecurringConflict.test.js`
- [x] 3.13 Migrate `recurringBatchConflict.test.js`
- [x] 3.14 Migrate `recurringCalendarLoad.test.js`
- [x] 3.15 Migrate `recurringConflict.test.js`
- [x] 3.16 Run full suite — verify all tests in batch 2 pass

## 4. Migrate Integration Test Files (batch 3: R-Z + roles)

- [x] 4.1 Migrate `recurringDelete.test.js`
- [x] 4.2 Migrate `recurringPublish.test.js`
- [x] 4.3 Migrate `rejectedEdit.test.js`
- [x] 4.4 Migrate `resubmit.test.js`
- [x] 4.5 Migrate `reviewerNotifications.test.js`
- [x] 4.6 Migrate `saveConflict.test.js`
- [x] 4.7 Migrate `statusHistory.test.js`
- [x] 4.8 Migrate `requesterWorkflow.test.js`
- [x] 4.9 Migrate `viewerAccess.test.js`
- [x] 4.10 Run full suite — verify all 37 files migrated and passing

## 5. Remove Trivial Tests

- [x] 5.1 Remove 8 trivial tests from `permissionUtils.test.js` (static constant checks, `.toBeDefined()`, `.toHaveLength()` on static arrays, literal string check)
- [x] 5.2 Remove 6 trivial tests from `changeDetection.test.js` (basic string equality, duplicate datetime comparisons, empty array passthrough)
- [x] 5.3 Run full suite — verify remaining tests pass (642 passing)

## 6. Delete Empty Test Files

- [x] 6.1 Identify test files with 0 `it()`/`test()` calls — NONE FOUND (initial count was wrong due to glob issue)
- [x] 6.2 Run full suite — verify total test count is 642 and all pass

## 7. Create Test Skill

- [x] 7.1 Create `~/.claude/skills/test.md` with skill frontmatter and prompt template covering: coverage-first approach, anti-patterns to avoid, project helper usage, business logic boundary focus
- [ ] 7.2 Verify `/test` is recognized by Claude Code

## 8. Final Verification

- [x] 8.1 Run full backend suite (`npm test`) — 642 tests pass
- [x] 8.2 Measure runtime — 188.9s (down from 213s baseline, 11% improvement)
- [x] 8.3 Verify no `MongoMemoryServer.create()` calls remain in test files (only in `globalSetup.js`)
