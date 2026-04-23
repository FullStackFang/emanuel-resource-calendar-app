## Context

Phase 1 of this effort (sibling change `harden-sse-client-resilience`) shipped client-side SSE resilience primitives, including detection of a `serverStartId` field on the `connected` SSE event payload. Until that field is emitted by the backend, the detection is a no-op. This Phase 2 change adds the server-side emission so the client's server-restart recovery path becomes effective.

The second half of Phase 2 addresses a narrower but real race: `broadcastEventChange` in `backend/api-server.js` currently fires the SSE emit synchronously after the database write's `await` resolves. At Cosmos DB single-region consistency, there is a narrow window (typically sub-100 ms but not zero) in which a read query can return before the just-written document is visible. If a subscriber's refetch lands in that window, the list returns without the new document and the user briefly sees stale state. A small pre-broadcast delay closes the race without requiring a read-back-after-write on every mutation site (which would add real round-trip latency to every write endpoint).

The single-instance deployment assumption is important: with one backend process, `serverStartId` is straightforward to generate and stable across all concurrent subscribers, and the broadcast delay does not need to coordinate across nodes.

## Goals / Non-Goals

**Goals:**

- Every `connected` SSE event delivered by the backend carries a `serverStartId` that changes between process restarts.
- Subscribers refetching in response to a broadcast observe the just-written document in their query result, without requiring a read-back-after-write or a retry loop on the client.
- No additional latency is added to the writer's HTTP response time.
- No new event types, no payload shape changes to existing events, no breaking client compatibility.

**Non-Goals:**

- Persistent or durable event log. The current in-memory ring buffer in `sseService` is preserved as-is.
- Multi-instance coordination. `serverStartId` is per-process; if the app is ever scaled horizontally, each instance will have its own value and the guarantee becomes weaker. Out of scope for this change; a separate change would address multi-instance.
- Replacing the existing `lastEventId` replay protocol. `serverStartId` mismatch is a signal that replay may be incomplete (the in-memory buffer was wiped on restart), not a replacement for replay during normal operation.
- Changing the broadcast payload shape. `event-changed` events are untouched.
- Counts endpoint RU tuning. Deferred indefinitely at this scale.

## Decisions

### Decision 1: `serverStartId` is generated once at module load

**Choice:** Generate the `serverStartId` as a module-level constant inside `sseService.js` at the time the module is first required. Use a short opaque string — a timestamp concatenated with a short random suffix is adequate (e.g., `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`), or a UUIDv4 if simpler.

**Alternatives considered:**

- *Per-connection ID.* Defeats the purpose: each reconnect would see a "different" ID and force a refetch on every reconnect. Must be stable across subscribers and across a single process's lifetime.
- *Derive from process start time alone.* Two simultaneous restarts after a crash could collide in theory (though astronomically unlikely). A random suffix makes collision impossible in practice.
- *Persist to disk or Cosmos so the value survives restart.* Defeats the purpose in the opposite direction: we want the value to change on restart so clients know to force-refresh.

**Rationale:** Stable per-process, changes on restart, cheap to generate, zero persistence overhead.

### Decision 2: Broadcast delay is 150 ms, centralized in `broadcastEventChange`

**Choice:** Add a module-level constant (e.g., `BROADCAST_DELAY_MS = 150`) in `api-server.js` in the vicinity of `broadcastEventChange`. The function wraps its SSE emit in `setTimeout(() => emit(), BROADCAST_DELAY_MS)`. The `await`-able promise returned to callers resolves immediately after scheduling the timeout, not after it fires; this keeps the writer's HTTP response path fast.

**Alternatives considered:**

- *Read-back-after-write at every mutation site.* Architecture review (captured in Phase 1 design) rejected this: it adds 10–30 ms of Cosmos round-trip to every write, across 25+ call sites, for a correctness improvement that's genuinely tiny at this scale. The 150 ms delay achieves the same correctness guarantee at single-region without the per-write cost.
- *Configure the delay per-call-site* (e.g., longer for large aggregate writes). Over-engineered; at the scale and payload shapes this app uses, 150 ms is adequate everywhere.
- *Make it an environment variable.* Premature. A module-level constant is easy to tune in code and redeploy; if we ever need environment control, that's a small follow-up.

**Rationale:** Single point of control, minimal code surface, correct behavior at the required scale. 150 ms is the documented rule-of-thumb for Cosmos single-region write-to-read visibility and is well under the human perceptual threshold for a "real-time" update (~200 ms is generally imperceptible for UI freshness).

### Decision 3: Delay does not block the writer's HTTP response

**Choice:** The 150 ms delay applies only to the SSE emit. The writer's HTTP response path does not await it. This is achieved by not returning the broadcast timeout's promise to the mutation handler, or by structuring the broadcast call as fire-and-forget (as it already is — broadcasts are non-blocking today, logged-but-not-thrown on failure).

**Alternatives considered:**

- *Have the mutation handler await the broadcast before responding.* Adds 150 ms to every write endpoint P50. Unnecessary; the writer doesn't care when other subscribers see the event, only that their own mutation succeeded.

**Rationale:** Preserves existing latency characteristics of mutation endpoints. The writer's UX is unchanged.

### Decision 4: Piggyback serverStartId on existing `connected` event (no new event type)

**Choice:** Add `serverStartId` as a new field in the JSON payload of the existing `connected` event. Do not introduce a separate `server-reset` event type.

**Alternatives considered:**

- *Emit a separate `server-reset` event* on reconnect when the server detects a fresh process. Requires (a) client-side listener registration for a new event type, (b) a client migration window during which old clients silently ignore the signal. Piggyback avoids both.

**Rationale:** Strictly additive. Old clients that read only `{ userId, timestamp }` continue to work; new clients (Phase 1) read the additional field and act on it. No new listener wiring on either side.

## Risks / Trade-offs

- **The 150 ms delay is a heuristic, not a guarantee.** Cosmos single-region consistency is typically well under 150 ms but is not formally bounded. Under unusual load or partition events it could in principle exceed this. → Mitigation: the delay value is a module-level constant; if telemetry shows stale reads slipping past 150 ms, bumping the constant to 250 ms is a one-line change. The client's `serverStartId` mismatch path (Phase 1) provides a backstop for any residual divergence.

- **`serverStartId` is per-process and meaningless across multiple instances.** If the app is ever scaled to multiple backend processes, each process will have its own `serverStartId`, and a client's reconnect landing on a different instance will always look like a "restart" and always force a refetch. → Mitigation: document the single-instance assumption. If horizontal scale becomes a requirement, Phase 3 can migrate to a broker-backed shared `serverStartId` (stored in the broker at first-instance-start, read by all instances).

- **Load of simultaneous reconnects after restart.** When the backend restarts, all connected clients reconnect within a short window and all receive a new `serverStartId`, and all therefore force-refresh every subscribed view. At 3–8 approvers × 2–3 views per tab = 6–24 simultaneous list fetches in the first few seconds after restart. → Mitigation: acceptable at this scale. The `useDataRefreshBus` 500 ms debounce and per-view endpoint's existing caching handle the burst gracefully. If this ever becomes a pain point, add a per-client random jitter (0–500 ms) to the force-refresh dispatch.

- **Ring buffer size may not cover all missed events during a short restart.** A restart wipes the in-memory event ring buffer, so `lastEventId` replay returns nothing. The `serverStartId` mismatch force-refresh is the recovery path for this, which is correct, but it means every restart costs a full view refetch per tab. → Mitigation: expected. This is the designed behavior.

- **Clock skew on `Date.now()` for `serverStartId`.** If two restarts happen within the same millisecond (effectively impossible), the timestamp component could collide. → Mitigation: the random suffix (4 bytes = 2^32 space) makes this impossible in practice. No real risk.

## Migration Plan

- Deploy order: backend only. Frontend (Phase 1) is already shipped and tolerant of both absent and present `serverStartId`.
- Rollback: revert the backend deploy. Phase 1 client will simply observe that `serverStartId` is no longer present and resume no-op behavior.
- No data migration, no schema change, no new configuration required.
- Feature flag: not needed. The behavior is additive and the client handles both presence and absence.

## Open Questions

- Should the broadcast delay be configurable via environment variable, or is a module-level constant sufficient? (Recommendation: constant for now; revisit if production telemetry ever shows a need to tune without a redeploy.)
- Should Phase 2 include an audit of the ring-buffer size in `sseService`? A larger buffer reduces the frequency of `serverStartId`-driven force-refetches during normal operation by covering longer blips via replay. (Recommendation: include as a quick task — if the current size is already generous, no change; if tiny, bump it modestly. Size audit is in the task list.)
