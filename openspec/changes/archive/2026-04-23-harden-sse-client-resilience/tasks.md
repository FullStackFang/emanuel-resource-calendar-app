## 1. Infinite reconnect with capped backoff

- [x] 1.1 Remove the 10-attempt reconnect ceiling in `src/hooks/useServerEvents.js`. Identify the code path that currently sets `disabledRef.current = true` after N failed attempts and delete that branch.
- [x] 1.2 Preserve the existing exponential backoff schedule but cap the delay at 30000 ms (30 seconds). Update or replace the `Math.min(...)` clamp that produces the next delay.
- [x] 1.3 Ensure the reconnect attempt counter resets to zero on every successful `connected` event. Verify the reset happens inside the `connected` event handler, not only on first connect.
- [x] 1.4 Unit test: simulate N failed connects followed by a success; verify the next-delay computation returns to 1000 ms and not 32000 ms.
- [x] 1.5 Unit test: simulate 100 consecutive failures; verify backoff caps at 30000 ms and no `disabled` state is ever set.

## 2. Expose SSE connection state from context

- [x] 2.1 Extend `useServerEvents` internal state to derive a three-value `sseStatus` (`'live' | 'reconnecting' | 'offline'`) from the existing `isConnected` boolean and reconnect-in-progress signal.
- [x] 2.2 Expose `sseStatus` from `src/context/SSEContext.jsx` alongside the existing `isConnected` value. Do not remove `isConnected` (consumers still use it).
- [x] 2.3 Unit test: verify `sseStatus` transitions are `offline → reconnecting → live` on happy-path connect and `live → reconnecting → live` on a transient drop.

## 3. FreshnessIndicator renders SSE status

- [x] 3.1 Read `sseStatus` from `useSSE()` inside `src/components/shared/FreshnessIndicator.jsx`.
- [x] 3.2 Render a visually distinct badge for each of the three states (live / reconnecting / offline). Use color and either an icon glyph or text label so the state is readable without hover.
- [x] 3.3 Preserve the existing last-fetched clock; the SSE status badge renders alongside it, not as a replacement.
- [x] 3.4 Unit test: snapshot or role-based test verifying each of the three states renders a distinct badge.
- [ ] 3.5 Manual verification: load the app, disable network in DevTools, confirm badge transitions to reconnecting then offline; re-enable and confirm transition back to live.

## 4. Dynamic poll interval at call sites

- [x] 4.1 In `src/components/ReservationRequests.jsx`, update the `usePolling` invocation (around line 305) to pass `intervalMs = isConnected ? 300_000 : 30_000`.
- [x] 4.2 In `src/components/Calendar.jsx`, update the `usePolling` invocation (around line 2073) to pass `intervalMs = isConnected ? 300_000 : 30_000`.
- [x] 4.3 In `src/components/MyReservations.jsx`, update the `usePolling` invocation (around line 158) with the same pattern.
- [x] 4.4 In `src/components/EventManagement.jsx`, update its `usePolling` invocation with the same pattern.
- [ ] 4.5 Manual verification: with DevTools open, observe the polling endpoint requests. While SSE is connected, requests fire every 5 min; while SSE is offline, requests fire every ~30 s.

## 5. serverStartId client-side detection

- [x] 5.1 In `src/hooks/useServerEvents.js`, extract `serverStartId` (if present) from the `connected` event payload JSON. Persist it in a ref scoped to the hook's lifetime.
- [x] 5.2 On each `connected` event: if `serverStartId` is present, compare to last-seen. If it is the first value (no prior), record it as baseline and do not dispatch refresh. If it differs from last-seen, dispatch `data-refresh` for every view this tab is subscribed to via `useDataRefreshBus`, then update the baseline.
- [x] 5.3 If `serverStartId` is absent from the `connected` event payload, do nothing (Phase 2 hasn't shipped yet). Log a single debug-level message noting the absence; do not log per-event.
- [x] 5.4 Verify that the list of views to force-refresh is derived from currently-subscribed `useDataRefreshBus` listeners, not a hard-coded list.
- [x] 5.5 Unit test: first `connected` with `serverStartId: 'A'` → no dispatch. Second `connected` with `'A'` → no dispatch. Third `connected` with `'B'` → dispatch for all subscribed views. Fourth `connected` with no `serverStartId` field → no dispatch, baseline unchanged.

## 6. Calendar date-range append guard

- [x] 6.1 In `src/components/Calendar.jsx` `handleCalendarBusEvent` (around lines 2107–2113), before appending a `created` or `published` event to `allEvents`, check whether its `startDateTime` falls within the current `dateRange`.
- [x] 6.2 If the event's `startDateTime` is outside the range, return early (do not append). Add a one-line comment explaining why (per CLAUDE.md: a WHY-comment for a non-obvious behavior).
- [x] 6.3 Unit test: simulate a `created` broadcast for an event inside the current month when viewing this month → appended. Same event but dated 3 months ahead → not appended.

## 7. Regression verification

- [x] 7.1 Run the existing frontend Vitest suite (`npm run test:run`). Fix any failures caused by the `SSEContext` extension or `useServerEvents` changes. (561 passed, 6 pre-existing failures in `RecurrenceTabContent`, `RoomReservationFormBase`, `eventTransformers` — unrelated to this change, introduced by commit f84c861 adding `getEventRecurrence` without updating mocks.)
- [ ] 7.2 Manual two-user smoke test on a local dev environment: log in as a Requester in one browser and an Approver in another; Requester submits a request; confirm the Approver's Approval Queue updates within ~1 s. Kill and restart the backend; confirm both clients reconnect and refresh without a manual page reload.
- [x] 7.3 Verify no unintended behavior changes in views that do not use SSE (e.g., admin pages that don't subscribe to `useDataRefreshBus`). (No change outside subscribing views; polling hook unchanged; call sites additively pass dynamic interval.)

## 8. Simplify pass

- [x] 8.1 Run the `simplify` skill with scope limited to the files modified in this change: `src/hooks/useServerEvents.js`, `src/context/SSEContext.jsx`, `src/components/shared/FreshnessIndicator.jsx`, `src/components/Calendar.jsx`, `src/components/ReservationRequests.jsx`, `src/components/MyReservations.jsx`, `src/components/EventManagement.jsx`.
- [x] 8.2 Apply any simplifications or fixes the skill identifies. Re-run the frontend test suite after each edit to ensure no regressions.
- [x] 8.3 Do not expand scope beyond the listed files during the simplify pass (out-of-phase cleanup goes into its own change).

### Simplify findings and resolutions

**Applied (3):**
- Removed dead `disabledRef` — never set to `true` after the 10-attempt cap was removed. The `connect()` guard and visibility-effect check that read it were also vestigial (`useServerEvents.js`).
- Added `cssModifier` to `STATUS_META` in `FreshnessIndicator`; className now derives from the resolved entry, keeping it in sync with the label when `sseStatus` is an unexpected value. Test assertion added to cover the fallback className.
- Memoized `SSEContext` value with `useMemo` so consumers reading only `isConnected` don't re-render on every `sseStatus` transition.

**Skipped with reason (4):**
- Moving `computeReconnectBackoff` to `src/utils/reconnectUtils.js` — YAGNI. Single consumer today, agent's rationale was "if a second frontend component ever needs reconnect math". Keep inline until a second consumer actually exists.
- Shared mock SSE context helper in `src/__tests__/__helpers__/` — YAGNI. Single consumer (the new `FreshnessIndicator.test.jsx`).
- `navigator.onLine` guard in `scheduleReconnect` — YAGNI. Timer queue stays at depth 1 (single `setTimeout` ref overwritten each cycle), no memory leak. 720 failed requests per 6h per offline tab is acceptable for an internal-use app.
- Log throttle on reconnect attempts — moot. `logger.log` is gated on `DEBUG_ENABLED` (dev mode / `VITE_DEBUG=true`), so in production this log is a complete no-op.
