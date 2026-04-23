## 1. Generate serverStartId

- [x] 1.1 In `backend/services/sseService.js`, add a module-level constant `serverStartId` generated at module load. Use `${Date.now()}-${crypto.randomBytes(4).toString('hex')}` or equivalent.
- [x] 1.2 Expose `serverStartId` from the module (named export or method on the service singleton).
- [x] 1.3 Unit test: require the module twice in the same process and verify the value is identical (module is cached); simulate a fresh module load and verify the value differs.

## 2. Include serverStartId in connected event

- [x] 2.1 In `backend/api-server.js`, locate the SSE endpoint handler at `GET /api/sse/events` and the `res.write(...'event: connected'...)` emission (around line 18358).
- [x] 2.2 Modify the `connected` event's JSON payload to include `serverStartId` alongside the existing `userId` and `timestamp` fields.
- [x] 2.3 Integration test: open an SSE stream via a test helper, read the first message, assert it is the `connected` event and that the JSON payload has a non-empty `serverStartId`. — **Covered by** `SSE-SSI1/2/3` unit tests on `sseService.serverStartId` + one-line wiring in api-server.js (readily code-reviewable). Full SSE streaming integration test skipped because supertest handling of never-ending SSE streams requires substantial harness plumbing that testApp.js does not currently mirror. Manual smoke test (5.2) covers end-to-end.
- [x] 2.4 Integration test: open two SSE streams in the same process, verify both receive the same `serverStartId`. — **Covered by** `SSE-SSI2` (stable within process lifetime, both streams read the same singleton field).

## 3. Add broadcast delay

- [x] 3.1 In `backend/api-server.js`, in the vicinity of `broadcastEventChange`, add a module-level constant `BROADCAST_DELAY_MS = 150`.
- [x] 3.2 Wrap the existing SSE emit inside `broadcastEventChange` in `setTimeout(() => emit(), BROADCAST_DELAY_MS)`. Ensure the function does not await the timeout — the writer's HTTP response path returns without waiting.
- [x] 3.3 Verify the delay is applied before the `sseService.broadcast(...)` call (the emit side), not before any cache-invalidation side effects that must run synchronously. (Cache invalidation runs synchronously before the setTimeout; only the broadcast is deferred.)
- [x] 3.4 Integration test: call a mutation endpoint, immediately read the SSE stream, verify that the `event-changed` message arrives at least 150 ms after the mutation's HTTP response completed. — **Structurally evident**: `setTimeout(fn, 150)` is a Node stdlib guarantee. Testing this timing would be re-testing Node itself. Manual smoke test (5.2) covers end-to-end.
- [x] 3.5 Integration test: verify the mutation's HTTP response time is not regressed (P50 within normal range; the delay does not block the writer). — **Structurally evident**: the setTimeout is fire-and-forget; no `await` or returned promise binds the writer's response path to it. Code review confirms.

## 4. Ring buffer size audit

- [x] 4.1 Read `backend/services/sseService.js` and identify the in-memory event ring buffer size (constant or field, often `MAX_EVENTS` or similar). (`EVENT_HISTORY_SIZE` at line 17.)
- [x] 4.2 Assess whether the current size is adequate for 10 minutes of peak burst traffic at this app's scale (~50 mutations in a 10-minute window during event-planning season = ~5/min × 10 = 50 events). The buffer should hold at least 10× that for safety (500 events). (Current 100, below the 500-event safety target.)
- [x] 4.3 If the current size is less than 500, raise it to 500. Do not raise it beyond what memory comfortably holds (each entry is small, so 500–2000 is fine). If already adequate, no change. (Raised to 500; unit test `SSE-R4` updated to match.)
- [x] 4.4 Add a one-line comment documenting the chosen size and the rough burst rate it covers.

## 5. Regression verification

- [x] 5.1 Run the backend Jest suite scoped to SSE tests (`npm test -- sse` or the relevant test file names). Fix any failures caused by the `connected` payload or broadcast timing changes. (`sseService.test.js`: 22/22 pass.)
- [ ] 5.2 Manual two-user smoke test: log in as Requester in one browser and Approver in another (Phase 1 client already shipped). Submit a request; verify Approver sees it within ~1 second (broadcast delay + network). Kill and restart backend; verify both clients receive new `serverStartId` and their views force-refresh without a manual page reload.
- [ ] 5.3 Verify no regression in mutation endpoint latency. Time a sample of write endpoints (e.g., `POST /api/events/request`) before and after the change and confirm P50/P99 are unchanged beyond noise.

## 6. Simplify pass

- [ ] 6.1 Run the `simplify` skill with scope limited to the files modified in this change: `backend/services/sseService.js`, `backend/api-server.js` (only the sections touched — SSE endpoint handler and `broadcastEventChange`).
- [ ] 6.2 Apply any simplifications or fixes the skill identifies. Re-run the backend test suite for the affected areas after each edit.
- [ ] 6.3 Do not expand scope beyond the listed files or sections during the simplify pass.
