# shared-mongo-setup Specification

## Purpose
TBD - created by archiving change test-infrastructure-refactor. Update Purpose after archive.
## Requirements
### Requirement: Global MongoMemoryServer shared across all test suites
The test infrastructure SHALL use a single MongoMemoryServer instance (started in `globalSetup.js`) for all integration test files. Individual test files MUST NOT create their own MongoMemoryServer instances.

#### Scenario: Integration test connects to global server
- **WHEN** an integration test file runs its `beforeAll` hook
- **THEN** it connects to `process.env.MONGODB_TEST_URI` (the global server) instead of calling `MongoMemoryServer.create()`

#### Scenario: Global server is already running
- **WHEN** the test suite starts
- **THEN** `globalSetup.js` has already started the server and set `process.env.MONGODB_TEST_URI`
- **AND** no additional MongoMemoryServer instances are created during the test run

### Requirement: Per-suite database isolation
Each test file SHALL use a unique database name on the shared server to prevent cross-suite state leakage.

#### Scenario: Two test files run sequentially
- **WHEN** `eventPublish.test.js` and `eventReject.test.js` both run
- **THEN** they use separate databases (e.g., `test_eventPublish` and `test_eventReject`)
- **AND** data inserted by one file is not visible to the other

#### Scenario: Test file cleans up after itself
- **WHEN** a test file's `afterAll` hook runs
- **THEN** it drops its database and closes its MongoDB client connection

### Requirement: Centralized connection helpers in testSetup.js
`testSetup.js` SHALL export `connectToGlobalServer(suiteName)` and `disconnectFromGlobalServer(client, db)` helpers that encapsulate the connection/cleanup pattern.

#### Scenario: connectToGlobalServer returns database and client
- **WHEN** a test file calls `connectToGlobalServer('eventPublish')`
- **THEN** it receives `{ db, client }` where `db` is a database named `test_eventPublish`
- **AND** all required collections are created on that database

#### Scenario: disconnectFromGlobalServer cleans up
- **WHEN** a test file calls `disconnectFromGlobalServer(client, db)`
- **THEN** the database is dropped and the client connection is closed

### Requirement: Existing test behavior preserved
All 609 kept tests SHALL pass with identical assertions after migration to the shared server. No test logic, assertions, or business coverage SHALL change.

#### Scenario: Full suite passes after migration
- **WHEN** `npm test` runs the full backend suite
- **THEN** all previously passing tests still pass
- **AND** total test count is 609 (645 minus 36 removed trivial tests)

### Requirement: Trivial unit tests removed
The 36 identified trivial tests SHALL be removed from `permissionUtils.test.js` (21 tests) and `changeDetection.test.js` (15 tests).

#### Scenario: permissionUtils.test.js reduced
- **WHEN** the test file is loaded
- **THEN** it contains 23 tests (down from 44)
- **AND** all remaining tests validate actual function logic (getEffectiveRole, hasRole, getPermissions, canEditField, etc.)

#### Scenario: changeDetection.test.js reduced
- **WHEN** the test file is loaded
- **THEN** it contains 44 tests (down from 59)
- **AND** all remaining tests validate change detection logic, not basic type comparisons

### Requirement: Empty test files removed
Test files with zero `it()` calls SHALL be deleted entirely.

#### Scenario: No empty test files exist
- **WHEN** scanning `__tests__/` for test files
- **THEN** every `.test.js` file contains at least one `it()` or `test()` call

