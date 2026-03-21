## 1. Centralize Connection Helpers

- [ ] 1.1 Update `testSetup.js`: add `connectToGlobalServer(suiteName)` that connects to `process.env.MONGODB_TEST_URI`, creates database `test_<suiteName>`, calls `createCollections()`, and returns `{ db, client }`
- [ ] 1.2 Update `testSetup.js`: add `disconnectFromGlobalServer(client, db)` that drops the database and closes the client connection
- [ ] 1.3 Remove `getServerOptions()` and standalone `MongoMemoryServer.create()` from `testSetup.js` (keep `createCollections` and `clearCollections`)

## 2. Migrate Integration Test Files (batch 1: A-E)

- [ ] 2.1 Migrate `adminOccurrenceEdit.test.js` — replace MongoMemoryServer boilerplate with `connectToGlobalServer`/`disconnectFromGlobalServer`
- [ ] 2.2 Migrate `approverChanges.test.js`
- [ ] 2.3 Migrate `calendarLoad.test.js`
- [ ] 2.4 Migrate `categoryConcurrentRules.test.js`
- [ ] 2.5 Migrate `concurrency.test.js`
- [ ] 2.6 Migrate `conflictTier.test.js`
- [ ] 2.7 Migrate `deltaSyncOverrides.test.js`
- [ ] 2.8 Migrate `departmentEdit.test.js`
- [ ] 2.9 Migrate `draftOccurrenceEdit.test.js`
- [ ] 2.10 Migrate `draftSubmit.test.js`
- [ ] 2.11 Migrate `editConflict.test.js`
- [ ] 2.12 Migrate `editRequest.test.js`
- [ ] 2.13 Migrate `eventAdminRestore.test.js`
- [ ] 2.14 Migrate `eventDelete.test.js`
- [ ] 2.15 Migrate `eventPublish.test.js`
- [ ] 2.16 Run full suite — verify all tests in batch 1 pass

## 3. Migrate Integration Test Files (batch 2: E-R)

- [ ] 3.1 Migrate `eventReject.test.js`
- [ ] 3.2 Migrate `eventUpdate.test.js`
- [ ] 3.3 Migrate `eventUpdatedNotification.test.js`
- [ ] 3.4 Migrate `myEventsView.test.js`
- [ ] 3.5 Migrate `ownerRestore.test.js`
- [ ] 3.6 Migrate `pendingEdit.test.js`
- [ ] 3.7 Migrate `pendingEditConflict.test.js`
- [ ] 3.8 Migrate `proposedChangesMerge.test.js`
- [ ] 3.9 Migrate `publishConflict.test.js`
- [ ] 3.10 Migrate `publishEditConflict.test.js`
- [ ] 3.11 Migrate `publishEditGraphSync.test.js`
- [ ] 3.12 Migrate `publishRecurringConflict.test.js`
- [ ] 3.13 Migrate `recurringBatchConflict.test.js`
- [ ] 3.14 Migrate `recurringCalendarLoad.test.js`
- [ ] 3.15 Migrate `recurringConflict.test.js`
- [ ] 3.16 Run full suite — verify all tests in batch 2 pass

## 4. Migrate Integration Test Files (batch 3: R-Z + roles)

- [ ] 4.1 Migrate `recurringDelete.test.js`
- [ ] 4.2 Migrate `recurringPublish.test.js`
- [ ] 4.3 Migrate `rejectedEdit.test.js`
- [ ] 4.4 Migrate `resubmit.test.js`
- [ ] 4.5 Migrate `reviewerNotifications.test.js`
- [ ] 4.6 Migrate `saveConflict.test.js`
- [ ] 4.7 Migrate `statusHistory.test.js`
- [ ] 4.8 Migrate `requesterWorkflow.test.js`
- [ ] 4.9 Migrate `viewerAccess.test.js`
- [ ] 4.10 Run full suite — verify all 37 files migrated and passing

## 5. Remove Trivial Tests

- [ ] 5.1 Remove 21 trivial tests from `permissionUtils.test.js` (static constant checks, `.toBeDefined()`, `.toHaveLength()` on static arrays)
- [ ] 5.2 Remove 15 trivial tests from `changeDetection.test.js` (basic string equality, duplicate datetime comparisons, empty array passthrough)
- [ ] 5.3 Run unit tests — verify 67 remaining unit tests pass (23 permissionUtils + 44 changeDetection)

## 6. Delete Empty Test Files

- [ ] 6.1 Identify and delete all test files with 0 `it()`/`test()` calls
- [ ] 6.2 Run full suite — verify total test count is ~609 and all pass

## 7. Create Test Skill

- [ ] 7.1 Create `~/.claude/skills/test.md` with skill frontmatter and prompt template covering: coverage-first approach, anti-patterns to avoid, project helper usage, business logic boundary focus
- [ ] 7.2 Verify `/test` is recognized by Claude Code

## 8. Final Verification

- [ ] 8.1 Run full backend suite (`npm test`) — confirm ~609 tests pass
- [ ] 8.2 Measure runtime — confirm reduction from 213s baseline (target: <110s)
- [ ] 8.3 Verify no `MongoMemoryServer.create()` calls remain in test files (only in `globalSetup.js`)
