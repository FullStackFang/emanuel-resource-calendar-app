## ADDED Requirements

### Requirement: TanStack Query is the canonical client-side cache for server data

All components that read server data from the calendar/reservation APIs SHALL fetch through `@tanstack/react-query` (`useQuery`, `useInfiniteQuery`) using the configured `queryClient` from `src/config/queryClient.js`. Components SHALL NOT introduce new `fetch + useEffect + useState` reading patterns once this capability lands. Existing such patterns SHALL be migrated as part of this change in `MyReservations`, `ReservationRequests`, `EventManagement`, and `Calendar`.

#### Scenario: New component reads server data via useQuery

- **WHEN** a developer adds a new view that lists events
- **THEN** the view uses `useQuery({ queryKey: [...], queryFn: ... })` and not `useEffect + setEvents(...)`

#### Scenario: Migrated MyReservations renders from cache on remount

- **WHEN** a user navigates away from MyReservations and returns within the staleTime window (5 minutes)
- **THEN** the component renders the previously fetched events instantly from the RQ cache without showing a loading spinner, and a background refetch occurs only if the data is stale

#### Scenario: Migrated ReservationRequests renders from cache on tab switch

- **WHEN** a user switches between status tabs in ReservationRequests within the staleTime window
- **THEN** previously visited tabs render their last-known data instantly from cache

### Requirement: Mutations use optimistic updates with rollback on failure

All write actions in the migrated views (approve, reject, cancel, restore, delete, edit, publish, draft-save, draft-submit, request-edit) SHALL use `useMutation` with `onMutate` (apply optimistic update to cache), `onError` (roll back to the previous snapshot), and `onSettled` or `onSuccess` (invalidate or update the affected queries).

#### Scenario: Approve action shows immediate feedback

- **WHEN** an approver clicks Approve on a pending event
- **THEN** the event's status flips to `published` in the UI before the network round-trip completes, and the approval queue counter decrements optimistically

#### Scenario: Server rejects mutation and UI rolls back

- **WHEN** a mutation fails (network error, 409 version conflict, 403, etc.)
- **THEN** the cache is restored to the pre-mutation snapshot, the user sees an error toast, and no stale optimistic state persists

#### Scenario: Mutation success invalidates dependent queries

- **WHEN** a successful approve completes
- **THEN** the approval-queue list query, the approval-queue counts query, and the calendar list query are all invalidated (or updated) so subsequent reads observe the new state

### Requirement: Query keys follow a stable conventional shape

Query keys SHALL be arrays whose first element is the resource name (e.g., `'events'`, `'reservations'`, `'locations'`, `'categories'`) and whose subsequent elements are scope discriminators (`view`, `userId`, filter object, etc.). The conventions SHALL be documented in a code comment in `src/config/queryClient.js` or a dedicated `src/queries/keys.js` factory.

#### Scenario: List query key includes view scope

- **WHEN** a component fetches events with `view='approval-queue'`
- **THEN** the query key is `['events', 'list', { view: 'approval-queue', ...filters }]` so it does not collide with `view='my-events'` or `view='admin-browse'`

#### Scenario: Detail query key includes event id

- **WHEN** a component fetches a single event for a review modal
- **THEN** the query key is `['events', 'detail', eventId]` so detail caches are addressable for `setQueryData` from SSE updates

### Requirement: SSE broadcasts bridge into the query cache, not into a parallel event bus

`useServerEvents` SHALL translate every received `event-changed` SSE message into a corresponding `queryClient.invalidateQueries(...)` (or, when the SSE payload includes the full updated event document, `queryClient.setQueryData(...)`). The custom `useDataRefreshBus.dispatchRefresh` channel SHALL be retired once no subscribers remain. During the migration, `dispatchRefresh` MAY remain as a back-compat shim that also runs the bridge's invalidations.

#### Scenario: SSE event-changed invalidates the matching list

- **WHEN** the server broadcasts `{ action: 'created', eventId, view: 'approval-queue' }`
- **THEN** the client invalidates queries with prefix `['events', 'list']` so the approval queue refetches its data on next focus or immediately if mounted

#### Scenario: SSE payload with full document updates cache directly

- **WHEN** the server broadcasts an event-changed message that includes the full updated event document
- **THEN** the client calls `queryClient.setQueryData(['events', 'detail', eventId], updatedDoc)` and selectively patches the matching item inside the relevant `['events', 'list', ...]` cache entry, avoiding a refetch round-trip

#### Scenario: Server-restart signal triggers cross-cutting invalidation

- **WHEN** `useServerEvents` detects a new `serverStartId` indicating a server restart
- **THEN** the client calls `queryClient.invalidateQueries({ queryKey: ['events'] })` and `queryClient.invalidateQueries({ queryKey: ['reservations'] })` so every events/reservations query refetches on next access

### Requirement: useDataRefreshBus is fully retired by end of migration

After the last subscriber migrates to RQ, the `useDataRefreshBus` module and all `dispatchRefresh` call sites SHALL be removed. The retirement SHALL be the final step of this capability's rollout — not a parallel ongoing system.

#### Scenario: Codebase grep finds no references after retirement

- **WHEN** the change reaches its archive step
- **THEN** `git grep -n 'useDataRefreshBus\|dispatchRefresh'` returns zero matches in `src/`

#### Scenario: SSEContext exposes only the bridge, not the bus

- **WHEN** a future component wants to react to SSE
- **THEN** the only documented path is "subscribe via React Query and let the bridge invalidate your query keys"

### Requirement: Persisted cache respects sensitive data scope

The persisted query cache SHALL continue to use `sessionStorage` (already configured in `src/config/queryClient.js`) so that sensitive event data (attendees, room details, descriptions) is cleared when the tab closes. The persistence SHALL NOT be migrated to `localStorage`. The 24-hour `maxAge` cap SHALL be retained.

#### Scenario: Tab close clears the persisted cache

- **WHEN** the user closes the browser tab and reopens the app in a new tab
- **THEN** no persisted RQ cache from the previous session is loaded — the app fetches fresh data
