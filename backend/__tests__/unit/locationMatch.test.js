/**
 * Unit tests for utils/locationMatch.js
 *
 * `locationMatchIds` expands room ids into both ObjectId and string forms so a
 * `$in` match on `calendarData.locations` catches documents stored with either
 * type. Root cause of the "string-stored blocker never flags as a conflict" bug.
 *
 * Test IDs: LM-1 through LM-7
 */

const { ObjectId } = require('mongodb');
const { locationMatchIds } = require('../../utils/locationMatch');

const HEX = '6912551f9a0bc143b144438b';
const HEX2 = '6912551f9a0bc143b1440000';

describe('locationMatchIds (LM)', () => {
  it('LM-1: expands an ObjectId input into both ObjectId and string forms', () => {
    const out = locationMatchIds([new ObjectId(HEX)]);
    expect(out).toHaveLength(2);
    expect(out.some((x) => x instanceof ObjectId && x.toString() === HEX)).toBe(true);
    expect(out.some((x) => x === HEX)).toBe(true);
  });

  it('LM-2: expands a string input into both forms', () => {
    const out = locationMatchIds([HEX]);
    expect(out).toHaveLength(2);
    expect(out.some((x) => x instanceof ObjectId && x.toString() === HEX)).toBe(true);
    expect(out).toContain(HEX);
  });

  it('LM-3: dedupes when both forms of the same id are supplied', () => {
    const out = locationMatchIds([HEX, new ObjectId(HEX)]);
    // exactly one ObjectId + one string, not duplicated
    expect(out).toHaveLength(2);
    expect(out.filter((x) => x instanceof ObjectId)).toHaveLength(1);
    expect(out.filter((x) => typeof x === 'string')).toHaveLength(1);
  });

  it('LM-4: drops null/undefined entries and tolerates null/undefined input', () => {
    expect(locationMatchIds([null, undefined])).toEqual([]);
    expect(locationMatchIds(null)).toEqual([]);
    expect(locationMatchIds(undefined)).toEqual([]);
    expect(locationMatchIds([])).toEqual([]);
  });

  it('LM-5: keeps a non-hex string as a string-only match (no bogus ObjectId)', () => {
    const out = locationMatchIds(['not-an-objectid']);
    expect(out).toEqual(['not-an-objectid']);
  });

  it('LM-6: handles multiple distinct ids, both forms each', () => {
    const out = locationMatchIds([HEX, HEX2]);
    expect(out).toHaveLength(4);
    expect(out.filter((x) => x instanceof ObjectId)).toHaveLength(2);
    expect(out.filter((x) => typeof x === 'string')).toHaveLength(2);
  });

  it('LM-7: a mixed ObjectId+string input list still yields one pair per id', () => {
    // mirrors real callers: roomIds already normalized to ObjectId, but the
    // stored docs may be strings — we must still emit the string form.
    const out = locationMatchIds([new ObjectId(HEX), HEX2]);
    expect(out).toHaveLength(4);
    // both forms of HEX present
    expect(out.some((x) => x instanceof ObjectId && x.toString() === HEX)).toBe(true);
    expect(out).toContain(HEX);
    // both forms of HEX2 present
    expect(out.some((x) => x instanceof ObjectId && x.toString() === HEX2)).toBe(true);
    expect(out).toContain(HEX2);
  });
});
