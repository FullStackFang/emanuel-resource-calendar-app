## ADDED Requirements

### Requirement: SSE reconnect retries indefinitely with capped exponential backoff

The SSE client hook (`useServerEvents`) SHALL retry a dropped or failed SSE connection indefinitely until the component unmounts or the tab is hidden. Backoff delay SHALL follow an exponential schedule (1s, 2s, 4s, 8s, ...) capped at 30 seconds. The reconnect attempt counter SHALL reset to zero on every successful connection (defined as receiving the `connected` SSE event). Reconnect SHALL NOT permanently fall back to polling-only after any finite number of attempts.

#### Scenario: Transient network failure reconnects

- **WHEN** the browser loses network for 45 seconds and then regains it
- **THEN** the client continues attempting reconnect, succeeds once connectivity returns, and resumes receiving `event-changed` messages without requiring a page reload

#### Scenario: Extended server outage never disables SSE

- **WHEN** the backend is unreachable for 10 minutes
- **THEN** the client has made reconnect attempts at 1s, 2s, 4s, 8s, 16s, 30s, 30s, 30s, ... intervals (without giving up), and reconnects successfully within one 30s window of the server returning

#### Scenario: Successful connect resets backoff

- **WHEN** the client has attempted 5 failed reconnects and then the next attempt succeeds
- **THEN** a subsequent disconnect starts a new backoff schedule at 1s (not at the continued 32s)

### Requirement: Freshness indicator reflects live SSE connection state

The `FreshnessIndicator` component SHALL render a status indicator reflecting one of three SSE states: `live` (SSE connection is open and receiving events), `reconnecting` (a reconnect attempt is in progress), or `offline` (no SSE connection and not currently attempting). The state SHALL be exposed from `SSEContext` as a `sseStatus` value derived from `useServerEvents` internal state. The visual treatment of the three states SHALL be distinguishable without requiring hover text (for example, different colors or icon glyphs).

#### Scenario: SSE is connected

- **WHEN** the SSE connection is open and the last `connected` event was received less than 30 seconds ago
- **THEN** `sseStatus` is `'live'` and `FreshnessIndicator` renders the live visual state

#### Scenario: SSE is reconnecting

- **WHEN** the SSE connection dropped and the client has scheduled or is actively attempting reconnect
- **THEN** `sseStatus` is `'reconnecting'` and `FreshnessIndicator` renders the reconnecting visual state

#### Scenario: SSE is disabled

- **WHEN** the component has unmounted its SSE subscription or the tab has been hidden long enough that the connection was closed
- **THEN** `sseStatus` is `'offline'` and `FreshnessIndicator` renders the offline visual state

### Requirement: Polling interval adapts based on SSE connection state

Each call site of the `usePolling` hook that drives a view's freshness (Calendar, ReservationRequests / Approval Queue, MyReservations, EventManagement) SHALL pass an interval value that is 300000 ms (5 minutes) when `sseStatus` is `'live'` and 30000 ms (30 seconds) when `sseStatus` is `'reconnecting'` or `'offline'`. This adjustment SHALL be evaluated reactively so that a change in `sseStatus` causes `usePolling` to adopt the new interval on its next scheduling cycle.

#### Scenario: SSE live uses the 5-minute sanity interval

- **WHEN** a user is viewing the Approval Queue and SSE is connected
- **THEN** the polling interval for that view is 5 minutes (it acts as a sanity re-sync, not the primary freshness path)

#### Scenario: SSE offline uses the 30-second fallback interval

- **WHEN** the SSE connection drops and enters reconnecting state
- **THEN** the polling interval tightens to 30 seconds so the blind window between pushed updates is bounded in the tens of seconds

#### Scenario: Reconnect success relaxes the interval again

- **WHEN** SSE reconnects after a period of being offline
- **THEN** the polling interval returns to 5 minutes on the next scheduling cycle

### Requirement: Client detects server-restart signal and forces full view refresh

The SSE client SHALL inspect the `connected` event payload for a `serverStartId` field. The client SHALL persist the most recently seen `serverStartId` in memory for the lifetime of the tab. On receiving a `connected` event whose `serverStartId` differs from the last-seen value, the client SHALL dispatch a refresh event for every view it has subscribed via `useDataRefreshBus` so that each view issues a scoped refetch against its existing permission-enforcing endpoint. If the `connected` event does not include a `serverStartId` field (for example, because the backend has not yet shipped the sibling Phase 2 change), the client SHALL ignore the absence and behave as before (no force-refetch on that reconnect).

#### Scenario: Server restart forces refresh of every subscribed view

- **WHEN** the backend restarts while the client is connected, emitting a new `serverStartId` on the client's next `connected` event
- **THEN** the client dispatches `data-refresh` events for every subscribed view and each view refetches its data via its existing endpoint

#### Scenario: Reconnect without restart does not force refresh

- **WHEN** the client reconnects after a transient blip and the `serverStartId` matches the last-seen value
- **THEN** no view-level refresh is dispatched; normal `lastEventId` replay covers the gap

#### Scenario: Absent serverStartId is tolerated

- **WHEN** the backend has not yet shipped `serverStartId` emission and the `connected` event payload does not include that field
- **THEN** the client does not force-refetch any view on that reconnect; it relies solely on normal replay and subsequent `event-changed` broadcasts

#### Scenario: First connect establishes the baseline

- **WHEN** the client connects for the first time in a tab and receives a `connected` event with a `serverStartId`
- **THEN** the client records it as the baseline without dispatching any refresh (there is no prior value to compare against)

### Requirement: Calendar view rejects broadcast appends outside current date range

The Calendar view's `handleCalendarBusEvent` logic SHALL NOT append an event to its in-memory list if the event's `startDateTime` falls outside the currently loaded calendar date range. The handler SHALL evaluate the date-range bounds against the event's start time and silently ignore out-of-window events (the user will see them when navigating to the corresponding date). This requirement applies to `action = 'created'` and `action = 'published'` SSE broadcast paths.

#### Scenario: Created event inside current window is appended

- **WHEN** a `created` broadcast arrives for an event whose `startDateTime` is within the Calendar's current date range
- **THEN** the event is appended to `allEvents` and becomes visible immediately

#### Scenario: Created event outside current window is ignored

- **WHEN** a `created` broadcast arrives for an event whose `startDateTime` falls before or after the Calendar's current date range
- **THEN** the event is not appended to `allEvents` and the view does not show a transient entry that would vanish on next navigation
