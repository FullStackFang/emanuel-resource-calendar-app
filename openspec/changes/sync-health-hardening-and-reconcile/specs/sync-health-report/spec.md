# sync-health-report — Delta Spec

## ADDED Requirements

### Requirement: Failed-deletion check covers both Graph linkage shapes
The deleted-but-tracked query feeding the `shouldNotBeInOutlook` check SHALL match
documents linked via `graphData.id` OR via `graphEventId` (the shape used by
exception/addition child documents, which are created with `graphData: null`).

#### Scenario: Deleted addition child still on Outlook is reported
- **WHEN** an `addition` child document has `isDeleted: true`, a non-null `graphEventId`, and its Outlook event still appears in the window's calendarView
- **THEN** the report lists that instance under `shouldNotBeInOutlook` with reason `deleted in app but still in Outlook`

#### Scenario: Deleted single instance still on Outlook is reported (regression)
- **WHEN** a single-instance document has `isDeleted: true`, a non-null `graphData.id`, and its Outlook event still appears in the window
- **THEN** the report lists that instance under `shouldNotBeInOutlook` (existing behavior preserved)

### Requirement: Report queries are owner-scoped and projected at the database
The report's Mongo queries SHALL apply the `calendarOwner` scope (when a scope is
requested) in the database query itself, matching stored owner values
case-insensitively, and SHALL project only the fields the report reads (never full
`graphData` blobs or `statusHistory` arrays).

#### Scenario: Scoped run does not fetch other mailboxes' documents
- **WHEN** the report is run scoped to one `calendarOwner`
- **THEN** the events-collection queries include an owner filter matching every stored casing of that mailbox, and documents belonging to other owners are not fetched

#### Scenario: Projection preserves finding parity
- **WHEN** the report runs over a seeded fixture set covering all four finding types with the projection applied
- **THEN** the findings are identical to those produced from unprojected documents

### Requirement: Graph retry predicate matches thrown error shape
The report's Graph retry wrapper SHALL recognize the error shape `graphApiService`
actually throws (`err.status` for HTTP failures; the verified network-error shape for
timeouts/resets), and the shared Graph API test mock SHALL construct errors with the
same builder the production service uses.

#### Scenario: Throttled Graph call is retried
- **WHEN** a Graph fetch fails with an error whose `status` is 429 or 503
- **THEN** the wrapper retries up to its attempt budget before surfacing the failure

#### Scenario: Mock errors are production-shaped
- **WHEN** `graphApiMock` simulates a Graph failure
- **THEN** the simulated error is built by the same exported error builder `graphApiService` uses to throw, carrying `status` (not `statusCode`)

### Requirement: Graph throttling is isolated from the Cosmos circuit breaker
Retry handling for Graph calls SHALL use a breaker instance separate from the
process-wide breaker that gates Cosmos DB retries.

#### Scenario: Graph 429 burst does not open the Cosmos breaker
- **WHEN** repeated Graph 429s exhaust the Graph retry budget
- **THEN** the shared Cosmos breaker records no throttle events and subsequent Cosmos retries proceed normally

### Requirement: Summary bar derives from finding arrays
The per-calendar reconciliation bar SHALL derive its "Outlook only" segment from the
`untracked` findings, such that instances flagged as problems (`shouldNotBeInOutlook`)
are never summarized as unmanaged Outlook events.

#### Scenario: Failed deletion is not counted as Outlook-only
- **WHEN** a calendar has 1 `shouldNotBeInOutlook` instance and 2 `untracked` instances
- **THEN** the bar's Outlook-only segment shows 2, not 3

### Requirement: Null app-side dates fail loudly
When an app-side document's local date resolves to `null` during report assembly, the
report SHALL log the affected document id at error level and surface the condition on
the calendar entry rather than silently producing findings with null dates.

#### Scenario: Date resolution failure is surfaced
- **WHEN** a published document yields a `null` local date (e.g. its date fields are missing after a data refactor)
- **THEN** an error-level log names the document's mongoId and the calendar's report entry indicates degraded data rather than omitting the problem silently

### Requirement: Untethered findings carry their date
An `untethered` finding SHALL carry the instance's local date for every event
type except `seriesMaster`, which is reported once for its whole pattern and
therefore has no single date. The report SHALL describe a dateless finding as
"whole series" only when it is a series master.

#### Scenario: Untethered single instance shows its date
- **WHEN** a published single-instance document has no Graph linkage
- **THEN** the finding carries that instance's date and the report row shows the date rather than "whole series"

#### Scenario: Untethered series master remains dateless
- **WHEN** a published series master has no Graph linkage
- **THEN** the finding's date is null and the row reads "whole series"

### Requirement: Stale report cache entries are removed on new run
Starting a new Run Check SHALL remove previously cached sync-health report query
entries so at most one prior result is retained in the query cache.

#### Scenario: Old run keys are evicted
- **WHEN** the user clicks Run Check for the third time in a session
- **THEN** query cache entries from runs before the previous one are removed
