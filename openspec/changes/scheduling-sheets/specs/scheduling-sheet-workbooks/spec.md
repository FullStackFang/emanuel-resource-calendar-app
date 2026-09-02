# scheduling-sheet-workbooks

## ADDED Requirements

### Requirement: Assignment-manager permission gate
The system SHALL expose a `canManageAssignments` permission equal to `isAdmin OR department === 'events'`, computed in `permissionUtils.js`, returned by `getPermissions()`, and enforced on all scheduling-sheet write/read management endpoints by a `requireAssignmentManager` middleware that re-fetches the user record via `findUserByIdentity` before checking (JWT claims MUST NOT be trusted for department).

#### Scenario: Events-department requester is admitted
- **WHEN** a user with role `requester` and department `events` calls any `/api/scheduling-sheets/*` management endpoint
- **THEN** the request is authorized (200-family response)

#### Scenario: Non-events non-admin is rejected
- **WHEN** a user with role `approver` and department `facilities` calls a scheduling-sheet management endpoint
- **THEN** the response is 403

#### Scenario: Department read from database, not token
- **WHEN** a request's JWT carries no department claim but the user's DB record has department `events`
- **THEN** the request is authorized

### Requirement: Workbook lifecycle
The system SHALL support creating, renaming, and deleting Scheduling Sheet workbooks. A workbook has a required name. Deleting a workbook SHALL delete its day sheets.

#### Scenario: Create workbook
- **WHEN** a manager POSTs `{ name: '2026 High Holy Days' }`
- **THEN** a workbook document is created with audit fields and returned with its id

#### Scenario: Delete cascades to days
- **WHEN** a manager deletes a workbook that has 3 day sheets
- **THEN** the workbook and all 3 day documents are removed

### Requirement: Day tabs group arbitrary dates within a workbook
A workbook SHALL contain zero or more day sheets, each identified by a date-only string (`YYYY-MM-DD`). Dates within a workbook MAY be non-adjacent. A workbook SHALL NOT contain two day sheets for the same date. The same calendar date MAY exist in different workbooks.

#### Scenario: Disjoint days
- **WHEN** a manager adds days 2026-09-11, 2026-09-12, and 2026-09-20 to one workbook
- **THEN** all three day sheets exist under that workbook

#### Scenario: Duplicate date in one workbook rejected
- **WHEN** a manager adds day 2026-09-11 to a workbook that already has 2026-09-11
- **THEN** the response is 400 with code `DUPLICATE_DATE`

#### Scenario: Same date in two workbooks allowed
- **WHEN** 2026-09-11 exists in workbook A and a manager adds 2026-09-11 to workbook B
- **THEN** the creation succeeds

### Requirement: Day creation seeds starter rows
Creating a day sheet SHALL seed five starter rows in order — Location, Call Time, Doors Open, Begins, Ends — marked `kind: 'starter'`, with an optional title and no columns.

#### Scenario: New day is seeded
- **WHEN** a manager creates a day with date 2026-09-11 and title '2026 Erev Rosh Hashanah'
- **THEN** the stored day has exactly five rows labeled Location, Call Time, Doors Open, Begins, Ends and an empty columns array

### Requirement: Copy a day or a workbook
The system SHALL support creating a day from a copy of another day (structure, rows, columns, cells, and people carry; the new date is supplied by the caller) and creating a workbook from a copy of another workbook (day structures mapped in date order onto caller-supplied new dates; excess source days dropped, excess target dates created blank). Copies SHALL NOT copy `emailLog`.

#### Scenario: Day copy carries content, resets email log
- **WHEN** a manager creates day 2027-09-30 in a workbook copying day 2026-09-11
- **THEN** the new day has the source's rows, columns, and cells, and an empty `emailLog`

#### Scenario: Workbook copy maps dates in order
- **WHEN** a manager copies a 2-day workbook onto 3 seeded dates
- **THEN** the first two new days carry the source days' structures in date order and the third is a blank seeded day

### Requirement: Structural writes use optimistic concurrency
Day-sheet structural operations (title, add/remove/rename/reorder rows and columns, link/unlink event) SHALL go through `conditionalUpdate()` gated on `_version` with `expectedVersion` from the client, returning the standard 409 `VERSION_CONFLICT` envelope on mismatch.

#### Scenario: Stale structural edit conflicts
- **WHEN** two managers load version 3 and both rename a column, and the second submits `expectedVersion: 3` after the first succeeded
- **THEN** the second receives 409 with `VERSION_CONFLICT`

### Requirement: Deep link to a workbook day
The management route SHALL accept `?sheet=<workbookId>&date=YYYY-MM-DD` and open that workbook with that day's tab active when both exist.

#### Scenario: Deep link opens the day
- **WHEN** a manager navigates to `/admin/scheduling-sheets?sheet=<id>&date=2026-09-11`
- **THEN** the workbook is active with the 2026-09-11 tab selected

### Requirement: Navigation mirrors Calendar Markers placement
Managers SHALL reach the workbook from the Admin dropdown (admins) or a top-level nav link (events-department non-admins). Users without `canManageAssignments` SHALL NOT see the workbook nav entry and SHALL be redirected by the route guard.

#### Scenario: Non-manager redirected
- **WHEN** a user without `canManageAssignments` opens `/admin/scheduling-sheets`
- **THEN** the route guard redirects them away and no workbook data is fetched
