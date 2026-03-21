## Why

The backend test suite (645 tests, 45 suites) takes 213 seconds to run because each of the 37 integration test files spins up its own MongoMemoryServer instance (~40-70s of pure infrastructure overhead). Additionally, 36 unit tests check static constants or language primitives rather than business logic, and 7 empty placeholder test files add noise. The suite is well-targeted but the infrastructure cost discourages running it, and there is no codified standard to keep future test quality consistent.

## What Changes

- **Shared MongoMemoryServer**: Replace 37 per-file MongoMemoryServer instances with a single global instance managed via Jest `globalSetup`/`globalTeardown`, with per-file database isolation via unique database names
- **Trivial test removal**: Delete 36 unit tests that check static constants, field existence, or duplicate basic language behavior (21 in `permissionUtils.test.js`, 15 in `changeDetection.test.js`)
- **Empty file cleanup**: Remove 7 empty test files that contain no test cases (`reviewerNotifications`, `recurringCalendarLoad`, `recurringDelete`, `deltaSyncOverrides`, `myEventsView`, and 2 others with 0 `it()` calls)
- **Test skill**: Create a `/test` skill (markdown prompt template) that codifies the project's testing philosophy — what to test, what not to test, how to check for existing coverage before adding tests, and target test-per-endpoint ratios

## Capabilities

### New Capabilities
- `shared-mongo-setup`: Global MongoMemoryServer lifecycle (start once in globalSetup, stop in globalTeardown) with per-suite database isolation and collection cleanup between tests
- `test-skill`: A `/test` slash command skill that guides Claude to write focused, non-redundant tests by reading existing coverage, identifying business logic boundaries, and enforcing project testing standards

### Modified Capabilities

(none)

## Impact

- **Test files**: All 37 integration test files need `beforeAll`/`afterAll` rewritten to use shared server instead of creating their own
- **Jest config**: `jest.config.js` updated with `globalSetup`/`globalTeardown` paths
- **Test helpers**: `testSetup.js` and `testApp.js` updated to support shared server connection
- **Unit tests**: `permissionUtils.test.js` and `changeDetection.test.js` reduced in size
- **Skill file**: New file at `~/.claude/skills/test.md`
- **Runtime**: Expected reduction from ~213s to ~80-100s (~50-55% improvement)
- **Test count**: 645 → ~609 (net -36 trivial tests)
