## Context

The Emanuel Calendar app already has a complete SSE broadcast pipeline. On the backend, `broadcastEventChange()` in `api-server.js` is called from ~25 mutation sites (create, publish, reject, edit, cancel, delete, resubmit) and fans out an enriched `event-changed` payload via `sseService.js` to all connected clients. On the frontend, `useServerEvents` manages the `EventSource` lifecycle, `SSEContext` exposes the connection, and `useDataRefreshBus` debounces view-level refresh dispatches. A view-aware `usePolling` hook provides a 5-minute fallback that fires on tab refocus with jitter.

In production, Approvers sometimes fail to see new or edited Requester reservations without a manual refresh. A prior architecture investigation ruled out the most common causes: this is a single Azure B1 Linux App Service instance (no ticket-split or broadcast-split), and the SSE endpoint already sets the correct headers (`X-Accel-Buffering: no`, `Content-Encoding: identity`, `Connection: keep-alive`, `req.setTimeout(0)`). The remaining gaps are in the client's reconnect discipline and the user's ability to tell when SSE is live vs. fallen back to polling.

Phase 1 is scoped to client-side hardening only. Phase 2 (sibling change `harden-sse-server-reliability`) adds a `serverStartId` to the `connected` event payload and a 150 ms pre-broadcast delay to cover the Cosmos single-region write-to-read consistency window.

## Goals / Non-Goals

**Goals:**

- An Approver whose SSE connection drops transiently (network blip, server restart, backgrounded tab) recovers automatically without needing a manual refresh.
- An Approver can see at a glance whether the freshness indicator reflects live pushed updates or polling fallback.
- While SSE is down, the polling cadence is tight enough that staleness is bounded in tens of seconds, not minutes.
- Any broadcast-induced view mutation that could produce a visually jarring or misleading state (an event popping into the Calendar for a date not currently in view) is rejected at the client.
- All five Phase 1 items ship in a single deploy. Nothing in Phase 1 requires the Phase 2 backend change to be live; the `serverStartId` detection is a no-op until Phase 2 lands.

**Non-Goals:**

- Multi-instance or multi-region deployments. No Redis, Service Bus, or external pub/sub. The design explicitly assumes single-instance.
- Restructuring `usePolling` hook internals. The interval-swap is done at call sites to avoid expanding the hook's dependency array.
- Counts endpoint RU tuning. The `/api/events/list/counts` six-`countDocuments` pattern is unchanged in this phase.
- Client-side apply-patch-from-payload. The existing broadcast-then-silent-refetch behavior is preserved; changing to in-place patch merging is a larger architectural change out of scope here.
- MSAL token refresh behavior. The ticket POST at reconnect time relies on MSAL's existing silent refresh; Phase 1 does not change that path.
- Backend code. No touches to `api-server.js` or `backend/services/sseService.js`.

## Decisions

### Decision 1: Ship Phase 1 as client-only, observe before Phase 2

**Choice:** Deploy the five client-side items as a single change, watch production behavior, then ship Phase 2 as a separate backend deploy.

**Alternatives considered:**

- *Ship everything in one deploy.* Reviewer-rejected. Loses attribution signal (can't tell which half fixed the symptom), removes rollback granularity (one regression pulls both halves), enlarges the change-review surface unnecessarily.
- *Ship Phase 2 first, then Phase 1.* Backward. Phase 2 is only useful if Phase 1's client can detect and act on it; shipping server-first means the feature is invisible.

**Rationale:** Phase 1 alone may resolve the observed symptom (the 10-attempt reconnect ceiling is a strong candidate for the current prod gap). If it does, Phase 2 can be sized more carefully against residual signal. Independent deploys give independent rollback. Phase 1 has zero dependency on Phase 2 thanks to the "absent `serverStartId` is tolerated" scenario.

### Decision 2: `serverStartId` detection is client-first, server-absent-safe

**Choice:** Client reads `serverStartId` from the `connected` event payload. If present and differs from last-seen, force-refresh every subscribed view. If absent, no-op — rely on normal replay and subsequent `event-changed` broadcasts.

**Alternatives considered:**

- *Wait for Phase 2 to ship before adding client detection.* Rejected. Couples the phases, removes the ability to ship Phase 1 standalone. Phase 2's backend change becomes a flag day.
- *Use a separate `server-reset` SSE event type instead of piggybacking on `connected`.* Rejected during architecture review. `connected` already fires on every reconnect and its current payload is discarded by the client. Adding a new event type would require old clients to be explicitly updated to listen for it, creating a migration window. Piggybacking is strictly additive: old clients continue to work; new clients gain a capability when the server adds the field.

**Rationale:** Makes the two phases independently shippable. Encodes forward-compatibility by design rather than by convention.

### Decision 3: Dynamic poll interval at call sites, not inside `usePolling`

**Choice:** Each of the four `usePolling` call sites (Calendar, ReservationRequests, MyReservations, EventManagement) passes `intervalMs = isConnected ? 300_000 : 30_000` where `isConnected` comes from `SSEContext`. `usePolling`'s existing `useEffect` already re-runs when `intervalMs` changes.

**Alternatives considered:**

- *Accept a function for interval (`() => number`) instead of a constant.* Would require restructuring `usePolling`'s dependency array and introducing a ref to break the function-identity-churn loop. More code surface, harder to audit.
- *Add a `fallbackIntervalMs` prop to `usePolling` that takes over when SSE is offline.* Leaks SSE coupling into the polling hook, which currently has no knowledge of SSE. Violates the hook's single responsibility.
- *Read `isConnected` from `SSEContext` inside `usePolling`.* Creates a transitive dependency of a generic hook on a specific context. Breaks reusability.

**Rationale:** Minimal mechanical change. Each call site is already importing `useSSE()` for other purposes (or can trivially do so). The call-site approach is the most locally reasoned and the easiest to grep for in reviews.

### Decision 4: No standalone tab-resume force-refetch

**Choice:** Do not add a resume-time force-refetch as a separate feature. The `serverStartId` mismatch detection in Decision 2 already covers the important case (server restart while tab was backgrounded). Normal reconnect-without-restart is handled by `lastEventId` replay in `sseService`.

**Alternatives considered:**

- *Add a bounded "one force-refetch per visibility resume" hook.* Reviewer-identified collision: `usePolling` already fires a refetch on `visibilitychange → visible` with 0–300 ms jitter, and that fetch bypasses the `useDataRefreshBus` 500 ms debounce because `usePolling` calls the component's fetch callback directly, not through `dispatchRefresh`. Adding a second force-refetch from `useServerEvents` would produce two concurrent fetches per tab per resume with no deduplication.
- *Route `usePolling`'s visibility refocus through the debounced `dispatchRefresh` bus.* Would be a broader refactor of `usePolling` and would change its behavior for paths that don't use SSE at all. Rejected as out-of-scope for Phase 1.

**Rationale:** The collision analysis shows that adding resume-refetch would cost complexity without adding correctness beyond what `serverStartId` detection already provides. The remaining case it would cover — "tab was backgrounded for a long time and the server did NOT restart but the user wants a fresh view on resume" — is already handled by `usePolling`'s existing refocus fire.

### Decision 5: Calendar date-range guard bundled into Phase 1

**Choice:** Fix `handleCalendarBusEvent` in `Calendar.jsx` to check an incoming event's `startDateTime` against the current `dateRange` before appending to `allEvents`. Include in Phase 1 rather than as a separate change.

**Alternatives considered:**

- *Ship the Calendar fix as its own micro-change.* Rejected. It's ~10 lines, it touches the same file-area as the dynamic-poll call-site change (Calendar.jsx), and separating it creates a tiny orphan change with its own review/deploy overhead.
- *Defer the Calendar fix entirely.* Rejected. The resilience work will mask it (force-refetch on reconnect would scrub the ghost entry), but only until the user performs a non-reconnect action that depends on the list. Fixing it at the source is cheaper than relying on downstream masking.

**Rationale:** Right scope, right time, right file.

### Decision 6: Infinite reconnect uses 30-second backoff cap

**Choice:** Exponential backoff schedule: 1s, 2s, 4s, 8s, 16s, 30s, 30s, 30s, ...

**Alternatives considered:**

- *60-second cap.* Approver would wait up to 60 s to recover from a lingering outage. Longer than the 30 s polling fallback interval, so polling would beat reconnect to fresh data. Defeats the purpose.
- *10-second cap.* Aggressive on the backend. If the server is genuinely down for an extended period, a cluster of N clients hammering it every 10 s accelerates their own recovery negligibly while adding load to the restart path. At 3–8 concurrent approvers this is tolerable but the cap should align with the polling cadence for operational clarity.

**Rationale:** 30 s cap matches the fallback polling interval, giving the system one consistent "heartbeat" cadence for freshness during degraded periods.

## Risks / Trade-offs

- **Infinite reconnect causes network-error log noise on permanently offline devices.** A laptop that loses connectivity for 6 hours will have quietly POST'd `/api/sse/ticket` every 30 s for the duration (= 720 requests per tab). These fail at the network layer and cost the server nothing, but may be visible in browser console / developer tools as a stream of errors. → Mitigation: accept the tradeoff; it's the price of not giving up. If the log noise becomes a real concern, a follow-up could silence reconnect errors after N consecutive failures while continuing to retry.

- **Offline 30 s polling on many tabs could spike counts endpoint load during an SSE outage.** At 8 approvers × 30 s polling × two endpoints (list + counts) = 32 requests/minute against the two endpoints. The counts endpoint alone does 6× `countDocuments`. → Mitigation: at this scale the total is within the Cosmos budget even during an outage. If telemetry later shows this is a pain point, the Phase 3 counts tuning deferred from the earlier plan can be revisited.

- **`serverStartId` force-refetch could surprise a user who just made their own mutation.** In the narrow window where the user clicks "Approve" and then the server restarts before their tab has received the resulting `event-changed` broadcast, their view would be force-refreshed from scratch. → Mitigation: acceptable; the force-refreshed view is still correct (it reflects their mutation because they've already committed it). The user may see a brief list re-render. No data loss.

- **Dynamic poll interval change is visible only after the next scheduling cycle.** If SSE drops at t=0 and the 5-min poll is scheduled for t=2 min, the 30 s interval does not kick in until that scheduled poll fires and reschedules with the new interval. → Mitigation: acceptable. Worst case, staleness during the transition is bounded by the original 5-min cycle. An improvement could be to eagerly cancel-and-reschedule on `isConnected` change, but that adds coupling for marginal benefit.

- **Force-refetch on `serverStartId` mismatch applies to every subscribed view in the tab.** A tab with three views open (e.g., Calendar + Approval Queue + FreshnessIndicator hitting `/counts`) would fire three endpoint calls. → Mitigation: expected and appropriate. Each call goes through its own permission-enforcing endpoint and is scoped via `useDataRefreshBus`'s 500 ms debounce. At 3–8 approvers this is not a load concern.

## Migration Plan

- No migration. This is an additive client-side deploy.
- Ship order: frontend build → production deploy.
- Rollback: revert the frontend deploy. Backend is untouched.
- No data migration, no schema change, no config change.

## Open Questions

- Should the `FreshnessIndicator` surface the `reconnecting` state differently from `offline` in the first cut, or should both render the same visual in Phase 1 and split in a follow-up? (Recommendation: split from the start; the code cost is trivial and it gives users a more informative signal.)
- Should the replay buffer size in `sseService` be audited as part of Phase 2? Larger buffers reduce the frequency of `serverStartId`-mismatch force-refetches by covering more event history during a blip. Out of scope for Phase 1; flagged for Phase 2 consideration.
