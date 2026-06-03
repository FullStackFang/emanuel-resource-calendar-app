const DEFAULT_COLOR = '#808080';

/** Normalize a category name for case/whitespace-insensitive matching. */
function normalizeCategoryName(name) {
  return (name || '').trim().toLowerCase();
}

/**
 * Build a Map(normalizedName -> categoryDoc) from any Map whose values carry a
 * .name string (and optionally a .aliases string array).
 *
 * Aliases let a renamed category keep resolving from its OLD name — e.g. an
 * external source (rsched) still exporting "Bar/Bas Mitzvah" resolves to the
 * renamed "B'nei Mitzvah" instead of spawning a duplicate. Names are indexed
 * first so a real category name always wins over another category's alias.
 */
function buildNormalizedCategoryMap(cacheMap) {
  const m = new Map();
  for (const doc of cacheMap.values()) {
    m.set(normalizeCategoryName(doc.name), doc);
  }
  for (const doc of cacheMap.values()) {
    for (const alias of doc.aliases || []) {
      const na = normalizeCategoryName(alias);
      if (na && !m.has(na)) m.set(na, doc);
    }
  }
  return m;
}

/**
 * Resolve category name strings to ObjectIds against a normalized lookup.
 * Auto-creates a record for any name not found (autoCreated: true). Mutates
 * normMap with newly created docs. Skips 'Uncategorized' and empty names.
 *
 * @param {string[]} names
 * @param {{ normMap: Map, categoriesCollection: { insertOne: Function } }} deps
 * @returns {Promise<{ ids: ObjectId[], created: number }>}
 */
async function resolveCategoryIds(names, { normMap, categoriesCollection }) {
  const list = (names || [])
    .map(n => (n || '').trim())
    .filter(n => n && normalizeCategoryName(n) !== 'uncategorized');

  let maxOrder = 0;
  for (const doc of normMap.values()) maxOrder = Math.max(maxOrder, doc.displayOrder || 0);

  const ids = [];
  let created = 0;
  for (const name of list) {
    const norm = normalizeCategoryName(name);
    let doc = normMap.get(norm);
    if (!doc) {
      maxOrder += 1;
      const insert = {
        name,
        type: 'base',
        color: DEFAULT_COLOR,
        description: '',
        displayOrder: maxOrder,
        allowedConcurrentCategories: [],
        active: true,
        autoCreated: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const res = await categoriesCollection.insertOne(insert);
      doc = { _id: res.insertedId, ...insert };
      normMap.set(norm, doc);
      created += 1;
    }
    if (!ids.some(id => String(id) === String(doc._id))) ids.push(doc._id);
  }
  return { ids, created };
}

module.exports = { normalizeCategoryName, buildNormalizedCategoryMap, resolveCategoryIds };
