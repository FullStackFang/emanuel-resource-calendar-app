# Category ObjectId Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make event categories reference `templeEvents__Categories` by `_id` (mirroring the location model) so filtering is rename-proof and every in-use category maps to a canonical record.

**Architecture:** Additive — add `calendarData.categoryIds: [ObjectId]` alongside the existing `calendarData.categories: [name]` (kept as denormalized display, like `locationDisplayNames`). A reviewed two-step migration backfills ids with a 100%-coverage assertion; a runtime resolver auto-creates on miss to hold the invariant; the search/export filter matches ids with a transitional name-fallback; category rename propagates display names via the stable id.

**Tech Stack:** Node.js/Express, MongoDB (Azure Cosmos DB), Jest + supertest + mongodb-memory-server (backend), React + Vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-05-26-category-objectid-migration-design.md`

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `backend/utils/categoryResolver.js` | Pure-ish runtime helpers: normalize a name, build a normalized lookup, resolve names→ids (auto-create on miss). Loaded by api-server. | Create |
| `backend/__tests__/unit/utils/categoryResolver.test.js` | Unit tests for the resolver. | Create |
| `backend/migrate-backfill-category-ids.js` | Standalone migration. **Inlines** its own normalization (zero imports of server files, per script-isolation rule). `--report` / `--apply --mapping <f>` / `--verify`. | Create |
| `backend/__tests__/unit/scripts/categoryBackfill.test.js` | Unit tests for the script's pure reconciliation logic (exported separately). | Create |
| `backend/api-server.js` | Dual-write at entry points; filter accepts `categoryIds`; rename propagation. | Modify |
| `backend/services/mcpTools.js` | Same id+name filter predicate. | Modify |
| `backend/__tests__/integration/events/categoryFilterRepro.test.js` | Extend with id-match, name-fallback, rename-propagation cases. | Modify |
| `src/components/EventSearch.jsx` | Map selected names→ids; send `categoryIds`. | Modify |
| `src/components/EventSearchExport.jsx` | Same mapping for export. | Modify |
| `src/__tests__/unit/components/EventSearch.categoryIds.test.jsx` | Frontend mapping test. | Create |
| `.gitignore` | Ignore the operational `backend/category-mapping.json`. | Modify |

---

## Phase 1 — Runtime resolver + backfill script

### Task 1: `categoryResolver.js` util

**Files:**
- Create: `backend/utils/categoryResolver.js`
- Test: `backend/__tests__/unit/utils/categoryResolver.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/__tests__/unit/utils/categoryResolver.test.js
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest __tests__/unit/utils/categoryResolver.test.js`
Expected: FAIL — `Cannot find module '../../../utils/categoryResolver'`.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/utils/categoryResolver.js
const DEFAULT_COLOR = '#999999';

/** Normalize a category name for case/whitespace-insensitive matching. */
function normalizeCategoryName(name) {
  return (name || '').trim().toLowerCase();
}

/** Build a Map(normalizedName -> categoryDoc) from a getCachedCategories() Map. */
function buildNormalizedCategoryMap(cacheMap) {
  const m = new Map();
  for (const doc of cacheMap.values()) {
    m.set(normalizeCategoryName(doc.name), doc);
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
      const insert = { name, color: DEFAULT_COLOR, displayOrder: maxOrder, active: true, autoCreated: true, createdAt: new Date() };
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest __tests__/unit/utils/categoryResolver.test.js`
Expected: PASS (5 tests).

> **Hardening note (architecture review P2 — runtime auto-create race):** The
> server wrapper `resolveCategoryIdsForNames` (Task 4) builds a fresh `normMap`
> per call, so two sync events carrying the same brand-new name in quick
> succession could each attempt an insert. Within a single call, the shared
> `normMap` dedups; across calls the window is small and post-backfill rare (most
> names are already registered). Acceptable for this pass. Recommended follow-up
> (NOT this plan): add a unique index on a normalized category-name field and
> switch the insert to `findOneAndUpdate({...}, { $setOnInsert }, { upsert: true })`
> to make auto-create fully race-safe. Track in Phase 5.

- [ ] **Step 5: Commit**

```bash
git add backend/utils/categoryResolver.js backend/__tests__/unit/utils/categoryResolver.test.js
git commit -m "feat(categories): add categoryResolver util (normalize + resolve names to ids)"
```

---

### Task 2: Backfill migration script

**Files:**
- Create: `backend/migrate-backfill-category-ids.js`
- Test: `backend/__tests__/unit/scripts/categoryBackfill.test.js`

The script INLINES its reconciliation logic but exports two pure functions for testing (`buildReport`, `applyMapping`-pure parts). It imports only `mongodb` + `dotenv` + `fs` — never `api-server.js` or server utils.

- [ ] **Step 1: Write the failing test (pure reconciliation logic)**

```js
// backend/__tests__/unit/scripts/categoryBackfill.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest __tests__/unit/scripts/categoryBackfill.test.js`
Expected: FAIL — `Cannot find module '../../../migrate-backfill-category-ids'`.

- [ ] **Step 3: Write the script**

```js
// backend/migrate-backfill-category-ids.js
/**
 * Backfill calendarData.categoryIds on all events.
 *
 * Two-step reconciliation (see spec 2026-05-26-category-objectid-migration-design.md):
 *   node migrate-backfill-category-ids.js --report                       # write category-mapping.json
 *   (edit category-mapping.json: action = 'map'|'create'|'skip')
 *   node migrate-backfill-category-ids.js --apply --mapping category-mapping.json
 *   node migrate-backfill-category-ids.js --verify
 *
 * Isolated: imports only mongodb/dotenv/fs. Never requires server code.
 */
const fs = require('fs');
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const EVENTS = 'templeEvents__Events';
const CATEGORIES = 'templeEvents__Categories';
const BATCH_SIZE = 100;
const MAPPING_DEFAULT = 'category-mapping.json';

const norm = (s) => (s || '').trim().toLowerCase();

/** Pure: build a proposed mapping report from distinct in-use names + existing categories. */
function buildReport(distinct, existingCategories) {
  const byNorm = new Map(existingCategories.map(c => [norm(c.name), c]));
  return distinct.map(({ name, count }) => {
    const n = norm(name);
    if (!n || n === 'uncategorized') return { name, count, action: 'skip' };
    const match = byNorm.get(n);
    if (match) return { name, count, action: 'map', targetId: String(match._id) };
    return { name, count, action: 'create', newName: name.trim() };
  });
}

/** Pure: resolve an event's category names to ids via a normalized name->id Map. */
function resolveIdsForEvent(names, mappingByNorm) {
  const ids = [];
  for (const name of names || []) {
    const id = mappingByNorm.get(norm(name));
    if (id && !ids.some(x => String(x) === String(id))) ids.push(id);
  }
  return ids;
}

async function getDistinctInUse(db) {
  const names = await db.collection(EVENTS).distinct('calendarData.categories');
  const counts = [];
  for (const name of names) {
    if (name == null) continue;
    const count = await db.collection(EVENTS).countDocuments({ 'calendarData.categories': name });
    counts.push({ name, count });
  }
  return counts.sort((a, b) => b.count - a.count);
}

async function runReport(db, mappingPath) {
  const distinct = await getDistinctInUse(db);
  const existing = await db.collection(CATEGORIES).find({}).toArray();
  const report = buildReport(distinct, existing);
  fs.writeFileSync(mappingPath, JSON.stringify(report, null, 2));
  const news = report.filter(r => r.action === 'create');
  console.log(`\n   Distinct in-use names: ${distinct.length}`);
  console.log(`   Proposed MATCH: ${report.filter(r => r.action === 'map').length}`);
  console.log(`   Proposed CREATE: ${news.length}`);
  console.log(`   SKIP: ${report.filter(r => r.action === 'skip').length}`);
  if (news.length) {
    console.log('\n   NEW records that would be created (review before --apply):');
    news.forEach(r => console.log(`     - "${r.newName}" (${r.count} events)`));
  }
  console.log(`\n   Wrote ${mappingPath}. Edit it, then run --apply --mapping ${mappingPath}.`);
}

async function runApply(db, mappingPath) {
  const report = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));

  // 1. Create approved NEW records.
  const maxOrderDoc = await db.collection(CATEGORIES).find({}).sort({ displayOrder: -1 }).limit(1).toArray();
  let maxOrder = maxOrderDoc[0]?.displayOrder || 0;
  const mappingByNorm = new Map();
  const existing = await db.collection(CATEGORIES).find({}).toArray();
  for (const c of existing) mappingByNorm.set(norm(c.name), c._id);

  let createdCount = 0;
  for (const row of report) {
    if (row.action === 'create') {
      maxOrder += 1;
      const res = await db.collection(CATEGORIES).insertOne({
        name: row.newName, color: '#999999', displayOrder: maxOrder, active: true, autoCreated: true, createdAt: new Date(),
      });
      mappingByNorm.set(norm(row.newName), res.insertedId);
      createdCount += 1;
    } else if (row.action === 'map') {
      mappingByNorm.set(norm(row.name), new ObjectId(row.targetId));
    }
  }
  console.log(`\n   Created ${createdCount} new category records.`);

  // 2. Backfill categoryIds in batches.
  const docs = await db.collection(EVENTS).find({}, { projection: { _id: 1, 'calendarData.categories': 1 } }).toArray();
  console.log(`   Backfilling ${docs.length} events in batches of ${BATCH_SIZE}...`);
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    const ops = batch.map(d => ({
      updateOne: {
        filter: { _id: d._id },
        update: { $set: { 'calendarData.categoryIds': resolveIdsForEvent(d.calendarData?.categories || [], mappingByNorm) } },
      },
    }));
    if (ops.length) await db.collection(EVENTS).bulkWrite(ops, { ordered: false });
    const processed = Math.min(i + BATCH_SIZE, docs.length);
    process.stdout.write(`\r   [Progress] ${Math.round((processed / docs.length) * 100)}% (${processed}/${docs.length})`);
    if (i + BATCH_SIZE < docs.length) await new Promise(r => setTimeout(r, 1000));
  }
  process.stdout.write('\n');

  // 3. Assert 100% coverage: every event with a "real" category name (not
  //    Uncategorized/empty) must have a non-empty categoryIds.
  //    Cosmos-safe: $elemMatch + $size:0 + $exists (no $expr/aggregation in find).
  const unmapped = await db.collection(EVENTS).countDocuments({
    'calendarData.categories': { $elemMatch: { $nin: ['Uncategorized', ''] } },
    $or: [
      { 'calendarData.categoryIds': { $exists: false } },
      { 'calendarData.categoryIds': { $size: 0 } },
    ],
  });
  if (unmapped > 0) {
    throw new Error(`Coverage assertion FAILED: ${unmapped} events still have categories but no categoryIds. Re-run --report and confirm all names.`);
  }
  console.log(`   Coverage assertion passed. Done.`);
}

async function runVerify(db) {
  const total = await db.collection(EVENTS).countDocuments({});
  const withIds = await db.collection(EVENTS).countDocuments({ 'calendarData.categoryIds.0': { $exists: true } });
  const withNamesNoIds = await db.collection(EVENTS).countDocuments({
    'calendarData.categories': { $elemMatch: { $nin: ['Uncategorized', ''] } },
    $or: [
      { 'calendarData.categoryIds': { $exists: false } },
      { 'calendarData.categoryIds': { $size: 0 } },
    ],
  });
  console.log(`\n   Total events: ${total}`);
  console.log(`   With categoryIds: ${withIds}`);
  console.log(`   With names but NO categoryIds: ${withNamesNoIds}`);
}

async function main() {
  const args = process.argv.slice(2);
  const mappingIdx = args.indexOf('--mapping');
  const mappingPath = mappingIdx >= 0 ? args[mappingIdx + 1] : MAPPING_DEFAULT;
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    console.log(`   Database: ${DB_NAME}`);
    if (args.includes('--report')) await runReport(db, mappingPath);
    else if (args.includes('--apply')) await runApply(db, mappingPath);
    else if (args.includes('--verify')) await runVerify(db);
    else console.log('   Usage: --report | --apply --mapping <file> | --verify');
  } finally {
    await client.close();
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });

module.exports = { buildReport, resolveIdsForEvent };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest __tests__/unit/scripts/categoryBackfill.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/migrate-backfill-category-ids.js backend/__tests__/unit/scripts/categoryBackfill.test.js
git commit -m "feat(categories): add two-step categoryIds backfill script with coverage assertion"
```

---

### Task 3: Git-ignore the mapping artifact

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Append the ignore rule**

Add to `.gitignore`:

```
# One-time category migration mapping (operational artifact, may contain site-specific names)
backend/category-mapping.json
```

- [ ] **Step 2: Verify it is ignored**

Run: `printf '[]' > backend/category-mapping.json && git status --porcelain backend/category-mapping.json`
Expected: no output (ignored). Then `rm backend/category-mapping.json`.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore(categories): git-ignore category-mapping.json migration artifact"
```

---

## Phase 2 — Dual-write

### Task 4: Wire `resolveCategoryIds` into the runtime + graph upsert

**Files:**
- Modify: `backend/api-server.js` (add server wrapper near `getCachedCategories`, ~line 503; set `categoryIds` in `upsertUnifiedEvent` calendarData, ~line 4831)
- Test: `backend/__tests__/integration/events/categoryFilterRepro.test.js` (new describe block)

- [ ] **Step 1: Add the server-side wrapper after `invalidateCategoryCache` (api-server.js ~508)**

```js
const { buildNormalizedCategoryMap, resolveCategoryIds: _resolveCategoryIds } = require('./utils/categoryResolver');

/**
 * Resolve category name strings to ObjectIds using the cached category map,
 * auto-creating any missing records (holds the "every category maps" invariant).
 */
async function resolveCategoryIdsForNames(names) {
  if (!Array.isArray(names) || names.length === 0) return [];
  const cache = await getCachedCategories();
  const normMap = buildNormalizedCategoryMap(cache);
  const { ids, created } = await _resolveCategoryIds(names, { normMap, categoriesCollection });
  if (created > 0) invalidateCategoryCache();
  return ids;
}
```

- [ ] **Step 2: In `upsertUnifiedEvent`, set `categoryIds` in calendarData (api-server.js ~4831)**

Immediately before `unifiedEvent.calendarData = { ... }` is assigned (after `unifiedEvent.categories` is set at ~4816), add:

```js
    // Stable category references (mirrors calendarData.locations). Names remain
    // the denormalized display value; ids are authoritative for filtering.
    unifiedEvent.categoryIds = await resolveCategoryIdsForNames(unifiedEvent.categories);
```

Then inside the `unifiedEvent.calendarData = { ... }` object literal, add the line after `categories: unifiedEvent.categories,`:

```js
      categoryIds: unifiedEvent.categoryIds,
```

Also make `categoryIds` visible to the read/SSE projections so it round-trips:

- `EVENT_LIST_PROJECTION` (~api-server.js:2457) — after `'calendarData.categories': 1,` add:
  ```js
  'calendarData.categoryIds': 1,
  ```
- `projectEventForSSE` (~api-server.js:5837) — after `categories: cd.categories,` add:
  ```js
      categoryIds: cd.categoryIds,
  ```

> **Verified non-issue (architecture review P1):** `bulkUpsertEvents` (~4947-5132)
> is a second Graph-sync path, but it builds a FLAT document with no `calendarData`
> object at all and uses `upsert: false` (refresh-only). It never writes
> `calendarData.categories`/`categoryIds`, so it needs NO change here. New Graph
> events are created via `upsertUnifiedEvent` (covered above). Do not re-flag this.

- [ ] **Step 3: Write the failing test (graph-synced event gets categoryIds)**

Add to `categoryFilterRepro.test.js` a new describe block. Since `upsertUnifiedEvent` is internal, this test asserts at the data level via a direct insert path is not possible — instead assert the resolver wrapper behavior through the search filter (covered in Task 6). For Task 4, add a focused unit-style assertion using the resolver against a seeded category:

```js
// in categoryFilterRepro.test.js
describe('categoryIds dual-write (CI-1)', () => {
  it('CI-1: resolver auto-creates a category and returns an id for an unregistered name', async () => {
    const { buildNormalizedCategoryMap, resolveCategoryIds } = require('../../../utils/categoryResolver');
    const cats = db.collection(COLLECTIONS.CATEGORIES);
    await cats.deleteMany({});
    const cache = new Map((await cats.find({}).toArray()).map(c => [c.name, c]));
    const normMap = buildNormalizedCategoryMap(cache);
    const { ids, created } = await resolveCategoryIds(['Skirball'], { normMap, categoriesCollection: cats });
    expect(created).toBe(1);
    expect(ids).toHaveLength(1);
    const doc = await cats.findOne({ _id: ids[0] });
    expect(doc).toMatchObject({ name: 'Skirball', autoCreated: true });
  });
});
```

- [ ] **Step 4: Run the test**

Run: `cd backend && npx jest __tests__/integration/events/categoryFilterRepro.test.js -t "CI-1"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/api-server.js backend/__tests__/integration/events/categoryFilterRepro.test.js
git commit -m "feat(categories): dual-write categoryIds on graph-sync upsert via resolver"
```

---

### Task 5: Dual-write at the remaining entry points

**Files:**
- Modify: `backend/api-server.js` (event request/create, admin save, draft submit, audit-update — the paths that build `calendarData` from form/CSV input)
- Modify: `backend/reconcile-rsched-source-of-truth.js` (315/327) — but this is a standalone script; apply the same inline resolve there.

> **Note for implementer:** The authoritative entry points that construct `calendarData.categories` from request/CSV input are where `categoryIds` must be added. Search them: `cd backend && grep -n "'calendarData.categories':\|categories: cd.categories\|categories: unifiedEvent.categories" api-server.js`. For EACH write that SETS `calendarData.categories` from user/import input (NOT read projections, NOT the filter, NOT graphData), add a sibling `calendarData.categoryIds`.

- [ ] **Step 1: Write the failing integration test (a requester-created event is filterable by id)**

```js
// categoryFilterRepro.test.js
describe('categoryIds dual-write on create (CI-2)', () => {
  it('CI-2: an event created with a category name is later matchable by that category id', async () => {
    // Seed a registered category
    const cats = db.collection(COLLECTIONS.CATEGORIES);
    await cats.deleteMany({});
    const { insertedId } = await cats.insertOne({ name: 'Adult Ed', color: '#111', displayOrder: 1, active: true, createdAt: new Date() });

    // Insert an event whose calendarData.categories has the name but NO categoryIds yet
    const ev = createPublishedEvent({ eventTitle: 'Class', categories: ['Adult Ed'] });
    ev.calendarData.startDateTime = '2026-05-26T10:00:00';
    ev.calendarData.endDateTime = '2026-05-26T11:00:00';
    delete ev.calendarData.categoryIds;
    await insertEvents(db, [ev]);

    // Filter by id should still find it via the name-fallback (Task 6), and by name
    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&categoryIds=${insertedId}&categories=Adult%20Ed&categoryCount=10&startDate=2026-05-26&endDate=2026-06-01`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    const titles = res.body.events.map(e => e.calendarData?.eventTitle);
    expect(titles).toContain('Class');
  });
});
```

- [ ] **Step 2: Run the test (expect fail until Task 6 filter exists)**

Run: `cd backend && npx jest __tests__/integration/events/categoryFilterRepro.test.js -t "CI-2"`
Expected: FAIL (filter does not yet read `categoryIds`/fallback). This test is finished by Task 6 — leave it failing and proceed; it is the driver for Task 6.

- [ ] **Step 3: Add dual-write to each create/save entry point**

For each user/import-input write site found in the grep, after the line that sets `calendarData.categories` (or builds the calendarData object), add the resolved ids. Pattern (apply at every such site):

```js
// after categories are known (e.g., `const cats = req.body.categories || []`)
const categoryIds = await resolveCategoryIdsForNames(cats);
// ...then include in the $set / insert:
'calendarData.categoryIds': categoryIds,   // for $set updates
// or
categoryIds,                               // inside a calendarData object literal
```

In `reconcile-rsched-source-of-truth.js` (standalone — inline, do NOT import server utils): after line 327 (`'calendarData.categories': csvRow.categories || []`), the script cannot call the server resolver. Leave categoryIds unset here; the backfill (`--apply`) covers reconcile-written events. Add a comment noting this.

> **Known gap (architecture review P2) — CSV import upload endpoint (~api-server.js:11860-11870):**
> This legacy streaming bulk-import path sets `calendarData.categories` via the
> `transformedEvent` spread and a `preserveEnrichments` branch. It is a high-volume
> loop, so wiring the resolver inline risks the same cache-stampede concern as
> delta sync. **Decision:** do NOT dual-write here; treat it as covered by the
> backfill. Add a code comment at line ~11869 instructing operators to re-run
> `node migrate-backfill-category-ids.js --apply --mapping category-mapping.json`
> after any bulk CSV import. `--verify` will surface any residual gap.

- [ ] **Step 4: Run the focused suite**

Run: `cd backend && npx jest __tests__/integration/events/categoryFilterRepro.test.js`
Expected: CI-1 PASS; CI-2 still FAIL until Task 6 (documented).

- [ ] **Step 5: Commit**

```bash
git add backend/api-server.js backend/reconcile-rsched-source-of-truth.js backend/__tests__/integration/events/categoryFilterRepro.test.js
git commit -m "feat(categories): dual-write categoryIds at create/save entry points"
```

---

## Phase 3 — Filter rewire

### Task 6: Backend search filter accepts `categoryIds` (id-match + transitional name-fallback)

**Files:**
- Modify: `backend/api-server.js` (`/api/events/list` category filter block, ~7527-7562; add `categoryIds` to query destructuring ~7311)
- Test: `backend/__tests__/integration/events/categoryFilterRepro.test.js`

- [ ] **Step 1: Add `categoryIds` to the destructured query params (api-server.js ~7311)**

In the `const { view, status, ... categoryCount, locationCount } = req.query;` block, add:

```js
      categoryIds = '',
```

- [ ] **Step 2: Replace the category filter block (api-server.js ~7530-7562)**

```js
    // ── Category filter ──
    // calendarData.categoryIds is authoritative (stable refs). During rollout,
    // also OR a name-match fallback on calendarData.categories for events not yet
    // backfilled. 'Uncategorized' = no categoryIds and no names.
    if (categories || categoryIds) {
      const nameList = categories.split(',').map(c => c.trim()).filter(Boolean);
      const idList = categoryIds.split(',').map(s => s.trim()).filter(Boolean);
      const totalCategoryCount = parseInt(categoryCount) || 0;
      const isAllSelected = totalCategoryCount > 0 && nameList.length >= totalCategoryCount;

      if (!isAllSelected && (nameList.length > 0 || idList.length > 0)) {
        const categoryConditions = [];

        if (nameList.includes('Uncategorized')) {
          categoryConditions.push(
            { 'calendarData.categories': { $exists: false } },
            { 'calendarData.categories': { $size: 0 } },
            { 'calendarData.categories': null }
          );
        }

        const objectIds = idList
          .filter(id => ObjectId.isValid(id))
          .map(id => new ObjectId(id));
        if (objectIds.length > 0) {
          categoryConditions.push({ 'calendarData.categoryIds': { $in: objectIds } });
        }

        const actualNames = nameList.filter(c => c !== 'Uncategorized');
        if (actualNames.length > 0) {
          // Transitional name fallback for events not yet backfilled (Phase 5 removes this).
          categoryConditions.push({ 'calendarData.categories': { $in: actualNames } });
        }

        if (categoryConditions.length > 0) {
          if (query.$and) {
            query.$and.push({ $or: categoryConditions });
          } else if (query.$or) {
            query.$and = [{ $or: query.$or }, { $or: categoryConditions }];
            delete query.$or;
          } else {
            query.$or = categoryConditions;
          }
        }
      }
    }
```

- [ ] **Step 3: Run the existing + new tests**

Run: `cd backend && npx jest __tests__/integration/events/categoryFilterRepro.test.js`
Expected: CF-1..CF-5 PASS (unchanged behavior via name fallback), CI-2 now PASS (id param accepted, fallback matches).

- [ ] **Step 4: Add an id-only match test (no name sent)**

```js
// categoryFilterRepro.test.js
describe('categoryIds id-only match (CI-3)', () => {
  it('CI-3: matches by categoryId alone (no name param) when event has categoryIds', async () => {
    const cats = db.collection(COLLECTIONS.CATEGORIES);
    await cats.deleteMany({});
    const { insertedId } = await cats.insertOne({ name: 'Skirball', displayOrder: 1, active: true, createdAt: new Date() });
    const ev = createPublishedEvent({ eventTitle: 'Intro to Judaism', categories: ['Skirball'] });
    ev.calendarData.startDateTime = '2026-05-26T18:30:00';
    ev.calendarData.endDateTime = '2026-05-26T20:30:00';
    ev.calendarData.categoryIds = [insertedId];
    await insertEvents(db, [ev]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&categoryIds=${insertedId}&categoryCount=10&startDate=2026-05-26&endDate=2026-06-01`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.events.map(e => e.calendarData?.eventTitle)).toContain('Intro to Judaism');
  });
});
```

Run: `cd backend && npx jest __tests__/integration/events/categoryFilterRepro.test.js -t "CI-3"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/api-server.js backend/__tests__/integration/events/categoryFilterRepro.test.js
git commit -m "feat(categories): search filter matches categoryIds with transitional name fallback"
```

---

### Task 7: `mcpTools.js` filter predicate

**Files:**
- Modify: `backend/services/mcpTools.js:24`

- [ ] **Step 1: Inspect the current predicate**

Run: `cd backend && sed -n '15,35p' services/mcpTools.js`
Expected: shows `{ 'calendarData.categories': { $in: categoryRegexes } }`.

- [ ] **Step 2: Add an id branch (keep name regex as fallback)**

Replace the single category condition with an `$or` that also accepts ids when the caller resolved them. If `mcpTools` only has names available, leave the name regex but add a comment that id-matching belongs here once the MCP layer passes ids. Minimal change — add ids only if the surrounding function receives them:

```js
// services/mcpTools.js — within the existing query build
const categoryClause = categoryObjectIds && categoryObjectIds.length
  ? { $or: [
      { 'calendarData.categoryIds': { $in: categoryObjectIds } },
      { 'calendarData.categories': { $in: categoryRegexes } },
    ] }
  : { 'calendarData.categories': { $in: categoryRegexes } };
// ...use categoryClause where the old condition was
```

If `categoryObjectIds` is not available in this scope, keep the name-only clause and add: `// TODO(phase5): pass resolved categoryObjectIds when MCP category filtering moves to ids`. (This is acceptable — MCP search is name-based today and the name path still works.)

- [ ] **Step 3: Run the MCP tools tests if present**

Run: `cd backend && npx jest services/mcpTools 2>/dev/null || echo "no direct mcpTools test — verify by lint"`
Expected: PASS or no-test notice.

- [ ] **Step 4: Commit**

```bash
git add backend/services/mcpTools.js
git commit -m "feat(categories): accept categoryIds in mcpTools category filter"
```

---

### Task 8: Frontend — map selected names → ids, send `categoryIds`

**Files:**
- Modify: `src/utils/eventTransformers.js` (add `categoryIds` passthrough — the "2 places" rule)
- Modify: `src/components/EventSearch.jsx` (`searchEvents` params ~77-91; build name→id map from `baseCategories`; pass ids)
- Modify: `src/components/EventSearchExport.jsx` (`fetchAllMatchingEvents` params ~64-78)
- Test: `src/__tests__/unit/components/EventSearch.categoryIds.test.jsx`

- [ ] **Step 0: Add `categoryIds` to the centralized transform (architecture review P2)**

Per CLAUDE.md, `transformEventToFlatStructure` is the single read transform; new
fields must be added here. After the `const categories = getEventField(...)` block
(~line 283), add:

```js
  const categoryIds = getEventField(event, 'categoryIds', []);
```

Then in the returned object (after `categories,` / `mecCategories: categories,` ~line 372), add:

```js
    categoryIds,
```

- [ ] **Step 1: Write the failing frontend test (mapping helper)**

Extract a pure mapper so it is testable without rendering. Add to `EventSearch.jsx` and export it:

```js
// src/components/EventSearch.jsx (top-level, exported)
// Map selected category NAMES to ObjectId strings using the registered category
// list. Names with no registered match are omitted from ids (the backend name
// fallback still matches them during rollout). 'Uncategorized' is never an id.
export function selectedNamesToCategoryIds(selectedNames, baseCategories) {
  const byName = new Map((baseCategories || []).filter(c => c && c.name).map(c => [c.name.trim().toLowerCase(), c._id]));
  return (selectedNames || [])
    .filter(n => n && n !== 'Uncategorized')
    .map(n => byName.get(n.trim().toLowerCase()))
    .filter(Boolean)
    .map(String);
}
```

```jsx
// src/__tests__/unit/components/EventSearch.categoryIds.test.jsx
import { describe, it, expect } from 'vitest';
import { selectedNamesToCategoryIds } from '../../../components/EventSearch';

describe('selectedNamesToCategoryIds', () => {
  const base = [{ _id: 'a1', name: 'Skirball' }, { _id: 'b2', name: 'Adult Ed' }];
  it('maps names case-insensitively to id strings', () => {
    expect(selectedNamesToCategoryIds(['skirball ', 'Adult Ed'], base)).toEqual(['a1', 'b2']);
  });
  it('omits Uncategorized and unregistered names', () => {
    expect(selectedNamesToCategoryIds(['Uncategorized', 'Unknown'], base)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/unit/components/EventSearch.categoryIds.test.jsx`
Expected: FAIL — `selectedNamesToCategoryIds` not exported.

- [ ] **Step 3: Implement — add the export (Step 1 code) and send ids**

In `searchEvents` params (after the categories block ~78-83), add a `categoryIds` argument and append it:

```js
    if (categoryIds && categoryIds.length > 0) {
      params.append('categoryIds', categoryIds.join(','));
    }
```

Update the `searchEvents` signature to accept `categoryIds = []` and pass it from both call sites (initial query ~389 and `loadMoreResults` ~526) by computing:

```js
      const categoryIds = selectedNamesToCategoryIds(effectiveCategories, baseCategories);
```

(`baseCategories` is already a prop of `EventSearch`.) Mirror the same `categoryIds` param addition in `EventSearchExport.fetchAllMatchingEvents` — it receives `allCategoryOptions`/`categories`; pass `baseCategories` as a new prop from `EventSearch` (line ~810 where `<EventSearchExport ...>` is rendered) and compute ids the same way.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/unit/components/EventSearch.categoryIds.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/eventTransformers.js src/components/EventSearch.jsx src/components/EventSearchExport.jsx src/__tests__/unit/components/EventSearch.categoryIds.test.jsx
git commit -m "feat(categories): send resolved categoryIds from search + export filters"
```

---

## Phase 4 — Rename propagation

### Task 9: Propagate category rename to event display names

**Files:**
- Modify: `backend/api-server.js` (`PUT /api/categories/:id`, ~19081-19142)
- Test: `backend/__tests__/integration/events/categoryFilterRepro.test.js`

- [ ] **Step 1: Write the failing test (rename → old-tagged events return under new name)**

```js
// categoryFilterRepro.test.js — needs an admin token; add one in beforeEach if not present.
describe('category rename propagation (CR-1)', () => {
  it('CR-1: after rename, events keep the id link and display the new name', async () => {
    const cats = db.collection(COLLECTIONS.CATEGORIES);
    await cats.deleteMany({});
    const { insertedId } = await cats.insertOne({ name: 'Skirball', displayOrder: 1, active: true, createdAt: new Date() });
    const ev = createPublishedEvent({ eventTitle: 'Intro to Judaism', categories: ['Skirball'] });
    ev.calendarData.startDateTime = '2026-05-26T18:30:00';
    ev.calendarData.endDateTime = '2026-05-26T20:30:00';
    ev.calendarData.categoryIds = [insertedId];
    await insertEvents(db, [ev]);

    // Rename via the admin endpoint
    const res = await request(app)
      .put(`/api/categories/${insertedId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Skirball Center' });
    expect(res.status).toBe(200);

    const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ 'calendarData.eventTitle': 'Intro to Judaism' });
    expect(updated.calendarData.categories).toContain('Skirball Center');
    expect(updated.calendarData.categories).not.toContain('Skirball');
    expect(updated.calendarData.categoryIds.map(String)).toContain(String(insertedId));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest __tests__/integration/events/categoryFilterRepro.test.js -t "CR-1"`
Expected: FAIL — `categories` still contains 'Skirball'.

- [ ] **Step 3: Add propagation to `PUT /api/categories/:id`**

Before `findOneAndUpdate`, capture the old name; after a successful name change, replace the old display string on all events that reference this id.

> **Cosmos DB constraint (architecture review P1):** Do NOT use the positional
> `$[elem]` operator with `arrayFilters` — Azure Cosmos DB's Mongo API does not
> support `arrayFilters` (zero uses exist in this codebase), and it would silently
> no-op, leaving stale display strings while returning 200. Use the supported
> two-call `$pull` + `$addToSet` pattern instead. It is non-atomic across documents
> but idempotent, and rename is an admin-only, low-frequency action.

Capture the old name (place near the top of the handler):

```js
    // Capture old name to propagate a rename to denormalized event display strings.
    const before = await categoriesCollection.findOne({ _id: new ObjectId(id) });
```

After `invalidateCategoryCache();` and the `if (!result)` guard:

```js
    // Rename propagation: refresh the denormalized calendarData.categories display
    // strings on every event that references this category by its stable id.
    // Cosmos-safe: $pull old name, then $addToSet new name (no arrayFilters).
    if (before && name && before.name !== updateData.name) {
      const catObjectId = new ObjectId(id);
      await withCosmosRetry(() => unifiedEventsCollection.updateMany(
        { 'calendarData.categoryIds': catObjectId, 'calendarData.categories': before.name },
        { $pull: { 'calendarData.categories': before.name } }
      ));
      await withCosmosRetry(() => unifiedEventsCollection.updateMany(
        { 'calendarData.categoryIds': catObjectId },
        { $addToSet: { 'calendarData.categories': updateData.name } }
      ));
    }
```

Note: `$addToSet` may reorder the renamed category to the end of the display array.
That is acceptable — display order of categories on an event is not significant.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest __tests__/integration/events/categoryFilterRepro.test.js -t "CR-1"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/api-server.js backend/__tests__/integration/events/categoryFilterRepro.test.js
git commit -m "feat(categories): propagate category rename to event display names via id"
```

---

## Phase 5 — Cleanup (deferred; do NOT run until backfill verified in production)

These are intentionally deferred until `--verify` shows full coverage in production. Listed for completeness, not for execution in this pass:

- [ ] Remove the transitional name-fallback from the search filter (Task 6) and `mcpTools.js`, leaving id-only matching.
- [ ] Simplify the dropdown to source from `templeEvents__Categories` only; remove the uncommitted `useDistinctEventCategoriesQuery` union in `EventSearch.jsx` / `useCategoriesQuery.js` / `keys.js`.
- [ ] Optionally reconcile stray top-level `categories` / `graphData.categories` divergence.

**Final-review follow-ups (surfaced 2026-05-26, deferred — not merge-blocking):**
- [ ] **Race-safe auto-create:** add a unique index on a normalized category-name field and switch the resolver insert to `findOneAndUpdate({...}, { $setOnInsert }, { upsert: true })`. Closes the concurrent-insert phantom-duplicate window.
- [ ] **Graph-category divergence:** `upsertUnifiedEvent` overwrites `calendarData.categories` from `graphEvent.categories` on every delta sync. Since our category rename is NOT pushed to Outlook, a delta sync of a renamed-category event re-introduces the old Graph name AND auto-creates a phantom record for it. Decide ownership: either push category renames to Graph, or stop overwriting `calendarData.categories` for events with app-managed `categoryIds`. (Pre-existing delta-overwrite behavior; the migration surfaces it via auto-create.)
- [ ] **Reservation/publish write coverage:** `buildEventFields` (`backend/utils/eventFieldBuilder.js`) and `PUT /api/admin/events/:id/publish` write `calendarData.categories` without `categoryIds`. Cleanest fix: resolve `categoryIds` inside a shared write layer. Until then, covered by backfill `--apply` + name-fallback. Add the CSV-style operator comment to these sites.
- [ ] **SSE on rename:** emit `event-updated` (or targeted invalidation) after rename propagation so clients refresh the renamed display name before the 30-min category stale-time.

---

## Self-Review

**Spec coverage:**
- Data model (`categoryIds` additive) → Tasks 4, 5 ✓
- Reconciliation report/confirm/apply + 100% assertion → Task 2 ✓
- Runtime auto-create-on-miss → Tasks 1, 4 ✓
- Filter id-match + transitional name-fallback → Tasks 6, 7 ✓
- Frontend name→id → Task 8 ✓
- Rename propagation → Task 9 ✓
- Git-ignore mapping → Task 3 ✓
- Cleanup deferred → Phase 5 ✓

**Type consistency:** Server wrapper is `resolveCategoryIdsForNames` (api-server) wrapping util `resolveCategoryIds`; frontend mapper `selectedNamesToCategoryIds`; script exports `buildReport`/`resolveIdsForEvent`. Field name `calendarData.categoryIds` used consistently throughout.

**Open verification dependency:** Task 5 CI-2 is written to fail until Task 6 lands (documented in Task 5 Step 2). Task 9 requires an `adminToken` in the test file's `beforeEach` — add one (createAdmin + createMockToken) if not already present.

**Architecture review incorporated (2026-05-26):**
- P1 — Task 9 uses Cosmos-safe `$pull` + `$addToSet` (NOT `arrayFilters`, which Cosmos silently no-ops).
- P1 — `bulkUpsertEvents` verified to write no `calendarData`; annotated as no-change in Task 4.
- P2 — `categoryIds` added to `transformEventToFlatStructure` (Task 8 Step 0), `EVENT_LIST_PROJECTION` + `projectEventForSSE` (Task 4).
- P2 — backfill coverage assertion rewritten without `$expr`/`$size`-aggregation (Cosmos-safe `$elemMatch` + `$size: 0`).
- P2 — CSV-import endpoint (~11860) documented as backfill-covered (Task 5); runtime auto-create race documented with a Phase 5 unique-index follow-up (Task 1).
