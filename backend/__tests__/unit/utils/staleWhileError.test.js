// Unit tests for createStaleWhileErrorCache — the serve-stale-on-error policy
// for rarely-changing reference data (calendar markers, categories) behind a
// flaky datastore (Cosmos throttling). The contract:
//   - fresh value served from cache within TTL (load runs once)
//   - reload after TTL expiry
//   - a FAILED reload serves the last good value instead of throwing
//   - only the very first load (no prior value) may throw
//   - invalidate() forces a reload on the next get

const { createStaleWhileErrorCache } = require('../../../utils/staleWhileError');

describe('createStaleWhileErrorCache', () => {
  // Controllable clock so TTL expiry is deterministic.
  let clock;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000_000;
  });

  it('loads once and serves the cached value within the TTL', async () => {
    const load = jest.fn(async () => ['a']);
    const cache = createStaleWhileErrorCache({ ttlMs: 1000, load, now });

    expect(await cache.get()).toEqual(['a']);
    clock += 500; // still within TTL
    expect(await cache.get()).toEqual(['a']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads after the TTL expires', async () => {
    let n = 0;
    const load = jest.fn(async () => [`v${++n}`]);
    const cache = createStaleWhileErrorCache({ ttlMs: 1000, load, now });

    expect(await cache.get()).toEqual(['v1']);
    clock += 1001; // past TTL
    expect(await cache.get()).toEqual(['v2']);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('serves the last good value when a reload throws (stale-on-error)', async () => {
    let mode = 'ok';
    const load = jest.fn(async () => {
      if (mode === 'fail') throw new Error('Cosmos 16500');
      return ['good'];
    });
    const cache = createStaleWhileErrorCache({ ttlMs: 1000, load, now });

    expect(await cache.get()).toEqual(['good']); // prime the cache
    mode = 'fail';
    clock += 2000; // force a reload attempt, which now fails

    // Stale value is served instead of propagating the throttle error.
    expect(await cache.get()).toEqual(['good']);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('rethrows when the very first load fails (no stale value to fall back on)', async () => {
    const load = jest.fn(async () => {
      throw new Error('Cosmos 16500');
    });
    const cache = createStaleWhileErrorCache({ ttlMs: 1000, load, now });

    await expect(cache.get()).rejects.toThrow('Cosmos 16500');
  });

  it('recovers to fresh data once the datastore comes back', async () => {
    let mode = 'ok';
    const load = jest.fn(async () => {
      if (mode === 'fail') throw new Error('throttled');
      return [mode];
    });
    const cache = createStaleWhileErrorCache({ ttlMs: 1000, load, now });

    expect(await cache.get()).toEqual(['ok']);
    mode = 'fail';
    clock += 2000;
    expect(await cache.get()).toEqual(['ok']); // stale during outage
    mode = 'recovered';
    clock += 2000;
    expect(await cache.get()).toEqual(['recovered']); // fresh after recovery
  });

  it('invalidate() forces a reload on the next get', async () => {
    let n = 0;
    const load = jest.fn(async () => [`v${++n}`]);
    const cache = createStaleWhileErrorCache({ ttlMs: 60_000, load, now });

    expect(await cache.get()).toEqual(['v1']);
    cache.invalidate();
    expect(await cache.get()).toEqual(['v2']); // reloaded despite TTL not expiring
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('supports non-array values (e.g. a Map) transparently', async () => {
    const load = jest.fn(async () => new Map([['k', 'v']]));
    const cache = createStaleWhileErrorCache({ ttlMs: 1000, load, now });

    const result = await cache.get();
    expect(result).toBeInstanceOf(Map);
    expect(result.get('k')).toBe('v');
  });
});
