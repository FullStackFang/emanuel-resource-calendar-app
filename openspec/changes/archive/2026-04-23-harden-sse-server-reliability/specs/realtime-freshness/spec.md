## ADDED Requirements

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
