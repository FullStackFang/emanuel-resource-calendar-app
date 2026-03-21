## ADDED Requirements

### Requirement: Test skill file exists and is invocable
A skill file SHALL exist at `~/.claude/skills/test.md` that can be invoked via `/test` in Claude Code.

#### Scenario: User invokes /test
- **WHEN** user types `/test` in Claude Code
- **THEN** the skill prompt is loaded into context and guides Claude's test-writing behavior

### Requirement: Skill enforces coverage-first approach
The skill SHALL instruct Claude to check existing test coverage before writing new tests.

#### Scenario: Existing tests already cover the endpoint
- **WHEN** Claude is asked to write tests for an endpoint that already has tests
- **THEN** Claude reports existing coverage and only adds tests for uncovered scenarios

#### Scenario: No existing tests for the endpoint
- **WHEN** Claude is asked to write tests for an untested endpoint
- **THEN** Claude writes tests covering: happy path, permission boundaries, state guards, and error cases

### Requirement: Skill defines what NOT to test
The skill SHALL explicitly list anti-patterns that produce low-value tests.

#### Scenario: Skill prevents trivial tests
- **WHEN** Claude follows the skill
- **THEN** it does not write tests that check static constants, field existence without logic, or basic JavaScript behavior

### Requirement: Skill uses project test helpers
The skill SHALL instruct Claude to use existing test helpers (`eventFactory`, `userFactory`, `testApp`, `authHelpers`) rather than writing custom setup code.

#### Scenario: Test uses eventFactory
- **WHEN** Claude writes an integration test
- **THEN** it uses `createPendingEvent()`, `createDraftEvent()`, etc. from `eventFactory.js` for test data

### Requirement: Skill targets business logic boundaries
The skill SHALL prioritize testing permission boundaries, state transitions, conflict detection, and data contracts over response shape validation.

#### Scenario: Skill prioritizes business logic
- **WHEN** Claude analyzes an endpoint for test coverage
- **THEN** it identifies and tests: who can call it (roles), what states it accepts (status guards), what side effects it produces (Graph sync, email, audit), and what it rejects (conflicts, validation)
