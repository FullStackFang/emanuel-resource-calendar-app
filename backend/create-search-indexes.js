// Creates the indexes the Search view needs. The search query filters on
// status + calendarOwner + calendarData.startDateTime, but NONE of those are
// indexed (only the OLD graphData.start.dateTime is). That makes every search a
// full collection scan of ~37k docs, which trips Cosmos 429 rate limiting and
// returns empty/incomplete results ("No events found" when matches exist).
//
// Indexes created (idempotent):
//   1. { 'calendarData.startDateTime': 1 }                              — universal date-range coverage
//   2. { calendarOwner: 1, status: 1, 'calendarData.startDateTime': 1 } — optimal for owner-scoped search
//
// Usage:
//   node create-search-indexes.js --verify     # list current indexes, no changes
//   node create-search-indexes.js --dry-run    # show what would be created, no changes
//   node create-search-indexes.js              # create the indexes
//
// Notes:
//   - createIndex is idempotent (same name+spec = no-op).
//   - On Cosmos for MongoDB the build runs server-side and consumes RUs; prefer
//     off-peak or temporarily raise RU/s if the container is heavily throttled.
//   - If a path is EXCLUDED by the Cosmos index policy, createIndex will error;
//     the error is printed so you can allow the path in the Azure index policy.

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION = 'templeEvents__Events';

const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY = process.argv.includes('--verify');

const INDEXES = [
  {
    key: { 'calendarData.startDateTime': 1 },
    options: { name: 'calData_startDateTime' },
    why: 'universal date-range filter for the search view',
  },
  {
    key: { calendarOwner: 1, status: 1, 'calendarData.startDateTime': 1 },
    options: { name: 'calOwner_status_calStart' },
    why: 'owner-scoped search (calendarOwner + status equality, startDateTime range)',
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cosmos throttles aggressively; retry metadata ops with backoff.
async function withRetry(label, fn) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const retryMs = e.RetryAfterMs || e.retryAfterMs || 400 * attempt;
      const throttled = e.code === 16500 || /TooManyRequests|429/.test(e.message || '');
      if (throttled && attempt < 6) {
        console.log(`   (throttled on ${label}, attempt ${attempt}/6 — waiting ${retryMs}ms)`);
        await sleep(retryMs + 150);
        continue;
      }
      throw e;
    }
  }
}

(async () => {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const col = client.db(DB_NAME).collection(COLLECTION);

    console.log(`\nCollection: ${DB_NAME}.${COLLECTION}`);
    console.log(`Mode: ${VERIFY ? 'VERIFY' : DRY_RUN ? 'DRY-RUN' : 'CREATE'}\n`);

    const before = await withRetry('indexes', () => col.indexes());
    console.log('Current indexes:');
    for (const i of before) console.log(`   ${i.name} -> ${JSON.stringify(i.key)}`);

    if (VERIFY) {
      console.log('\n(verify only — no changes made)\n');
      return;
    }

    console.log('');
    for (const idx of INDEXES) {
      const spec = JSON.stringify(idx.key);
      const exists = before.some((b) => b.name === idx.options.name);
      if (exists) {
        console.log(`= ${idx.options.name} ${spec} — already exists, skipping`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`+ would create ${idx.options.name} ${spec}  (${idx.why})`);
        continue;
      }
      try {
        const t0 = Date.now();
        const name = await withRetry(`createIndex ${idx.options.name}`, () =>
          col.createIndex(idx.key, idx.options)
        );
        console.log(`✓ created ${name} ${spec}  (${Date.now() - t0}ms; server-side build may continue async)`);
      } catch (e) {
        console.error(`✗ FAILED ${idx.options.name} ${spec}: ${e.message}`);
        if (/excluded|index path/i.test(e.message || '')) {
          console.error('   → This path is excluded by the Cosmos index policy. Allow it in the');
          console.error('     Azure portal (Data Explorer → container → Settings → Indexing Policy),');
          console.error('     then re-run this script.');
        }
      }
    }

    if (!DRY_RUN) {
      console.log('\nIndexes after:');
      const after = await withRetry('indexes', () => col.indexes());
      for (const i of after) console.log(`   ${i.name} -> ${JSON.stringify(i.key)}`);
    }
    console.log('');
  } catch (err) {
    console.error('Index script failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
})();
