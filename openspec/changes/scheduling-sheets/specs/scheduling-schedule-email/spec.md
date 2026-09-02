# scheduling-schedule-email

## ADDED Requirements

### Requirement: Per-person schedule emails, day or workbook scoped
`POST /api/scheduling-sheets/:sheetId/email` (manager-gated) SHALL send one email per distinct person-chip email in scope — either one day (`{ dayId }`) or the whole workbook (`{ wholeSheet: true }`) — each containing all of that person's assignments in scope, chronologically, including row label, column name and times, effective call time, and cell notes. An optional `recipients` list SHALL restrict sending to a subset of in-scope emails.

#### Scenario: One email per person across columns
- **WHEN** a person is tagged in 3 cells across 2 columns of one day and a day-scoped send runs
- **THEN** exactly one email is sent to them listing all 3 assignments

#### Scenario: Workbook scope spans days
- **WHEN** a person is tagged on Sep 11 and Sep 20 and a whole-sheet send runs
- **THEN** their single email covers both days

### Requirement: Placeholder hard-block with admin override
The send SHALL fail with 422 `UNRESOLVED_PLACEHOLDERS` (no emails dispatched) while placeholder person chips exist in scope. An admin MAY pass `allowPlaceholders: true` to send anyway; non-admin managers MUST NOT be able to override.

#### Scenario: Blocked send
- **WHEN** the scope contains a `@placeholder` chip and no override
- **THEN** the response is 422 and zero emails are sent

#### Scenario: Admin override
- **WHEN** an admin sends with `allowPlaceholders: true`
- **THEN** emails go to all resolved recipients and placeholders are skipped

#### Scenario: Non-admin cannot override
- **WHEN** an events-department non-admin sends with `allowPlaceholders: true`
- **THEN** the response is 422 (override ignored) or 403 for the override flag

### Requirement: Per-recipient failure isolation
Sends SHALL fan out per recipient (via `Promise.allSettled` semantics); one failing address SHALL NOT prevent other sends. The response SHALL report `{ email, success, error }` per recipient. Any retry logic added later MUST use `retryWithBackoff`.

#### Scenario: One bad address
- **WHEN** 7 recipients are in scope and one address makes the email service throw
- **THEN** 6 emails send, the response marks the one failure with its error, and HTTP status is 200

### Requirement: Email log and staleness
Each successful send SHALL append `{ email, sentAt, sentBy }` to the day's `emailLog`. A recipient's schedule SHALL be considered stale when the day's `lastModifiedAt` is later than their most recent `sentAt`; the management UI SHALL surface sent / not-yet-sent / stale per person.

#### Scenario: Edit after send marks stale
- **WHEN** a cell is edited after a person's successful send
- **THEN** that person's status reads as stale (emailed, but changed since)

### Requirement: ASSIGNMENT_SCHEDULE template in the registry
The email SHALL use a new `ASSIGNMENT_SCHEDULE` entry in `emailTemplates.js` `TEMPLATE_IDS` with a `CTA_CONFIG` classification (EU-14 compliance). The subject SHALL be day-scoped ("Your assignments for Friday, September 11"; workbook scope names the workbook), the body SHALL carry the sheet title, and the CTA SHALL link to My Assignments — a documented deviation from the eventUrl deep-link convention, harmless to external recipients whose full schedule is in the body. External and placeholder-free recipients require no app account for the email to be complete.

#### Scenario: Template registered
- **WHEN** the email templates test suite runs
- **THEN** `ASSIGNMENT_SCHEDULE` is classified in `CTA_CONFIG` (or `NO_CTA_TEMPLATES`) and EU-14 passes

#### Scenario: External recipient self-contained
- **WHEN** an external person (no account) receives their schedule
- **THEN** the email body contains their full assignment details without requiring login
