## Why

In production, Approvers sometimes fail to see new or edited Requester reservations in the Calendar view and Approval Queue without a manual page refresh. The SSE infrastructure that should push these updates exists, but the client has no visible indication when it has silently fallen back to 5-minute polling, and the reconnect logic gives up permanently after 10 failed attempts. A user who hits this fallback has no signal that they are seeing stale data until they manually refresh. This Phase 1 change hardens the client-side SSE resilience primitives so that (a) the connection recovers from any transient failure indefinitely, (b) users can see at a glance whether they are getting live pushes or polled updates, and (c) the polling fallback is short enough that even when SSE is down the staleness window is bounded to tens of seconds rather than minutes.

This is the first of two phases. A sibling change `harden-sse-server-reliability` will add server-side signals (`serverStartId` on the `connected` event, broadcast-delay for write-to-read consistency) that Phase 1 consumes when available but safely ignores when absent.

## What Changes

- Remove the 10-attempt reconnect ceiling in `useServerEvents`. Reconnect retries indefinitely with exponential backoff capped at 30 seconds. Attempt counter resets on successful connect.
- Expose `sseStatus` (`'live' | 'reconnecting' | 'offline'`) from `SSEContext`. `FreshnessIndicator` renders a status badge alongside the existing last-fetched clock so users can see connection health.
- Adapt polling interval at each `usePolling` call site: 5 minutes when SSE is live (sanity-check cadence), 30 seconds when SSE is offline (shortens the blind window). Applied at call sites rather than inside the hook to avoid reshaping `usePolling`'s dependency array.
- Add `serverStartId` client-side detection to `useServerEvents`. The field arrives on the `connected` event payload; Phase 1 is tolerant of its absence (Phase 2 introduces the server-side emission). On mismatch with last-seen `serverStartId`, the client dispatches a full refresh for every view subscribed in this tab via `useDataRefreshBus`.
- Companion fix: `Calendar.jsx` `handleCalendarBusEvent` guards against appending events whose `startDateTime` falls outside the current date-range window. Out-of-window events are ignored (the user will see them naturally when navigating to that date).

## Capabilities

### New Capabilities

- `realtime-freshness`: Specifies how the client SSE pipeline reconnects, how polling adapts to SSE health, how users perceive connection state via the freshness indicator, how the client recovers after a missed event stream (server-restart detection via `serverStartId`), and how broadcast-driven view updates respect view-scoped data boundaries. Phase 1 establishes the client-side obligations; Phase 2 (`harden-sse-server-reliability`) will extend this capability with server-side obligations (`serverStartId` emission, broadcast write-to-read delay).

### Modified Capabilities

None.

## Impact

- **Frontend code**: `src/hooks/useServerEvents.js`, `src/context/SSEContext.jsx`, `src/components/shared/FreshnessIndicator.jsx`, `src/components/Calendar.jsx`, `src/components/ReservationRequests.jsx`, `src/components/MyReservations.jsx`, `src/components/EventManagement.jsx`.
- **No backend changes**. `serverStartId` detection is a no-op until Phase 2 ships the emitter.
- **No API contract changes**. Client consumes a new optional field (`serverStartId`) on an existing SSE event; absent field is ignored.
- **No schema changes**. No MongoDB collections, indexes, or document shapes touched.
- **Polling RU impact**: Net-neutral under normal (SSE-live) conditions — polling interval unchanged at 5 min. During SSE outages, polling goes from 5 min to 30 s per client, a 10× per-client RU increase *only while disconnected*. At 3–8 concurrent approvers this is well within the Cosmos B-tier budget.
- **Testing**: Vitest unit tests for the reconnect backoff, `sseStatus` transitions, and date-range guard. Manual regression check: force-quit and restart backend with two browser sessions open, verify both clients reconnect and refresh without page reload.
- **Out of scope**: Multi-instance deployments, pub/sub brokers, change-stream fallbacks, refactoring `usePolling` internals, counts endpoint RU tuning. These are explicitly deferred.
