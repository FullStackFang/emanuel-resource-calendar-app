# scheduling-assignments-view

## ADDED Requirements

### Requirement: Derived my-assignments endpoint
`GET /api/my-assignments` SHALL be available to any authenticated user and SHALL return the requesting user's assignments derived from person chips: day docs matched by `{ taggedEmails: <token email lowercased>, date >= today }` via the `{ taggedEmails: 1, date: 1 }` index using plain equality (never `$regex`). The response SHALL contain only the caller's own extracted cells (workbook name, day date and title, row label, column name, column times, effective call time, cell notes) — never the full sheet.

#### Scenario: User sees own assignments only
- **WHEN** a user tagged in 2 cells of one day and 1 cell of another calls the endpoint
- **THEN** they receive 3 assignment entries and no data about other people's cells

#### Scenario: Case-insensitive match
- **WHEN** the token email is 'Sarah@EmanuelNYC.org' and chips were stored lowercased
- **THEN** the user's assignments are returned

#### Scenario: Untagged user gets empty list
- **WHEN** a user with no person chips anywhere calls the endpoint
- **THEN** the response is 200 with an empty array

### Requirement: My Assignments screen
A read-only My Assignments surface SHALL be reachable by any authenticated user, listing upcoming assignments grouped by day (workbook named on each group), with an empty state, and SHALL derive its loading primitives from `deriveListLoadingState` (spinner on first load, no empty-state flash during silent refresh).

#### Scenario: Grouped by day
- **WHEN** a user has assignments on Sep 20 and Sep 21 in the same workbook
- **THEN** the screen shows two day groups, each naming the workbook

#### Scenario: No first-paint empty flash
- **WHEN** the screen mounts while the query is pending and idle
- **THEN** the loading state renders, not the empty state

### Requirement: Effective call time
Each assignment entry SHALL present the person's effective call time: the person segment's `callTimeOverride` when set, otherwise the column's Call Time row value when present.

#### Scenario: Override wins
- **WHEN** the column call time is 16:30 and the person's override is 16:00
- **THEN** the entry shows 16:00
