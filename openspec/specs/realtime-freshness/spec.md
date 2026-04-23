# realtime-freshness Specification

## Purpose

Governs how the frontend stays fresh in response to server-side mutations while remaining resilient to connection loss and server restarts. Covers the SSE client reconnect discipline, the user-facing freshness/connection indicator, the polling interval's adaptation to SSE health, the server-restart detection protocol (via `serverStartId`), and the guard against broadcast-driven view updates that fall outside the currently loaded window.

## Requirements

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

The SSE client SHALL inspect the `connected` event payload for a `serverStartId` field. The client SHALL persist the most recently seen `serverStartId` in memory for the lifetime of the tab. On receiving a `connected` event whose `serverStartId` differs from the last-seen value, the client SHALL dispatch a refresh event for every view it has subscribed via `useDataRefreshBus` so that each view issues a scoped refetch against its existing permission-enforcing endpoint. If the `connected` event does not include a `serverStartId` field, the client SHALL ignore the absence and behave as before (no force-refetch on that reconnect).

#### Scenario: Server restart forces refresh of every subscribed view

- **WHEN** the backend restarts while the client is connected, emitting a new `serverStartId` on the client's next `connected` event
- **THEN** the client dispatches `data-refresh` events for every subscribed view and each view refetches its data via its existing endpoint

#### Scenario: Reconnect without restart does not force refresh

- **WHEN** the client reconnects after a transient blip and the `serverStartId` matches the last-seen value
- **THEN** no view-level refresh is dispatched; normal `lastEventId` replay covers the gap

#### Scenario: Absent serverStartId is tolerated

- **WHEN** the `connected` event payload does not include a `serverStartId` field
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

### Requirement: Server emits a stable serverStartId on the SSE connected event

The SSE service SHALL generate a `serverStartId` value once per process lifetime at module load. The value SHALL be stable for the duration of that process and SHALL differ (with overwhelming probability) between process lifetimes, including intentional restarts, auto-heal restarts, and deploy-driven restarts. Every SSE `connected` event the server emits SHALL include the current `serverStartId` in its JSON payload alongside the existing `userId` and `timestamp` fields.

#### Scenario: First-time connect carries serverStartId

- **WHEN** a new client opens an SSE stream via `/api/sse/events` with a valid ticket
- **THEN** the first message it receives is a `connected` event whose JSON payload contains a non-empty `serverStartId` field

#### Scenario: All subsequent connects during the same process see the same serverStartId

- **WHEN** multiple clients connect during the same server process lifetime
- **THEN** every one of their `connected` events carries the same `serverStartId` value

#### Scenario: Restart yields a new serverStartId

- **WHEN** the server process restarts and a client subsequently reconnects
- **THEN** the new `connected` event carries a `serverStartId` that is different from the value any client received before the restart

### Requirement: Broadcast waits for write-to-read consistency before fanning out

The `broadcastEventChange` function SHALL interpose a short non-blocking delay between the successful completion of the mutation's database write and the emission of the resulting SSE event to subscribers. The delay SHALL be at least 150 ms and SHALL NOT block the HTTP response to the originating writer (i.e., the writer's request returns to its caller before or independently of the delay). The delay SHALL be applied centrally inside `broadcastEventChange` so that all invocation sites inherit it without per-site modification. The delay value SHALL be configurable via a module-level constant.

#### Scenario: Broadcast is delayed by at least 150 ms

- **WHEN** a mutation completes and calls `broadcastEventChange(...)`
- **THEN** subscribers receive the `event-changed` SSE message no sooner than 150 ms after the database write confirmation

#### Scenario: Writer's HTTP response is not blocked by the broadcast delay

- **WHEN** the writer issues a `POST /api/events/request` and the backend calls `broadcastEventChange(...)`
- **THEN** the writer's HTTP response returns without waiting for the 150 ms delay to elapse

#### Scenario: Broadcast delay covers Cosmos write-to-read consistency window

- **WHEN** a new request is created and the broadcast fires after the 150 ms delay
- **THEN** subscribers that refetch the list in response to the broadcast observe the newly created document in their query result
