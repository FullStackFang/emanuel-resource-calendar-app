/**
 * Unit tests for createIndexesResilient.
 *
 * Why this exists: createUnifiedEventIndexes() previously created ~13 indexes in a
 * SINGLE try/catch with sequential awaits. The FIRST index that Cosmos rejected
 * (e.g. a compound index on a nested calendarData.* path, which this account refuses
 * with "Unique and compound indexes do not support nested paths") threw, the catch
 * swallowed it, and EVERY subsequent index was silently skipped. Production index
 * coverage then depended on where the first rejection landed — invisibly.
 *
 * createIndexesResilient must:
 *   1. Attempt EVERY spec even when an earlier one throws (no abort-on-first-failure).
 *   2. Treat benign "already exists" / Cosmos code-67 outcomes as skipped, not failed.
 *   3. Surface genuine failures (return them AND log them) so missing coverage is visible.
 */
const { createIndexesResilient } = require('../../../utils/createIndexesResilient');

function fakeCollection(behavior) {
  // behavior: map of index name -> 'ok' | Error to throw
  const calls = [];
  return {
    calls,
    createIndex: async (key, options) => {
      calls.push(options.name);
      const outcome = behavior[options.name];
      if (outcome instanceof Error) throw outcome;
      return options.name;
    },
  };
}

const SPECS = [
  { key: { a: 1 }, options: { name: 'idx_a' } },
  { key: { b: 1 }, options: { name: 'idx_b' } },
  { key: { c: 1 }, options: { name: 'idx_c' } },
];

describe('createIndexesResilient', () => {
  it('CIR-1: attempts every spec even when an earlier one throws (no abort-on-first-failure)', async () => {
    const boom = new Error('compound index on nested path not supported');
    const coll = fakeCollection({ idx_a: 'ok', idx_b: boom, idx_c: 'ok' });

    const result = await createIndexesResilient(coll, SPECS);

    // All three were attempted — the throw on idx_b did NOT abort idx_c.
    expect(coll.calls).toEqual(['idx_a', 'idx_b', 'idx_c']);
    expect(result.created).toEqual(['idx_a', 'idx_c']);
    expect(result.failed.map(f => f.name)).toEqual(['idx_b']);
  });

  it('CIR-2: reports all created when every spec succeeds', async () => {
    const coll = fakeCollection({ idx_a: 'ok', idx_b: 'ok', idx_c: 'ok' });
    const result = await createIndexesResilient(coll, SPECS);
    expect(result.created).toEqual(['idx_a', 'idx_b', 'idx_c']);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('CIR-3: treats Cosmos code-67 / already-exists as skipped, not failed', async () => {
    const code67 = Object.assign(new Error('CannotCreateIndex'), { code: 67 });
    const dup = new Error('Index already exists with a different name');
    const coll = fakeCollection({ idx_a: code67, idx_b: dup, idx_c: 'ok' });

    const result = await createIndexesResilient(coll, SPECS);

    expect(result.skipped.sort()).toEqual(['idx_a', 'idx_b']);
    expect(result.created).toEqual(['idx_c']);
    expect(result.failed).toEqual([]);
  });

  it('CIR-4: surfaces genuine failures via the logger and the returned result', async () => {
    const boom = Object.assign(new Error('nested path rejected'), { code: 2 });
    const coll = fakeCollection({ idx_a: 'ok', idx_b: boom, idx_c: 'ok' });
    const errors = [];
    const logger = { error: (m) => errors.push(m), warn: () => {} };

    const result = await createIndexesResilient(coll, SPECS, { logger });

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].name).toBe('idx_b');
    expect(result.failed[0].message).toMatch(/nested path rejected/);
    expect(errors.join('\n')).toMatch(/idx_b/);
  });
});
