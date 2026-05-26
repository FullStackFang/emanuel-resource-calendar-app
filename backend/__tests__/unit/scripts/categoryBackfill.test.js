const { ObjectId } = require('mongodb');
const { buildReport, resolveIdsForEvent } = require('../../../migrate-backfill-category-ids');

describe('category backfill — buildReport', () => {
  test('proposes MATCH for existing (case-insensitive) and NEW otherwise, with counts', () => {
    const existing = [{ _id: new ObjectId(), name: 'Skirball' }];
    const distinct = [{ name: 'skirball ', count: 12 }, { name: 'Brand New', count: 3 }];
    const report = buildReport(distinct, existing);
    expect(report).toEqual([
      expect.objectContaining({ name: 'skirball ', count: 12, action: 'map', targetId: String(existing[0]._id) }),
      expect.objectContaining({ name: 'Brand New', count: 3, action: 'create', newName: 'Brand New' }),
    ]);
  });

  test('skips Uncategorized and empty', () => {
    const report = buildReport([{ name: 'Uncategorized', count: 5 }, { name: '  ', count: 1 }], []);
    expect(report.every(r => r.action === 'skip')).toBe(true);
  });
});

describe('category backfill — resolveIdsForEvent', () => {
  test('maps a name array to ids via the confirmed mapping (normalized)', () => {
    const id = new ObjectId();
    const mappingByNorm = new Map([['skirball', id]]);
    expect(resolveIdsForEvent(['Skirball ', 'Uncategorized'], mappingByNorm).map(String)).toEqual([String(id)]);
  });
});
