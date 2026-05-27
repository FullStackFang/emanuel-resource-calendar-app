const { ObjectId } = require('mongodb');
const {
  normalizeCategoryName,
  buildNormalizedCategoryMap,
  resolveCategoryIds,
} = require('../../../utils/categoryResolver');

describe('categoryResolver', () => {
  test('normalizeCategoryName trims and lowercases', () => {
    expect(normalizeCategoryName('  Skirball ')).toBe('skirball');
    expect(normalizeCategoryName(null)).toBe('');
  });

  test('buildNormalizedCategoryMap keys by normalized name', () => {
    const cache = new Map([['Skirball', { _id: new ObjectId(), name: 'Skirball', displayOrder: 3 }]]);
    const m = buildNormalizedCategoryMap(cache);
    expect(m.get('skirball').name).toBe('Skirball');
  });

  test('resolveCategoryIds maps existing (case-insensitive), skips Uncategorized/empty', async () => {
    const id = new ObjectId();
    const normMap = new Map([['skirball', { _id: id, name: 'Skirball', displayOrder: 3 }]]);
    const categoriesCollection = { insertOne: jest.fn() };
    const { ids, created } = await resolveCategoryIds(['Skirball ', 'Uncategorized', ''], { normMap, categoriesCollection });
    expect(created).toBe(0);
    expect(ids.map(String)).toEqual([String(id)]);
    expect(categoriesCollection.insertOne).not.toHaveBeenCalled();
  });

  test('resolveCategoryIds auto-creates on miss with autoCreated flag and incrementing displayOrder', async () => {
    const normMap = new Map([['skirball', { _id: new ObjectId(), name: 'Skirball', displayOrder: 3 }]]);
    const inserted = [];
    const categoriesCollection = {
      insertOne: jest.fn(async (doc) => { const _id = new ObjectId(); inserted.push({ _id, ...doc }); return { insertedId: _id }; }),
    };
    const { ids, created } = await resolveCategoryIds(['NewCat', 'OtherCat'], { normMap, categoriesCollection });
    expect(created).toBe(2);
    expect(ids).toHaveLength(2);
    expect(inserted[0]).toMatchObject({ name: 'NewCat', active: true, autoCreated: true, displayOrder: 4 });
    expect(inserted[1].displayOrder).toBe(5);
  });

  test('resolveCategoryIds dedups repeated names', async () => {
    const id = new ObjectId();
    const normMap = new Map([['a', { _id: id, name: 'A', displayOrder: 1 }]]);
    const { ids } = await resolveCategoryIds(['A', 'a', ' A '], { normMap, categoriesCollection: { insertOne: jest.fn() } });
    expect(ids.map(String)).toEqual([String(id)]);
  });

  test('resolveCategoryIds mutates normMap to prevent double-inserts across calls', async () => {
    const normMap = new Map();
    const categoriesCollection = {
      insertOne: jest.fn(async () => ({ insertedId: new ObjectId() })),
    };

    const first = await resolveCategoryIds(['NewCat'], { normMap, categoriesCollection });
    expect(first.created).toBe(1);
    expect(categoriesCollection.insertOne).toHaveBeenCalledTimes(1);

    const second = await resolveCategoryIds(['NewCat'], { normMap, categoriesCollection });
    expect(second.created).toBe(0);
    expect(categoriesCollection.insertOne).toHaveBeenCalledTimes(1);

    expect(first.ids.map(String)).toEqual(second.ids.map(String));
  });
});
