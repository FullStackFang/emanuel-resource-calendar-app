/**
 * diagnose-event-indexes.js  —  READ-ONLY index coverage report for templeEvents__Events.
 *
 * Why: Azure Cosmos DB (Mongo API) rejects COMPOUND indexes on nested paths
 * ("Unique and compound indexes do not support nested paths"). Several indexes this
 * codebase declares are compound-on-nested (calendarData.* / graphData.id / ...), so
 * the LIVE index set can be far smaller than the code implies — invisibly. This script
 * prints what actually exists, flags the Cosmos-risky shapes, and reports which expected
 * indexes are missing (in particular calData_startDateTime, which fixes the Search view).
 *
 * It performs NO writes (no createIndex / dropIndex). Safe to run against production.
 *
 *   node diagnose-event-indexes.js
 */
const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION = 'templeEvents__Events';

// Expected indexes (mirror of createUnifiedEventIndexes() in api-server.js). Inlined
// deliberately so this diagnostic does not import anything the server loads.
const EXPECTED = [
  'userId_calendarId_eventId_unique',
  'userId_graphId_unique',
  'conflict_status_locations_dates',
  'userId_eventId_etag',
  'userId_isDeleted',
  'userId_sourceCalendars',
  'calendar_view_owner_dates',
  'conflict_series_masters',
  'requester_email_status',
  'exception_master_date',
  'exception_type_dates',
  'calData_startDateTime', // single-field — fixes the Search view full-scan
  'calData_endDateTime',   // single-field — overlap-query companion
];

// Indexes whose KEYS we know hold a nested path. Compound/unique forms of these are
// the ones Cosmos is known to reject in this account.
function describeIndex(idx) {
  const keys = Object.keys(idx.key || {});
  const nestedKeys = keys.filter((k) => k.includes('.'));
  const isCompound = keys.length > 1;
  const isUnique = !!idx.unique;
  const cosmosRisky = nestedKeys.length > 0 && (isCompound || isUnique);
  return { keys, nestedKeys, isCompound, isUnique, cosmosRisky };
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION);

    console.log(`\nIndex diagnostic for ${DB_NAME}.${COLLECTION}\n${'='.repeat(60)}`);

    const live = await collection.indexes();
    const liveNames = new Set(live.map((i) => i.name));

    console.log(`\nLIVE INDEXES (${live.length}):`);
    for (const idx of live) {
      const d = describeIndex(idx);
      const flags = [];
      if (idx.unique) flags.push('unique');
      if (d.cosmosRisky) flags.push('!! COSMOS-RISKY (compound/unique on nested path)');
      const keyStr = d.keys.map((k) => `${k}:${idx.key[k]}`).join(', ');
      console.log(`  - ${idx.name}`);
      console.log(`      keys: { ${keyStr} }${flags.length ? '   ' + flags.join(' ') : ''}`);
    }

    const missing = EXPECTED.filter((n) => !liveNames.has(n));
    const extra = [...liveNames].filter((n) => n !== '_id_' && !EXPECTED.includes(n));

    console.log(`\nEXPECTED-BUT-MISSING (${missing.length}):`);
    if (missing.length === 0) {
      console.log('  (none — all expected indexes are present)');
    } else {
      for (const n of missing) {
        const note = n === 'calData_startDateTime'
          ? '  <-- Search view will FULL-SCAN / throttle without this'
          : '';
        console.log(`  - ${n}${note}`);
      }
    }

    console.log(`\nPRESENT-BUT-NOT-EXPECTED (${extra.length}) — drift / obsolete:`);
    console.log(extra.length ? extra.map((n) => `  - ${n}`).join('\n') : '  (none)');

    // Headline checks
    console.log(`\n${'='.repeat(60)}\nHEADLINE:`);
    console.log(`  Search-fix index calData_startDateTime: ${liveNames.has('calData_startDateTime') ? 'PRESENT ✅' : 'MISSING ❌ (search at risk)'}`);
    const riskyLive = live.filter((i) => describeIndex(i).cosmosRisky).map((i) => i.name);
    console.log(`  Cosmos-risky live indexes (may silently be absent on a fresh account): ${riskyLive.length ? riskyLive.join(', ') : 'none'}`);
    console.log('');
  } catch (err) {
    console.error('Diagnostic failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main();
