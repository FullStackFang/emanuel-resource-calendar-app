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
 *
 * Cosmos-safe: every operation is wrapped in a bounded retry that honors the 429
 * RetryAfterMs hint (Error 16500). The in-use-name scan is a single paged read
 * (not distinct() + N countDocuments, which spikes RU). Writes go out in small,
 * paced chunks. Tune WRITE_CHUNK / WRITE_PACE_MS down if 429s persist on a
 * low-RU container.
 */
const fs = require('fs');
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const EVENTS = 'templeEvents__Events';
const CATEGORIES = 'templeEvents__Categories';
const WRITE_CHUNK = 25;      // ops per bulkWrite — keep RU bursts small for Cosmos
const WRITE_PACE_MS = 250;   // delay between write chunks
const MAX_RETRY = 12;        // bounded — never loops forever on persistent failure
const MAPPING_DEFAULT = 'category-mapping.json';

const norm = (s) => (s || '').trim().toLowerCase();

let retryCount = 0;

/**
 * Run a Cosmos op with bounded backoff on 429 (Error 16500). Honors the
 * RetryAfterMs hint, floored by exponential backoff + jitter. Bounded by
 * MAX_RETRY so a persistent failure surfaces instead of looping.
 */
async function withCosmosRetry(fn) {
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = (err && err.message) || '';
      const is429 = (err && err.code === 16500) || /TooManyRequests|429|Request rate is large/i.test(msg);
      if (!is429 || attempt === MAX_RETRY) throw err;
      retryCount++;
      const hinted = /RetryAfterMs=(\d+)/.exec(msg);
      const suggested = hinted ? parseInt(hinted[1], 10) : 0;
      const backoff = Math.min(10000, 250 * 2 ** (attempt - 1));
      const wait = Math.max(suggested, backoff) + Math.floor(Math.random() * 250);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

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

/**
 * Scan all events once and load { _id, calendarData.categories } projected docs.
 * Single retryable read instead of distinct() + per-name countDocuments (both of
 * which spike RU and were the original 429 source). Shared by report + apply.
 */
async function loadEventCategoryDocs(db) {
  return withCosmosRetry(() =>
    db.collection(EVENTS).find({}, { projection: { _id: 1, 'calendarData.categories': 1 } }).toArray()
  );
}

/** Tally distinct in-use category names with counts from the scanned docs (in JS). */
function tallyDistinct(docs) {
  const counts = new Map();
  for (const d of docs) {
    for (const name of d.calendarData?.categories || []) {
      if (name == null) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

async function runReport(db, mappingPath) {
  const docs = await loadEventCategoryDocs(db);
  const distinct = tallyDistinct(docs);
  const existing = await withCosmosRetry(() => db.collection(CATEGORIES).find({}).toArray());
  const report = buildReport(distinct, existing);
  fs.writeFileSync(mappingPath, JSON.stringify(report, null, 2));
  const news = report.filter(r => r.action === 'create');
  console.log(`\n   Scanned ${docs.length} events. Distinct in-use names: ${distinct.length}`);
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
  const maxOrderDoc = await withCosmosRetry(() =>
    db.collection(CATEGORIES).find({}).sort({ displayOrder: -1 }).limit(1).toArray());
  let maxOrder = maxOrderDoc[0]?.displayOrder || 0;
  const mappingByNorm = new Map();
  const existing = await withCosmosRetry(() => db.collection(CATEGORIES).find({}).toArray());
  for (const c of existing) mappingByNorm.set(norm(c.name), c._id);

  let createdCount = 0;
  for (const row of report) {
    if (row.action === 'create') {
      maxOrder += 1;
      const res = await withCosmosRetry(() => db.collection(CATEGORIES).insertOne({
        name: row.newName, type: 'base', color: '#808080', description: '',
        displayOrder: maxOrder, allowedConcurrentCategories: [], active: true,
        autoCreated: true, createdAt: new Date(), updatedAt: new Date(),
      }));
      mappingByNorm.set(norm(row.newName), res.insertedId);
      createdCount += 1;
    } else if (row.action === 'map') {
      mappingByNorm.set(norm(row.name), new ObjectId(row.targetId));
    }
  }
  console.log(`\n   Created ${createdCount} new category records.`);

  // 2. Backfill categoryIds in small, paced, retryable chunks.
  const docs = await loadEventCategoryDocs(db);
  console.log(`   Backfilling ${docs.length} events in chunks of ${WRITE_CHUNK}...`);
  for (let i = 0; i < docs.length; i += WRITE_CHUNK) {
    const chunk = docs.slice(i, i + WRITE_CHUNK);
    const ops = chunk.map(d => ({
      updateOne: {
        filter: { _id: d._id },
        update: { $set: { 'calendarData.categoryIds': resolveIdsForEvent(d.calendarData?.categories || [], mappingByNorm) } },
      },
    }));
    if (ops.length) await withCosmosRetry(() => db.collection(EVENTS).bulkWrite(ops, { ordered: false }));
    const processed = Math.min(i + WRITE_CHUNK, docs.length);
    process.stdout.write(`\r   [Progress] ${Math.round((processed / docs.length) * 100)}% (${processed}/${docs.length}) | ${retryCount} retr${retryCount === 1 ? 'y' : 'ies'}   `);
    if (i + WRITE_CHUNK < docs.length) await new Promise(r => setTimeout(r, WRITE_PACE_MS));
  }
  process.stdout.write('\n');

  // 3. Assert 100% coverage: every event with a "real" category name (not
  //    Uncategorized/empty) must have a non-empty categoryIds.
  //    Cosmos-safe: $elemMatch + $size:0 + $exists (no $expr/aggregation in find).
  const unmapped = await withCosmosRetry(() => db.collection(EVENTS).countDocuments({
    'calendarData.categories': { $elemMatch: { $nin: ['Uncategorized', ''] } },
    $or: [
      { 'calendarData.categoryIds': { $exists: false } },
      { 'calendarData.categoryIds': { $size: 0 } },
    ],
  }));
  if (unmapped > 0) {
    throw new Error(`Coverage assertion FAILED: ${unmapped} events still have categories but no categoryIds. Re-run --report and confirm all names.`);
  }
  console.log(`   Coverage assertion passed. Done (${retryCount} rate-limit retries).`);
}

async function runVerify(db) {
  const total = await withCosmosRetry(() => db.collection(EVENTS).countDocuments({}));
  const withIds = await withCosmosRetry(() => db.collection(EVENTS).countDocuments({ 'calendarData.categoryIds.0': { $exists: true } }));
  const withNamesNoIds = await withCosmosRetry(() => db.collection(EVENTS).countDocuments({
    'calendarData.categories': { $elemMatch: { $nin: ['Uncategorized', ''] } },
    $or: [
      { 'calendarData.categoryIds': { $exists: false } },
      { 'calendarData.categoryIds': { $size: 0 } },
    ],
  }));
  console.log(`\n   Total events: ${total}`);
  console.log(`   With categoryIds: ${withIds}`);
  console.log(`   With real names but NO categoryIds: ${withNamesNoIds}`);
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

module.exports = { buildReport, resolveIdsForEvent, tallyDistinct };
