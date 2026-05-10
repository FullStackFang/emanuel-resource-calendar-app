## ADDED Requirements

### Requirement: First-load gate uses `query.isPending`

Any React component that derives its primary `loading` flag from a TanStack Query (v5) result SHALL use `query.isPending` rather than `query.isLoading`. The `loading` flag SHALL evaluate to `true` continuously from the moment the query becomes enabled until the first response (success or error) resolves, including the `pending && idle` window between `enabled` flipping to `true` and the request being scheduled.

#### Scenario: Cold-token first paint shows spinner, never empty-state

- **WHEN** a list component using a TanStack Query mounts with `apiToken === null`
- **AND** `apiToken` then transitions to a valid token, causing the query's `enabled` flag to flip from `false` to `true`
- **THEN** the component SHALL render a loading spinner for the entire interval from token arrival through fetch resolution
- **AND** the component SHALL NOT render its empty-state branch at any tick during that interval

#### Scenario: Empty-state appears only after first fetch resolves with empty data

- **WHEN** the first fetch for a TanStack Query completes with an empty array
- **THEN** the component SHALL render its empty-state branch
- **AND** subsequent background refetches SHALL NOT cause the empty-state to flicker

### Requirement: Silent-refresh suppresses empty-state during background refetch

Components that expose an `isSilentRefreshing` (or equivalently named) flag SHALL derive it as `query.isFetching && !query.isPending`. The flag SHALL be `true` only when a fetch is in progress *and* prior data has already resolved. The empty-state branch SHALL be suppressed whenever `isSilentRefreshing` is `true`.

#### Scenario: Background refetch with prior data does not flash empty-state

- **WHEN** a query has previously resolved with a non-empty array
- **AND** an SSE invalidation, polling tick, or mutation invalidation triggers a refetch
- **THEN** the component SHALL continue to render the previously-resolved data
- **AND** the empty-state SHALL NOT appear during the refetch
- **AND** if the refetch resolves with an empty array, the empty-state SHALL render only after the refetch completes

### Requirement: Empty-state rendering predicate

The empty-state branch in any list component using a TanStack Query SHALL be guarded by the predicate `!query.isPending && data.length === 0 && !isSilentRefreshing`. Components MUST NOT render an empty-state at any other time.

#### Scenario: Empty-state predicate evaluated on each render

- **WHEN** a list component renders
- **THEN** the empty-state element SHALL be present in the DOM if and only if `!query.isPending && data.length === 0 && !isSilentRefreshing` evaluates to `true`

### Requirement: Calendar init-error path keeps overlay visible

When the Calendar's initialization effect fails (catch block of `initializeApp`), the component SHALL set its imperative `loading` state to `true` before clearing `initializing`. The loading overlay SHALL remain visible until either the consolidated effect's `loadEvents` resolves and clears `loading`, or the initialization timeout fires and surfaces a hard-error UI.

#### Scenario: Init effect throws, overlay stays visible

- **WHEN** the Calendar's `initializeApp` throws during one of its parallel calls (`loadUserProfile`, `loadAvailableCalendars`, `loadSchemaExtensions`)
- **THEN** the catch block SHALL invoke `setLoading(true)` before invoking `setInitializing(false)`
- **AND** the loading overlay element SHALL remain in the DOM with the `visible` class throughout the transition
- **AND** the overlay SHALL only hide when `loadEvents` completes its `finally` block

### Requirement: Convention is documented in `CLAUDE.md`

The `CLAUDE.md` file at the repository root SHALL contain a documented convention under "Key Architectural Patterns" naming the TanStack Query primitive used as the first-load gate (`isPending`), the primitive used to detect background refresh (`isFetching && !isPending`), and the empty-state predicate. The convention SHALL be the single normative reference for new TanStack Query consumers.

#### Scenario: New TanStack Query consumer follows the documented convention

- **WHEN** a future component is added that consumes a TanStack Query result
- **THEN** the component author can find the loading-state convention in `CLAUDE.md` under "Key Architectural Patterns"
- **AND** the convention names `isPending`, `isFetching && !isPending`, and the empty-state predicate explicitly
