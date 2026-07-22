// Tests for findWithColdEmptyRetry — guards the primary calendar find against
// Cosmos cross-partition cold false-empty results (a cold partition can return
// [] from find() even when documents match; see project_cosmos_cold_query_empty).
//
// Design contract being locked:
// - A non-empty first find is returned immediately (no count, no retry).
// - An empty first find is reconciled against an authoritative count():
//     * count === 0  -> genuinely empty, return [] without retrying.
//     * count  >  0  -> cold false-empty, re-find up to maxRetries with backoff.
// - Retries are bounded (no infinite loop) even if find never recovers.

const { findWithColdEmptyRetry } = require('../../../utils/coldEmptyRetry');

// A sleep stub that records the delays it was asked to wait, and never actually
// waits — keeps the test synchronous-fast while asserting the backoff schedule.
function makeSleepSpy() {
  const calls = [];
  const sleep = (ms) => { calls.push(ms); return Promise.resolve(); };
  sleep.calls = calls;
  return sleep;
}

describe('findWithColdEmptyRetry', () => {
  test('returns data from the first find without calling count or retrying', async () => {
    let findCalls = 0;
    let countCalls = 0;
    const runFind = async () => { findCalls++; return [{ id: 'a' }]; };
    const runCount = async () => { countCalls++; return 99; };
    const sleep = makeSleepSpy();

    const result = await findWithColdEmptyRetry(runFind, runCount, { sleep });

    expect(result).toEqual([{ id: 'a' }]);
    expect(findCalls).toBe(1);
    expect(countCalls).toBe(0);     // never reconcile when the first find has data
    expect(sleep.calls).toEqual([]); // never sleep on the happy path
  });

  test('returns [] without retrying when find is empty AND count is 0 (genuinely empty)', async () => {
    let findCalls = 0;
    const runFind = async () => { findCalls++; return []; };
    const runCount = async () => 0;
    const sleep = makeSleepSpy();

    const result = await findWithColdEmptyRetry(runFind, runCount, { sleep });

    expect(result).toEqual([]);
    expect(findCalls).toBe(1);       // one find, no retries for a real empty
    expect(sleep.calls).toEqual([]);
  });

  test('retries the find when it is empty but count proves documents exist, then returns recovered data', async () => {
    const findResults = [[], [], [{ id: 'warm' }]]; // cold, cold, then warm
    let findCalls = 0;
    const runFind = async () => findResults[findCalls++];
    const runCount = async () => 5;
    const sleep = makeSleepSpy();
    const coldEvents = [];
    const onColdEmpty = (info) => coldEvents.push(info);

    const result = await findWithColdEmptyRetry(runFind, runCount, {
      maxRetries: 3, delayMs: 200, sleep, onColdEmpty,
    });

    expect(result).toEqual([{ id: 'warm' }]);
    expect(findCalls).toBe(3);                 // initial + 2 retries
    expect(sleep.calls).toEqual([200, 400]);   // linear backoff delayMs * attempt
    expect(coldEvents).toEqual([
      { attempt: 1, count: 5, maxRetries: 3, got: 0, expected: 1 },
      { attempt: 2, count: 5, maxRetries: 3, got: 0, expected: 1 },
    ]);
  });

  test('is bounded: stops after maxRetries and returns [] if find never recovers', async () => {
    let findCalls = 0;
    const runFind = async () => { findCalls++; return []; };
    const runCount = async () => 7; // count insists docs exist, but find never recovers
    const sleep = makeSleepSpy();

    const result = await findWithColdEmptyRetry(runFind, runCount, { maxRetries: 3, sleep });

    expect(result).toEqual([]);
    expect(findCalls).toBe(4);          // 1 initial + exactly 3 bounded retries — no infinite loop
    expect(sleep.calls.length).toBe(3);
  });

  describe('expectedFromCount (short-read reconciliation)', () => {
    const noSleep = async () => {};

    it('retries when the find returns fewer docs than expectedFromCount(count)', async () => {
      const finds = [
        [{ id: 1 }, { id: 2 }],                                  // partial (5 expected)
        [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }], // full
      ];
      let call = 0;
      const runFind = async () => finds[Math.min(call++, finds.length - 1)];
      const runCount = async () => 5;

      const results = await findWithColdEmptyRetry(runFind, runCount, {
        sleep: noSleep,
        expectedFromCount: (count) => Math.min(count, 2000),
      });
      expect(results).toHaveLength(5);
      expect(call).toBe(2);
    });

    it('returns the longest result seen when retries never reach expected', async () => {
      const finds = [[{ id: 1 }], [{ id: 1 }, { id: 2 }], [{ id: 1 }]];
      let call = 0;
      const runFind = async () => finds[Math.min(call++, finds.length - 1)];
      const runCount = async () => 5;

      const results = await findWithColdEmptyRetry(runFind, runCount, {
        sleep: noSleep,
        maxRetries: 2,
        expectedFromCount: (count) => count,
      });
      expect(results).toHaveLength(2); // best-so-far, not last-seen
    });

    it('does not retry when the find meets expectedFromCount(count)', async () => {
      let findCalls = 0;
      const runFind = async () => { findCalls++; return [{ id: 1 }, { id: 2 }]; };
      const runCount = async () => 2;

      const results = await findWithColdEmptyRetry(runFind, runCount, {
        sleep: noSleep,
        expectedFromCount: (count) => count,
      });
      expect(results).toHaveLength(2);
      expect(findCalls).toBe(1);
    });

    it('default behavior unchanged: non-empty first find returns without calling count', async () => {
      let countCalls = 0;
      const runFind = async () => [{ id: 1 }];
      const runCount = async () => { countCalls++; return 99; };

      const results = await findWithColdEmptyRetry(runFind, runCount, { sleep: noSleep });
      expect(results).toHaveLength(1);
      expect(countCalls).toBe(0);
    });
  });
});
