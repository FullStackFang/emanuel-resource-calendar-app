/**
 * syncHealthScheduler (SHS-1..8)
 *
 * The scheduler logic runs under fake timers against an in-memory store with
 * the lease semantics of createSettingsStore; SHS-8 checks the real adapter
 * against MongoDB (no fake timers — the driver needs real ones).
 */

const { start, summarizeReport, createSettingsStore } = require('../../../services/syncHealthScheduler');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');

const HOUR = 60 * 60 * 1000;
const quiet = { warn: () => {}, info: () => {} };

function memoryStore(initial = null) {
  let doc = initial ? { ...initial } : null;
  return {
    get doc() { return doc; },
    async tryAcquire({ now, nextRunAt, instanceId }) {
      if (doc && doc.nextRunAt && doc.nextRunAt > now) return false;
      doc = { ...(doc || {}), nextRunAt, leasedBy: instanceId };
      return true;
    },
    async recordSuccess(fields) { doc = { ...doc, ...fields, error: false }; },
    async recordFailure(fields) { doc = { ...doc, ...fields, error: true }; },
  };
}

const window = { startDate: '2026-04-01', endDate: '2026-12-31' };

describe('syncHealthScheduler (SHS-1..8)', () => {
  let scheduler;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-08T12:00:00Z'));
  });
  afterEach(() => {
    scheduler?.stop();
    scheduler = null;
    jest.useRealTimers();
  });

  const report = (shouldNot = 0) => ({
    calendars: [{
      missingFromOutlook: [],
      shouldNotBeInOutlook: Array.from({ length: shouldNot }, () => ({ reason: 'excluded date still present' })),
      untracked: [{}], untethered: [], degraded: false,
    }],
  });

  function begin(store, runCheck, intervalMs = 6 * HOUR) {
    scheduler = start({ runCheck, resolveWindow: () => window, store, intervalMs, instanceId: 'i-1', logger: quiet });
    return scheduler;
  }

  it('SHS-1: the boot tick acquires the lease and runs over the default window, all calendars', async () => {
    const store = memoryStore();
    const runCheck = jest.fn().mockResolvedValue(report(2));
    begin(store, runCheck);

    await jest.advanceTimersByTimeAsync(60 * 1000);

    expect(runCheck).toHaveBeenCalledTimes(1);
    expect(runCheck).toHaveBeenCalledWith({ ...window, calendarOwner: null });
    expect(store.doc.nextRunAt.getTime()).toBe(new Date('2026-10-08T12:01:00Z').getTime() + 6 * HOUR);
    expect(store.doc.counts.shouldNotBeInOutlook).toBe(2);
    expect(store.doc.error).toBe(false);
  });

  it('SHS-2: a lease held elsewhere skips the run', async () => {
    const store = memoryStore({ nextRunAt: new Date('2026-10-08T15:00:00Z') });
    const runCheck = jest.fn().mockResolvedValue(report());
    begin(store, runCheck);

    await jest.advanceTimersByTimeAsync(60 * 1000);

    expect(runCheck).not.toHaveBeenCalled();
  });

  it('SHS-3: interval 0 disables the scheduler entirely', async () => {
    const runCheck = jest.fn();
    expect(start({ runCheck, resolveWindow: () => window, store: memoryStore(), intervalMs: 0, instanceId: 'i', logger: quiet })).toBeNull();
    await jest.advanceTimersByTimeAsync(24 * HOUR);
    expect(runCheck).not.toHaveBeenCalled();
  });

  it('SHS-4: a failing run records the error and keeps the last good counts', async () => {
    const lastGood = { ranAt: new Date('2026-10-08T06:00:00Z'), counts: { shouldNotBeInOutlook: 3 } };
    const store = memoryStore({ ...lastGood, nextRunAt: new Date('2026-10-08T11:00:00Z') });
    begin(store, jest.fn().mockRejectedValue(new Error('Graph down')));

    await jest.advanceTimersByTimeAsync(60 * 1000);

    expect(store.doc.error).toBe(true);
    expect(store.doc.errorMessage).toBe('Graph down');
    expect(store.doc.errorAt).toBeInstanceOf(Date);
    expect(store.doc.counts).toEqual(lastGood.counts);
    expect(store.doc.ranAt).toEqual(lastGood.ranAt);
  });

  it('SHS-5: the next due tick still runs after a failure', async () => {
    const store = memoryStore();
    const runCheck = jest.fn().mockRejectedValueOnce(new Error('once')).mockResolvedValue(report(1));
    begin(store, runCheck, HOUR);

    await jest.advanceTimersByTimeAsync(60 * 1000); // boot tick fails
    await jest.advanceTimersByTimeAsync(2 * HOUR);  // lease expires, next poll runs

    expect(runCheck).toHaveBeenCalledTimes(2);
    expect(store.doc.error).toBe(false);
  });

  it('SHS-6: stop() clears every timer', async () => {
    const runCheck = jest.fn().mockResolvedValue(report());
    begin(memoryStore(), runCheck).stop();
    scheduler = null;

    await jest.advanceTimersByTimeAsync(24 * HOUR);

    expect(runCheck).not.toHaveBeenCalled();
  });

  it('SHS-7: failed deletions are split out of shouldNotBeInOutlook so the badge never double-counts', () => {
    const { counts } = summarizeReport({ calendars: [{
      shouldNotBeInOutlook: [{ reason: 'deleted in app but still in Outlook' }, { reason: 'excluded date still present' }],
    }] });
    expect(counts.failedDeletion).toBe(1);
    expect(counts.shouldNotBeInOutlook).toBe(1);
  });
});

describe('createSettingsStore lease against MongoDB (SHS-8)', () => {
  let client, db;
  beforeAll(async () => {
    ({ db, client } = await connectToGlobalServer('syncHealthSchedulerStore'));
  });
  afterAll(async () => {
    await disconnectFromGlobalServer(client, db);
  });

  it('SHS-8: first acquire wins, a held lease refuses, an expired lease is re-acquired', async () => {
    const store = createSettingsStore(db.collection('templeEvents__SystemSettings'));
    const t0 = new Date('2026-10-08T12:00:00Z');
    expect(await store.tryAcquire({ now: t0, nextRunAt: new Date(t0.getTime() + HOUR), instanceId: 'a' })).toBe(true);
    expect(await store.tryAcquire({ now: new Date(t0.getTime() + 1000), nextRunAt: t0, instanceId: 'b' })).toBe(false);
    expect(await store.tryAcquire({ now: new Date(t0.getTime() + 2 * HOUR), nextRunAt: t0, instanceId: 'b' })).toBe(true);
    expect((await store.read()).leasedBy).toBe('b');
  });
});
