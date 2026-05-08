## MODIFIED Requirements

### Requirement: Client detects server-restart signal and forces full view refresh

The SSE client SHALL inspect the `connected` event payload for a `serverStartId` field. The client SHALL persist the most recently seen `serverStartId` in memory for the lifetime of the tab. On receiving a `connected` event whose `serverStartId` differs from the last-seen value, the client SHALL invalidate every relevant query in the React Query cache (notably `['events']` and `['reservations']` query-key prefixes) so that mounted views refetch their data on next access via their existing permission-enforcing endpoints. If the `connected` event does not include a `serverStartId` field, the client SHALL ignore the absence and behave as before (no force-refetch on that reconnect).

During the migration period defined by the architecture-and-performance-uplift change, the client MAY additionally call the legacy `dispatchRefresh` channel for any subscriber that has not yet migrated to React Query. Once all subscribers have migrated, that legacy call SHALL be removed and the cache invalidation SHALL be the sole mechanism for forcing post-restart refresh.

#### Scenario: Server restart invalidates relevant query caches

- **WHEN** the backend restarts while the client is connected, emitting a new `serverStartId` on the client's next `connected` event
- **THEN** the client calls `queryClient.invalidateQueries({ queryKey: ['events'] })` and `queryClient.invalidateQueries({ queryKey: ['reservations'] })`, and any mounted view refetches its data via its existing endpoint on next access

#### Scenario: Reconnect without restart does not force refresh

- **WHEN** the client reconnects after a transient blip and the `serverStartId` matches the last-seen value
- **THEN** no view-level cache invalidation is dispatched; normal `lastEventId` replay covers the gap

#### Scenario: Absent serverStartId is tolerated

- **WHEN** the `connected` event payload does not include a `serverStartId` field
- **THEN** the client does not invalidate any query cache on that reconnect; it relies solely on normal replay and subsequent `event-changed` broadcasts

#### Scenario: First connect establishes the baseline

- **WHEN** the client connects for the first time in a tab and receives a `connected` event with a `serverStartId`
- **THEN** the client records it as the baseline without invalidating any cache (there is no prior value to compare against)

#### Scenario: Legacy dispatchRefresh runs only during migration

- **WHEN** the change is archive-ready and the migration retirement step has run
- **THEN** the SSE client no longer calls `dispatchRefresh`; cache invalidation is the only mechanism, and `useDataRefreshBus` no longer exists in the codebase
