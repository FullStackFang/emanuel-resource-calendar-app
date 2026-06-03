/**
 * Reconcile event category names after a category was renamed.
 *
 * When a category is renamed in templeEvents__Categories, events that reference
 * it only by NAME (no calendarData.categoryIds — e.g. rsched imports) keep the
 * OLD name and look disconnected on the calendar. The PUT /api/categories/:id
 * cascade now repairs this going forward, but events stranded by a rename that
 * already happened can't self-heal: they carry a name that no longer matches any
 * category and have no id to match on. This script repairs them.
 *
 * For each old->new mapping it:
 *   1. resolves the NEW name to its current category _id,
 *   2. rewrites the old name -> new name in calendarData.categories (the field
 *      the calendar displays), plus top-level categories and graphData.categories
 *      so no copy disagrees and a re-derive can't revert it,
 *   3. stamps calendarData.categoryIds with the stable id, so any FUTURE rename
 *      propagates automatically (matched by id, not name).
 *
 * Isolated: requires only mongodb + dotenv. Never loads server code.
 * Idempotent: re-running is a no-op once events carry the new name — safe to
 * resume after a crash / rate-limit abort.
 *
 * Cosmos-safe: writes go out in small chunks, paced, with a bounded retry that
 * honors the 429 RetryAfterMs hint (Error 16500). Tune WRITE_CHUNK / WRITE_PACE_MS
 * down if you still see 429s on a low-RU container.
 *
 *   node migrate-reconcile-renamed-categories.js --dry-run   # preview, no writes
 *   node migrate-reconcile-renamed-categories.js             # apply
 *   node migrate-reconcile-renamed-categories.js --verify    # count remaining
 */

const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const EVENTS = 'templeEvents__Events';
const CATEGORIES = 'templeEvents__Categories';

const WRITE_CHUNK = 15;      // ops per bulkWrite — keep RU bursts small for Cosmos
const WRITE_PACE_MS = 250;   // delay between write chunks
const MAX_RETRY = 12;        // bounded — never loops forever on persistent failure

// old name (as stored on events) -> new/current category name (in templeEvents__Categories).
// Names can contain apostrophes, so these are double-quoted JS strings. Add more
// pairs here if other categories were renamed before the cascade fix shipped.
const RENAME_MAP = {
  "Bar/Bas Mitzvah": "B'nei Mitzvah",
};

const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY = process.argv.includes('--verify');

let retryCount = 0;

/**
 * Run a Cosmos op with bounded backoff on 429 (Error 16500). Honors the
 * RetryAfterMs hint in the error message, floored by exponential backoff + jitter.
 * Bounded by MAX_RETRY so a persistent failure surfaces instead of looping.
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

/** Replace every occurrence of oldName with newName in an array, de-duplicating. */
function replaceInArray(arr, oldName, newName) {
  if (!Array.isArray(arr)) return { changed: false, next: arr };
  let changed = false;
  const next = [];
  for (const v of arr) {
    const mapped = v === oldName ? newName : v;
    if (v === oldName) changed = true;
    if (!next.includes(mapped)) next.push(mapped);
  }
  return { changed, next };
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const events = db.collection(EVENTS);
  const categories = db.collection(CATEGORIES);

  const mode = VERIFY ? 'verify' : DRY_RUN ? 'dry-run' : 'apply';
  console.log(`Reconcile renamed categories | DB=${DB_NAME} | mode=${mode} | chunk=${WRITE_CHUNK} pace=${WRITE_PACE_MS}ms`);

  // Resolve each NEW name to its current category _id.
  const resolved = [];
  for (const [oldName, newName] of Object.entries(RENAME_MAP)) {
    const cat = await withCosmosRetry(() => categories.findOne({ name: newName }));
    if (!cat) {
      console.log(`  ! skip "${oldName}" -> "${newName}": no category named "${newName}"`);
      continue;
    }
    resolved.push({ oldName, newName, categoryId: cat._id });
    console.log(`  map "${oldName}" -> "${newName}" (${cat._id})`);

    // Seed the old name as an alias on the renamed category so external sources
    // that still export it (rsched CSV) resolve here instead of duplicating.
    // The rename happened before alias-recording existed, so seed it now.
    // Idempotent ($addToSet); skipped in dry-run/verify.
    if (!DRY_RUN && !VERIFY) {
      await withCosmosRetry(() => categories.updateOne(
        { _id: cat._id },
        { $addToSet: { aliases: oldName } }
      ));
    } else if (DRY_RUN) {
      console.log(`    [dry-run] would add alias "${oldName}" to category ${cat._id}`);
    }
  }

  let totalUpdated = 0;

  for (const { oldName, newName, categoryId } of resolved) {
    const query = { $or: [
      { 'calendarData.categories': oldName },
      { categories: oldName },
      { 'graphData.categories': oldName },
    ] };

    const before = await withCosmosRetry(() => events.countDocuments(query));
    console.log(`\n"${oldName}": ${before} event(s) still carry the old name`);

    if (VERIFY || before === 0) continue;

    const docs = await withCosmosRetry(() => events.find(query).project({
      _id: 1,
      categories: 1,
      'calendarData.categories': 1,
      'calendarData.categoryIds': 1,
      'graphData.categories': 1,
    }).toArray());

    // Build the update ops (in memory) so writes can be chunked/paced.
    const ops = [];
    for (const d of docs) {
      const cd = d.calendarData || {};
      const set = {};

      const cdCats = replaceInArray(cd.categories, oldName, newName);
      if (cdCats.changed) set['calendarData.categories'] = cdCats.next;

      const topCats = replaceInArray(d.categories, oldName, newName);
      if (topCats.changed) set['categories'] = topCats.next;

      const gdCats = replaceInArray(d.graphData && d.graphData.categories, oldName, newName);
      if (gdCats.changed) set['graphData.categories'] = gdCats.next;

      const existingIds = (cd.categoryIds || []).map(String);
      if (!existingIds.includes(String(categoryId))) {
        set['calendarData.categoryIds'] = [...(cd.categoryIds || []), categoryId];
      }

      if (DRY_RUN) {
        console.log(`    [dry-run] ${d._id}: ${JSON.stringify(cd.categories)} -> ${JSON.stringify(cdCats.next)}` +
          (set['calendarData.categoryIds'] ? ` (+id ${categoryId})` : ''));
      } else if (Object.keys(set).length) {
        ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: set } } });
      }
    }

    if (DRY_RUN) continue;

    // Write in small, paced chunks; each chunk retries on 429 (idempotent re-apply).
    let written = 0;
    for (let i = 0; i < ops.length; i += WRITE_CHUNK) {
      const chunk = ops.slice(i, i + WRITE_CHUNK);
      await withCosmosRetry(() => events.bulkWrite(chunk, { ordered: false }));
      written += chunk.length;
      const pct = Math.round((written / ops.length) * 100);
      process.stdout.write(`\r   [Progress] ${pct}% (${written}/${ops.length}) | ${retryCount} retr${retryCount === 1 ? 'y' : 'ies'}   `);
      if (i + WRITE_CHUNK < ops.length) await new Promise(r => setTimeout(r, WRITE_PACE_MS));
    }
    process.stdout.write('\n');

    const after = await withCosmosRetry(() => events.countDocuments(query));
    console.log(`   updated ${before - after}/${before}, ${after} remaining`);
    totalUpdated += before - after;
  }

  if (!VERIFY && !DRY_RUN) console.log(`\nDone. ${totalUpdated} event(s) reconciled (${retryCount} rate-limit retries).`);
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
