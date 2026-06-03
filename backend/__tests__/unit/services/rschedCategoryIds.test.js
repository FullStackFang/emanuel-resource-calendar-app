const { ObjectId } = require('mongodb');
const { stampCategoryIds } = require('../../../services/rschedImportService');

/**
 * rsched imports must stamp calendarData.categoryIds (mirroring locations) so
 * imported events are id-linked, not name-only — and must resolve a renamed
 * category from the external name via its alias instead of spawning a duplicate.
 */
function mockCategoriesCollection(docs) {
  const inserted = [];
  return {
    inserted,
    find: () => ({ toArray: async () => docs.concat(inserted) }),
    insertOne: jest.fn(async (d) => {
      const _id = new ObjectId();
      inserted.push({ _id, ...d });
      return { insertedId: _id };
    }),
  };
}

describe('rsched stampCategoryIds', () => {
  test('resolves a matching category name to its id (no insert)', async () => {
    const id = new ObjectId();
    const col = mockCategoriesCollection([{ _id: id, name: 'Concert', displayOrder: 1 }]);
    const db = { collection: () => col };
    const candidate = { calendarData: { categories: ['Concert'] } };
    const ctx = {};

    await stampCategoryIds(db, candidate, ctx);

    expect(candidate.calendarData.categoryIds.map(String)).toEqual([String(id)]);
    expect(col.insertOne).not.toHaveBeenCalled();
  });

  test('resolves a RENAMED category from the external name via alias — no duplicate', async () => {
    const bneiId = new ObjectId();
    const col = mockCategoriesCollection([
      { _id: bneiId, name: "B'nei Mitzvah", aliases: ['Bar/Bas Mitzvah'], displayOrder: 1 },
    ]);
    const db = { collection: () => col };
    const candidate = { calendarData: { categories: ['Bar/Bas Mitzvah'] } };
    const ctx = {};

    await stampCategoryIds(db, candidate, ctx);

    expect(candidate.calendarData.categoryIds.map(String)).toEqual([String(bneiId)]);
    expect(col.insertOne).not.toHaveBeenCalled(); // alias-matched, not duplicated
  });

  test('builds the category map once per import (cached on ctx across rows)', async () => {
    const id = new ObjectId();
    const docs = [{ _id: id, name: 'Concert', displayOrder: 1 }];
    const col = mockCategoriesCollection(docs);
    const findSpy = jest.spyOn(col, 'find');
    const db = { collection: () => col };
    const ctx = {};

    await stampCategoryIds(db, { calendarData: { categories: ['Concert'] } }, ctx);
    await stampCategoryIds(db, { calendarData: { categories: ['Concert'] } }, ctx);

    expect(findSpy).toHaveBeenCalledTimes(1); // second row reuses ctx-cached map
  });
});
