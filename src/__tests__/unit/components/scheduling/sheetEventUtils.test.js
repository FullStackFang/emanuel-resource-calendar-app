// sheetEventUtils.test.js
//
// Pure reorder-helper behavior (tasks 1.1-1.2 of scheduling-sheet-drag-reorder):
// column reorder preserves object identity/order, and custom-row reorder keeps
// starter rows locked as a fixed prefix.
//
// Test IDs: SRU-* (sheet reorder utils)

import { describe, it, expect } from 'vitest';
import {
  moveArrayItem,
  moveArrayItemBy,
  reorderArrayItem,
  customRowsOf,
  reorderCustomRows,
  moveCustomRowBy,
  moveCustomRowTo,
} from '../../../../components/scheduling/sheetEventUtils';

const cols = () => [
  { id: 'c1', name: 'Erev Service' },
  { id: 'c2', name: 'YP Dinner' },
  { id: 'c3', name: 'Overflow' },
];

describe('column reorder helpers', () => {
  it('SRU-1: moveArrayItemBy(+1) moves a column one position right, preserving ids and object shape', () => {
    const next = moveArrayItemBy(cols(), 'c1', 1);
    expect(next.map((c) => c.id)).toEqual(['c2', 'c1', 'c3']);
    expect(next.find((c) => c.id === 'c1')).toEqual({ id: 'c1', name: 'Erev Service' });
  });

  it('SRU-2: moveArrayItemBy(-1) moves a column one position left', () => {
    const next = moveArrayItemBy(cols(), 'c3', -1);
    expect(next.map((c) => c.id)).toEqual(['c1', 'c3', 'c2']);
  });

  it('SRU-3: moveArrayItem moves a column across multiple positions in one call', () => {
    const next = moveArrayItem(cols(), 'c3', 0);
    expect(next.map((c) => c.id)).toEqual(['c3', 'c1', 'c2']);
  });

  it('SRU-4: reorderArrayItem drops a column onto another column position', () => {
    const next = reorderArrayItem(cols(), 'c1', 'c3');
    expect(next.map((c) => c.id)).toEqual(['c2', 'c3', 'c1']);
  });

  it('SRU-5: moves are clamped at the boundaries instead of throwing or dropping items', () => {
    const original = cols();
    expect(moveArrayItemBy(original, 'c1', -5).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(moveArrayItemBy(original, 'c3', 5).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('SRU-6: an unknown id is a no-op that returns the same array reference', () => {
    const original = cols();
    expect(moveArrayItemBy(original, 'nope', 1)).toBe(original);
    expect(reorderArrayItem(original, 'nope', 'c2')).toBe(original);
  });

  it('SRU-7: dragging a column onto itself is a no-op', () => {
    const original = cols();
    expect(reorderArrayItem(original, 'c2', 'c2')).toBe(original);
  });
});

const rows = () => [
  { id: 'rLoc', label: 'Location', kind: 'starter' },
  { id: 'rCall', label: 'Call Time', kind: 'starter' },
  { id: 'rBegins', label: 'Begins', kind: 'starter' },
  { id: 'rUshers', label: 'Ushers', kind: 'custom' },
  { id: 'rGreeters', label: 'Greeters', kind: 'custom' },
  { id: 'rSecurity', label: 'Security', kind: 'custom' },
];

describe('custom row reorder helpers', () => {
  it('SRU-8: customRowsOf splits out only non-starter rows', () => {
    expect(customRowsOf(rows()).map((r) => r.id)).toEqual(['rUshers', 'rGreeters', 'rSecurity']);
  });

  it('SRU-9: reorderCustomRows keeps starter rows first in their original order', () => {
    const next = reorderCustomRows(rows(), 'rSecurity', 'rUshers');
    expect(next.map((r) => r.id)).toEqual(['rLoc', 'rCall', 'rBegins', 'rSecurity', 'rUshers', 'rGreeters']);
  });

  it('SRU-10: moveCustomRowBy moves within the custom group only, starters untouched', () => {
    const next = moveCustomRowBy(rows(), 'rUshers', 1);
    expect(next.map((r) => r.id)).toEqual(['rLoc', 'rCall', 'rBegins', 'rGreeters', 'rUshers', 'rSecurity']);
  });

  it('SRU-11: moveCustomRowTo(0) moves a custom row to the top of the custom group, not above starters', () => {
    const next = moveCustomRowTo(rows(), 'rSecurity', 0);
    expect(next.map((r) => r.id)).toEqual(['rLoc', 'rCall', 'rBegins', 'rSecurity', 'rUshers', 'rGreeters']);
  });

  it('SRU-12: a starter row id passed to a custom-row mover is a no-op (starter rows never move)', () => {
    const original = rows();
    expect(moveCustomRowBy(original, 'rCall', 1)).toBe(original);
    expect(reorderCustomRows(original, 'rCall', 'rUshers')).toBe(original);
  });

  it('SRU-13: custom row moves are clamped at the group boundary', () => {
    const original = rows();
    expect(moveCustomRowBy(original, 'rUshers', -5).map((r) => r.id)).toEqual(
      ['rLoc', 'rCall', 'rBegins', 'rUshers', 'rGreeters', 'rSecurity']
    );
    expect(moveCustomRowBy(original, 'rSecurity', 5).map((r) => r.id)).toEqual(
      ['rLoc', 'rCall', 'rBegins', 'rUshers', 'rGreeters', 'rSecurity']
    );
  });
});
