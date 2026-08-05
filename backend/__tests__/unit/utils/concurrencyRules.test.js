/**
 * Unit tests for utils/concurrencyRules.js
 *
 * The single shared definition of "an overlap in a shared room is a real
 * conflict". Lifted out of the `actualConflicts` filter in checkRoomConflicts()
 * so the publish-time check and the conflict report cannot drift apart.
 *
 * These tests pin the EXISTING publish-time behavior, including its
 * asymmetries — see CR-ASYM below. This module is a pure move; anything that
 * looks like a rule improvement belongs in a separate change.
 *
 * Test IDs: CRU-1 through CRU-12
 */

const { ObjectId } = require('mongodb');
const { isRealConflict } = require('../../../utils/concurrencyRules');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a category map (name -> document) shaped like getCachedCategories().
 * @param {Array<{name: string, allows?: string[]}>} defs - `allows` names the
 *   OTHER categories this one grants concurrency to; they are resolved to the
 *   same ids used elsewhere in the map.
 */
function buildCategoryMap(defs) {
  const ids = new Map(defs.map((d) => [d.name, new ObjectId()]));
  const map = new Map();
  for (const d of defs) {
    map.set(d.name, {
      _id: ids.get(d.name),
      name: d.name,
      allowedConcurrentCategories: (d.allows || []).map((n) => ids.get(n)).filter(Boolean),
    });
  }
  map._ids = ids; // test-only handle for per-event restriction lists
  return map;
}

/** A conflict side, defaulting to the plainest possible event. */
function side(overrides = {}) {
  return { categories: [], ...overrides };
}

// ---------------------------------------------------------------------------
// Category-level bilateral grant
// ---------------------------------------------------------------------------

describe('isRealConflict - category grants are bilateral', () => {
  test('CRU-1: A category of side A permits side B -> not a conflict', () => {
    const categoryMap = buildCategoryMap([
      { name: 'Worship', allows: ['Meeting'] },
      { name: 'Meeting' },
    ]);

    expect(
      isRealConflict(side({ categories: ['Worship'] }), side({ categories: ['Meeting'] }), categoryMap)
    ).toBe(false);
  });

  test('CRU-2: A category of side B permits side A -> not a conflict', () => {
    // Same fixture with the grant on the other side. Reversing only the grant
    // direction must not change the verdict.
    const categoryMap = buildCategoryMap([
      { name: 'Worship' },
      { name: 'Meeting', allows: ['Worship'] },
    ]);

    expect(
      isRealConflict(side({ categories: ['Worship'] }), side({ categories: ['Meeting'] }), categoryMap)
    ).toBe(false);
  });

  test('CRU-3: neither category permits the other -> falls through to the per-event rules', () => {
    const categoryMap = buildCategoryMap([{ name: 'Worship' }, { name: 'Meeting' }]);

    // Neither side allows concurrency, so the fallback verdict is "conflict".
    // If the category branch had wrongly short-circuited, this would be false.
    expect(
      isRealConflict(side({ categories: ['Worship'] }), side({ categories: ['Meeting'] }), categoryMap)
    ).toBe(true);
  });

  test('CRU-4: a category name with no document contributes no grant and does not throw', () => {
    const categoryMap = buildCategoryMap([{ name: 'Meeting' }]);

    expect(() =>
      isRealConflict(side({ categories: ['Ghost'] }), side({ categories: ['Meeting'] }), categoryMap)
    ).not.toThrow();

    expect(
      isRealConflict(side({ categories: ['Ghost'] }), side({ categories: ['Meeting'] }), categoryMap)
    ).toBe(true);
  });

  test('CRU-5: an empty category map resolves nothing and does not throw', () => {
    const categoryMap = new Map();

    expect(
      isRealConflict(side({ categories: ['Worship'] }), side({ categories: ['Meeting'] }), categoryMap)
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Per-event concurrency flags (legacy fallback)
// ---------------------------------------------------------------------------

describe('isRealConflict - per-event concurrency flags', () => {
  test('CRU-6: neither side allows concurrency -> conflict', () => {
    const categoryMap = buildCategoryMap([]);

    expect(
      isRealConflict(
        side({ isAllowedConcurrent: false }),
        side({ isAllowedConcurrent: false }),
        categoryMap
      )
    ).toBe(true);
  });

  test('CRU-7: an absent isAllowedConcurrent is treated as false', () => {
    const categoryMap = buildCategoryMap([]);

    // Neither side carries the field at all. If absence were permissive this
    // would come back false and every legacy event would silently stop
    // conflicting.
    expect(isRealConflict(side(), side(), categoryMap)).toBe(true);
  });

  test('CRU-8: concurrency allowed with an empty restriction list permits any counterpart', () => {
    const categoryMap = buildCategoryMap([{ name: 'Meeting' }]);

    expect(
      isRealConflict(
        side({ categories: ['Meeting'] }),
        side({ isAllowedConcurrent: true, allowedConcurrentCategories: [] }),
        categoryMap
      )
    ).toBe(false);
  });

  test('CRU-9: restricted concurrency with a matching counterpart category -> not a conflict', () => {
    const categoryMap = buildCategoryMap([{ name: 'Meeting' }, { name: 'Worship' }]);
    const meetingId = categoryMap._ids.get('Meeting');

    expect(
      isRealConflict(
        side({ categories: ['Meeting'] }),
        side({
          categories: ['Worship'],
          isAllowedConcurrent: true,
          allowedConcurrentCategories: [meetingId],
        }),
        categoryMap
      )
    ).toBe(false);
  });

  test('CRU-10: restricted concurrency with no matching counterpart category -> conflict', () => {
    const categoryMap = buildCategoryMap([
      { name: 'Meeting' },
      { name: 'Worship' },
      { name: 'Rehearsal' },
    ]);
    const rehearsalId = categoryMap._ids.get('Rehearsal');

    expect(
      isRealConflict(
        side({ categories: ['Meeting'] }),
        side({
          categories: ['Worship'],
          isAllowedConcurrent: true,
          allowedConcurrentCategories: [rehearsalId],
        }),
        categoryMap
      )
    ).toBe(true);
  });

  test('CRU-11: restriction list entries compare as strings, not by object identity', () => {
    // Stored lists hold ObjectIds; a caller may hand back strings. Both must
    // match, otherwise the restriction silently never matches.
    const categoryMap = buildCategoryMap([{ name: 'Meeting' }, { name: 'Worship' }]);
    const meetingIdString = categoryMap._ids.get('Meeting').toString();

    expect(
      isRealConflict(
        side({ categories: ['Meeting'] }),
        side({
          categories: ['Worship'],
          isAllowedConcurrent: true,
          allowedConcurrentCategories: [meetingIdString],
        }),
        categoryMap
      )
    ).toBe(false);
  });

  test('CRU-12 (CR-ASYM): only side B\'s restriction list is consulted', () => {
    // PINS EXISTING BEHAVIOR, NOT AN ENDORSEMENT OF IT.
    //
    // checkRoomConflicts() reaches its `requestAllowsConcurrent` branch only
    // after the sideB branch declined, and that branch returns "not a conflict"
    // WITHOUT consulting side A's restriction list. So a side-A restriction
    // that does not match is still permissive.
    //
    // Extracting the predicate must not change this: publish-time behavior is
    // the contract, and the report calls the same function so the two agree.
    const categoryMap = buildCategoryMap([{ name: 'Meeting' }, { name: 'Worship' }]);
    const rehearsalOnlyId = new ObjectId();

    const verdict = isRealConflict(
      side({
        categories: ['Meeting'],
        isAllowedConcurrent: true,
        allowedConcurrentCategories: [rehearsalOnlyId], // does NOT list Worship
      }),
      side({ categories: ['Worship'], isAllowedConcurrent: false }),
      categoryMap
    );

    expect(verdict).toBe(false);
  });
});
