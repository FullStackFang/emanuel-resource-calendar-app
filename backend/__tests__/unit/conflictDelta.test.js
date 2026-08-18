/**
 * Unit tests for utils/conflictDelta.js
 *
 * The pure, deps-free definition of "which of the proposed hard conflicts did
 * this save INTRODUCE?" — the delta rule at the heart of save-conflict-delta-gate.
 * Modeled on concurrencyRules.test.js: no db, no api-server, keys and set math
 * only. The endpoint wiring is covered by saveConflictDelta.test.js.
 *
 * Test IDs: CD-1 through CD-12
 */

const { ObjectId } = require('mongodb');
const { conflictKey, introducedConflicts } = require('../../utils/conflictDelta');

// ---------------------------------------------------------------------------
// Helpers — entries shaped like checkRoomConflicts()/checkRecurringRoomConflicts()
// hard-conflict result entries.
// ---------------------------------------------------------------------------

/** A single-window neighbour that is a singleInstance/exception/addition doc. */
function singleEntry(id, rooms, extra = {}) {
  return { id: String(id), rooms, ...extra };
}

/** A single-window neighbour that is a published series master. */
function masterEntry(id, rooms, occurrenceStartDateTime) {
  return { id: String(id), rooms, occurrenceStartDateTime };
}

/** A recurring-source per-date entry (flattened, carries occurrenceDate + rooms). */
function recurringEntry(id, rooms, occurrenceDate) {
  return { id: String(id), rooms, occurrenceDate };
}

describe('conflictDelta', () => {
  // -------------------------------------------------------------------------
  // conflictKey
  // -------------------------------------------------------------------------

  test('CD-1: ObjectId room ids and string request ids compare equal', () => {
    const roomA = new ObjectId();
    const entry = singleEntry('evtX', [roomA]); // rooms as ObjectId
    const keys = conflictKey(entry, [roomA.toString()]); // request as string
    expect(keys).toEqual([`evtX::${roomA.toString()}`]);
  });

  test('CD-2: per-room intersection — only shared rooms produce keys', () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const c = new ObjectId();
    // neighbour occupies a,b; request books b,c → only b is shared
    const entry = singleEntry('evtX', [a, b]);
    const keys = conflictKey(entry, [b.toString(), c.toString()]);
    expect(keys).toEqual([`evtX::${b.toString()}`]);
  });

  test('CD-3: a neighbour in two shared rooms yields one key per room', () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const entry = singleEntry('evtX', [a, b]);
    const keys = conflictKey(entry, [a.toString(), b.toString()]);
    expect(new Set(keys)).toEqual(new Set([`evtX::${a.toString()}`, `evtX::${b.toString()}`]));
  });

  test('CD-4: non-master entry key is unqualified (id::room)', () => {
    const a = new ObjectId();
    const entry = singleEntry('evtX', [a]);
    expect(conflictKey(entry, [a.toString()])).toEqual([`evtX::${a.toString()}`]);
  });

  test('CD-5: master-derived entry key carries the occurrence start', () => {
    const a = new ObjectId();
    const entry = masterEntry('masterM', [a], '2026-03-23T16:00:00');
    expect(conflictKey(entry, [a.toString()])).toEqual([
      `masterM::${a.toString()}::2026-03-23T16:00:00`,
    ]);
  });

  test('CD-6: recurring entry key is date::id::room', () => {
    const a = new ObjectId();
    const entry = recurringEntry('neighbourN', [a], '2026-02-10');
    expect(conflictKey(entry, [a.toString()])).toEqual([
      `2026-02-10::neighbourN::${a.toString()}`,
    ]);
  });

  test('CD-7: no shared rooms → no keys', () => {
    const a = new ObjectId();
    const other = new ObjectId();
    const entry = singleEntry('evtX', [a]);
    expect(conflictKey(entry, [other.toString()])).toEqual([]);
  });

  test('CD-8: missing rooms array → no keys (defensive)', () => {
    expect(conflictKey({ id: 'evtX' }, [new ObjectId().toString()])).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // introducedConflicts
  // -------------------------------------------------------------------------

  test('CD-9: identical baseline and proposed sets → nothing introduced', () => {
    const a = new ObjectId();
    const baseline = [singleEntry('evtX', [a])];
    const proposed = [singleEntry('evtX', [a])];
    const { introduced, preexisting } = introducedConflicts(baseline, proposed, [a.toString()]);
    expect(introduced).toEqual([]);
    expect(preexisting).toHaveLength(1);
  });

  test('CD-10: empty baseline → everything introduced', () => {
    const a = new ObjectId();
    const proposed = [singleEntry('evtX', [a]), singleEntry('evtY', [a])];
    const { introduced, preexisting } = introducedConflicts([], proposed, [a.toString()]);
    expect(introduced).toHaveLength(2);
    expect(preexisting).toEqual([]);
  });

  test('CD-11: same neighbour, additional room, is introduced', () => {
    const a = new ObjectId();
    const b = new ObjectId();
    // baseline: X collides in room A only
    const baseline = [singleEntry('evtX', [a])];
    // proposed: X now collides in rooms A and B (B added to the request)
    const proposed = [singleEntry('evtX', [a, b])];
    const { introduced, preexisting } = introducedConflicts(baseline, proposed, [
      a.toString(),
      b.toString(),
    ]);
    // Entry X's key set {X::A, X::B} is NOT a subset of baseline {X::A} → introduced
    expect(introduced).toHaveLength(1);
    expect(introduced[0].id).toBe('evtX');
    expect(preexisting).toEqual([]);
  });

  test('CD-12: same master, different occurrence, is introduced', () => {
    const a = new ObjectId();
    // baseline: collides with master M on the 3/2 occurrence
    const baseline = [masterEntry('masterM', [a], '2026-03-02T16:00:00')];
    // proposed: still master M, room A, but a different Monday occurrence
    const proposed = [masterEntry('masterM', [a], '2026-03-23T16:00:00')];
    const { introduced, preexisting } = introducedConflicts(baseline, proposed, [a.toString()]);
    expect(introduced).toHaveLength(1);
    expect(preexisting).toEqual([]);
  });

  test('CD-13: carrying an unrelated collision (different room kept) is preexisting', () => {
    const a = new ObjectId(); // removed from request
    const b = new ObjectId(); // kept
    // baseline: X collides via A and B
    const baseline = [singleEntry('evtX', [a, b])];
    // proposed: request keeps only B; X still collides via B
    const proposed = [singleEntry('evtX', [b])];
    const { introduced, preexisting } = introducedConflicts(baseline, proposed, [b.toString()]);
    // baseline keys intersected with request {B} → {X::B}; proposed {X::B} ⊆ baseline → preexisting
    expect(introduced).toEqual([]);
    expect(preexisting).toHaveLength(1);
  });
});
