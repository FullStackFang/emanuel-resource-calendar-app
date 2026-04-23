## Why

Phase 1 of this effort (`harden-sse-client-resilience`) added client-side SSE resilience: infinite reconnect, freshness indicator, dynamic polling, and `serverStartId` detection. The `serverStartId` detection is a no-op until the backend emits that field. This Phase 2 change adds the backend half: it generates a `serverStartId` once at process start and includes it in every `connected` SSE event payload, which allows Phase 1 clients to detect server restarts and force-refresh every subscribed view. Phase 2 also closes the write-to-read race in `broadcastEventChange` by adding a small pre-broadcast delay so that a subscriber's silent refetch does not land inside the Cosmos single-region consistency window and return a list that is missing the just-written document.

Phase 2 is backend-only. No frontend changes are required; the Phase 1 client is ready to consume the new behavior on its first reconnect after Phase 2 deploys.

## What Changes

- `backend/services/sseService.js`: generate a `serverStartId` (a short opaque string — timestamp, UUID, or short hash) once at module load. Include it in the `connected` SSE event payload delivered to every new subscriber.
- `backend/api-server.js`: the `connected` event emission inside the `/api/sse/events` handler includes the `serverStartId` field alongside the existing `userId` and `timestamp` fields.
- `backend/api-server.js` `broadcastEventChange()` function: interpose a short delay (150 ms) between the database write confirmation and the SSE emit. The delay is applied centrally inside the broadcast function so all 25+ call sites inherit it without per-site changes. The delay is tunable via a module-level constant.
- No changes to broadcast payload shape. No new event types. No migration. Old clients that do not know about `serverStartId` continue to work; they simply ignore the new field.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `realtime-freshness`: adds two server-side requirements that complete the Phase 1 contract. Phase 1 introduced the capability with five client-side requirements; Phase 2 adds two server-side requirements that make the `serverStartId` detection path effective and eliminate the write-to-read race.

## Impact

- **Backend code**: `backend/services/sseService.js`, `backend/api-server.js`.
- **No frontend changes**. Phase 1 clients are already tolerant of absent `serverStartId` and will begin acting on the field automatically once this backend deploys.
- **No API contract breakage**. The `connected` SSE event adds an optional field; older clients ignore unknown fields.
- **Write endpoint latency**: broadcast delay adds ~150 ms between write completion and SSE emit. This delay is asynchronous — it does not hold the HTTP response to the writer. The writer's response returns immediately; the delay only affects when subscribers see the event.
- **RU impact**: neutral. No additional reads or writes per broadcast.
- **Testing**: Jest integration tests for `serverStartId` presence in the `connected` event, for delay timing in `broadcastEventChange`, and for end-to-end behavior where a simulated restart causes Phase 1 clients to force-refresh.
- **Out of scope**: Multi-instance or multi-region deployments, persistent event log (current ring buffer is preserved), change-stream fallbacks, counts endpoint tuning.
