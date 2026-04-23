## Context

The backend test suite has 645 tests across 45 files taking 213 seconds. A global MongoMemoryServer already exists in `globalSetup.js` (port 27018, URI stored in `process.env.MONGODB_TEST_URI`), but all 37 integration test files ignore it and each create their own instance via `MongoMemoryServer.create()`. The `testSetup.js` helper also creates its own instance (used by 0 integration files currently — they inline the same pattern). This means 37+ MongoDB processes start and stop during a full test run.

Additionally, 36 unit tests validate static constants or trivial equality, and 7 test files are empty placeholders.

## Goals / Non-Goals

**Goals:**
- Cut test runtime by ~50% by eliminating redundant MongoMemoryServer startup/shutdown
- Remove trivial tests that provide no regression protection
- Clean up empty test files
- Create a `/test` skill to maintain test quality standards going forward

**Non-Goals:**
- Rewriting test assertions or business logic coverage (the 609 remaining tests are well-targeted)
- Adding new test coverage for untested endpoints (separate effort)
- Changing test structure (describe/it nesting, naming conventions)
- Parallelizing Jest workers (would require more complex isolation)

## Decisions

### 1. Reuse existing globalSetup MongoMemoryServer

**Decision**: Migrate all 37 integration test files to connect to the global MongoMemoryServer instance (already running on port 27018 via `globalSetup.js`) instead of creating their own.

**Alternative considered**: Jest `--shard` with per-shard servers. Rejected — adds complexity for marginal gain on a ~600-test suite. Single shared server is sufficient.

**How it works**:
- `globalSetup.js` already starts a server and sets `process.env.MONGODB_TEST_URI`
- Each test file's `beforeAll` will connect to that URI using a **unique database name** (e.g., `test_<filename>_<pid>`) for isolation
- Each test file's `beforeEach` will clear its collections (already done today)
- Each test file's `afterAll` will close its client connection and drop its database
- `testSetup.js` will be updated to provide `connectToGlobalServer(suiteName)` and `disconnectFromGlobalServer()` helpers

### 2. Per-suite database isolation (not per-test)

**Decision**: Each test file gets its own database on the shared server, named `test_<suiteName>`. This provides full isolation between suites without any shared state risk.

**Alternative considered**: Single shared database with collection cleanup. Rejected — risk of cross-suite contamination if cleanup is missed, and makes parallel workers impossible later.

**Pattern**:
```javascript
// In each test file's beforeAll:
const { db, client } = await connectToGlobalServer('eventPublish');
// Creates database: test_eventPublish

// In afterAll:
await disconnectFromGlobalServer(client, db);
// Drops database, closes connection
```

### 3. Centralize connection logic in testSetup.js

**Decision**: Replace per-file boilerplate with two helpers in `testSetup.js`:
- `connectToGlobalServer(suiteName)` — connects to `MONGODB_TEST_URI`, returns `{ db, client }`
- `disconnectFromGlobalServer(client, db)` — drops database, closes connection

This eliminates the `MongoMemoryServer.create()` / `.stop()` calls from all 37 files and the `getServerOptions()` duplication.

### 4. Trivial test removal criteria

**Decision**: Delete tests that match ANY of these patterns:
- Checks a static constant's literal value (e.g., `expect(ROLE_HIERARCHY.viewer).toBe(0)`)
- Checks `.toBeDefined()` on an exported constant
- Checks `.toHaveLength(N)` on a static array
- Tests basic JavaScript behavior (e.g., identical strings are equal)
- Duplicates another test's assertion with a trivially different input

Files affected:
- `permissionUtils.test.js`: Remove 21 tests (keep 23)
- `changeDetection.test.js`: Remove 15 tests (keep 44)

### 5. Empty file handling

**Decision**: Delete the 7 empty test files entirely. They contain boilerplate setup but zero `it()` calls. If tests are needed later, they can be created fresh.

Files: `reviewerNotifications.test.js`, `recurringCalendarLoad.test.js`, `recurringDelete.test.js`, `deltaSyncOverrides.test.js`, `myEventsView.test.js`, and any others with 0 test cases.

### 6. Test skill as markdown prompt template

**Decision**: Create `~/.claude/skills/test.md` as a skill that can be invoked via `/test`. The skill instructs Claude to:
1. Read the diff or changed files
2. Grep existing tests for coverage of the same endpoint/function
3. Identify business logic boundaries worth testing (not field existence)
4. Write focused tests using existing helpers (`eventFactory`, `userFactory`, `testApp`)
5. Flag if existing tests already cover the scenario

**Alternative considered**: A full agent with its own tool config. Rejected — a skill is simpler, lighter, and sufficient since it runs in the same Claude session with full tool access.

## Risks / Trade-offs

**[Risk] Test isolation regression** — Shared server could leak state between suites if database cleanup fails.
→ Mitigation: Each suite uses a unique database name. `disconnectFromGlobalServer` drops the entire database. Even if cleanup is missed, other suites use different databases.

**[Risk] Port conflict** — Global server on port 27018 could conflict with a real MongoDB instance.
→ Mitigation: Already the case today (globalSetup.js uses port 27018). No change in behavior.

**[Risk] Test file migration errors** — 37 files need mechanical edits. Typos could break individual suites.
→ Mitigation: Changes are mechanical (replace MongoMemoryServer boilerplate with `connectToGlobalServer` call). Run full suite after migration to verify.

**[Trade-off] Single-threaded constraint** — Shared server means Jest `--workers` would share state. Currently Jest runs sequentially (`forceExit: true`), so this is not a regression. If parallelism is needed later, per-worker databases on the shared server would work.
