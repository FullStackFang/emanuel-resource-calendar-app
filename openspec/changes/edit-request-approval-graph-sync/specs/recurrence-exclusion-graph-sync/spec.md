## ADDED Requirements

### Requirement: Exclusion delta is computed, not the whole list
The system SHALL expose `exclusionsAdded(oldRecurrence, newRecurrence)` in `utils/recurrenceCompare.js`, returning the `YYYY-MM-DD` strings present in `new.exclusions` and absent from `old.exclusions`, string-normalised, without mutating its inputs and with no dependencies.

#### Scenario: Pure set difference
- **WHEN** old exclusions are `['2026-10-14']` and new are `['2026-10-14', '2026-11-04']`
- **THEN** the result is `['2026-11-04']`

#### Scenario: Missing arrays
- **WHEN** either recurrence is `null` or lacks `exclusions`
- **THEN** the missing side is treated as empty and no error is thrown

### Requirement: Exclusion sync helper takes a date list and is timezone-aware
`syncRecurrenceExclusionsToGraph` SHALL accept the list of dates to cancel and a timezone, SHALL resolve each date with `findGraphOccurrenceForDate`, and SHALL return `{ cancelledOccurrences, notFound, failed }`. Publish, draft submit, and both restore callers pass the full exclusion list and the created event's timezone.

#### Scenario: Publish cancellations now carry the timezone
- **WHEN** a series with two exclusions is published
- **THEN** `getCallHistory('getRecurringEventInstances')` has two entries, each with a `timeZone` equal to the created event's `start.timeZone` and a window from the day before to the day after the date, and `getCallHistory('deleteCalendarEvent')` has two entries

### Requirement: Published-series reconciliation cancels newly excluded dates
`reconcilePublishedSeries` SHALL, for a published master saved or approved with `editScope` null or `allEvents`, cancel the Graph instance for each date in `exclusionsAdded(stored, saved)`, or the full `saved.exclusions` when `recurrenceRewritten` is true (D0). Each cancellation SHALL be recorded with `$addToSet` into `graphData.cancelledOccurrences`.

#### Scenario: Excluding a date from the Recurrence tab on admin Save reaches Outlook
- **WHEN** an admin saves a published weekly series adding `2026-10-14` to `recurrence.exclusions` and the Graph mock returns an instance on that date
- **THEN** `getCallHistory('deleteCalendarEvent')` has one entry with that instance id and the master's `graphData.cancelledOccurrences` contains `{ date: '2026-10-14', graphId }`

#### Scenario: Earlier cancellations are preserved
- **WHEN** the master's `graphData.cancelledOccurrences` already holds one entry from publish and a save adds a second exclusion
- **THEN** the array holds both entries afterwards

#### Scenario: Instance already gone
- **WHEN** the Graph mock returns no instance for the newly excluded date
- **THEN** no delete is attempted and the save succeeds

#### Scenario: Lookup asks for the event's timezone
- **WHEN** the instance lookup runs
- **THEN** `getCallHistory('getRecurringEventInstances')[0].timeZone` equals the master's stored Graph timezone and the window spans the day before through the day after

#### Scenario: Recurrence rewritten cancels the full list
- **WHEN** `recurrenceRewritten` is true and the saved recurrence has two exclusions, one pre-existing
- **THEN** both dates are looked up and any instance found is deleted

### Requirement: Excluding a date that has a child document removes the child
When a newly excluded date has a live `exception` or `addition` child, the system SHALL soft-delete the child via `softDeleteException`, delete the child's `graphEventId` event when present, and SHALL NOT look for a series instance on that date.

#### Scenario: Excluded added date
- **WHEN** a save excludes a date that has an `addition` child with a `graphEventId`
- **THEN** the child has `isDeleted: true`, `getCallHistory('deleteCalendarEvent')` has one entry with the child's `graphEventId`, and `getCallHistory('getRecurringEventInstances')` is empty

### Requirement: Repair script cancels historical exclusion drift
`backend/backfill-exclusion-graph-cancellations.js` SHALL, for every published, non-deleted series master with `graphData.id` and at least one exclusion, cancel any Graph instance still present on an excluded date, applying the child-document rule above first. It SHALL support `--dry-run` (list, print the timezone used per lookup, no writes), `--verify` (count exclusions still resolvable in Graph), batch in groups of 25 with a one-second pause, use `withGraphRetry`, print a progress bar, be idempotent, record cancellations with `$addToSet`, and report masters lacking `graphData.id` without touching them.

#### Scenario: Dry run names the live incident
- **WHEN** the script runs with `--dry-run` against a collection containing the master `evt-request-1780078660390-6l4gmxc9j` and the Graph mock still has its 10/14 instance
- **THEN** the output lists that master, the date, and the timezone used, and `getCallHistory('deleteCalendarEvent')` is empty

#### Scenario: Apply then verify
- **WHEN** the script is run without flags and then with `--verify`
- **THEN** the first run deletes each listed instance and appends to `graphData.cancelledOccurrences`, and the verify run reports zero still-present excluded dates

#### Scenario: Re-run is a no-op
- **WHEN** the script is run a second time
- **THEN** every exclusion resolves to no instance and nothing is deleted
