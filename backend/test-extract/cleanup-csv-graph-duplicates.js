// cleanup-csv-graph-duplicates.js
// One-time cleanup to remove duplicate graph-sync events after CSV migration
//
// Problem: After running migrate-csv-to-graph.js, duplicate events may exist:
// - CSV Import record (source: "Resource Scheduler Import") - now has graphData.id
// - Graph Sync record (createdSource: "graph-sync") - created when calendar was synced
//
// This script finds and deletes the graph-sync duplicates, keeping the richer CSV imports.
//
// Run with: node cleanup-csv-graph-duplicates.js
// Optional: node cleanup-csv-graph-duplicates.js --dry-run (preview only)
// Optional: node cleanup-csv-graph-duplicates.js --limit 50 (process only 50)

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';

async function cleanup() {
  const dryRun = process.argv.includes('--dry-run');

  // Parse --limit argument
  let limit = null;
  const limitIndex = process.argv.indexOf('--limit');
  if (limitIndex !== -1 && process.argv[limitIndex + 1]) {
    limit = parseInt(process.argv[limitIndex + 1], 10);
    if (isNaN(limit) || limit <= 0) {
      console.error('❌ Error: --limit must be a positive number');
      process.exit(1);
    }
  }

  console.log('🧹 CSV-Graph Duplicate Cleanup Script');
  console.log('━'.repeat(50));
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
  if (limit) console.log(`Limit: ${limit} records`);
  console.log(`Database: ${DB_NAME}`);
  console.log('━'.repeat(50));

  // Validate environment
  if (!MONGODB_URI) {
    console.error('❌ Error: MONGODB_URI is not defined in .env file');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  console.log('✅ Connected to MongoDB\n');

  const db = client.db(DB_NAME);
  const collection = db.collection('templeEvents__Events');

  try {
    // Step 1: Find CSV imports that have been successfully migrated (have graphData.id)
    let csvEvents = await collection.find({
      source: 'Resource Scheduler Import',
      'graphData.id': { $exists: true, $ne: null }
    }).toArray();

    const totalFound = csvEvents.length;

    if (limit && csvEvents.length > limit) {
      csvEvents = csvEvents.slice(0, limit);
      console.log(`📊 Found ${totalFound} migrated CSV events, checking ${limit} (limited)\n`);
    } else {
      console.log(`📊 Found ${csvEvents.length} migrated CSV events to check\n`);
    }

    if (csvEvents.length === 0) {
      console.log('✅ No migrated CSV events found. Run migrate-csv-to-graph.js first.');
      return;
    }

    const results = { checked: 0, duplicatesFound: 0, deleted: 0, errors: 0 };

    // Step 2: For each CSV event, check for graph-sync duplicate
    for (const csvEvent of csvEvents) {
      try {
        results.checked++;
        const graphId = csvEvent.graphData.id;
        const calendarId = csvEvent.calendarId;

        if (!graphId || !calendarId) {
          continue;
        }

        // Find duplicate: same calendarId + graphData.id, but createdSource = 'graph-sync'
        const duplicate = await collection.findOne({
          calendarId: calendarId,
          'graphData.id': graphId,
          createdSource: 'graph-sync',
          _id: { $ne: csvEvent._id }  // Exclude the CSV event itself
        });

        if (duplicate) {
          results.duplicatesFound++;
          console.log(`   🔍 Duplicate: "${csvEvent.eventTitle}"`);
          console.log(`      CSV: ${csvEvent._id} | Graph-sync: ${duplicate._id}`);

          if (!dryRun) {
            await collection.deleteOne({ _id: duplicate._id });
            results.deleted++;
            console.log(`      ✅ Deleted graph-sync duplicate`);
          }
        }
      } catch (eventError) {
        results.errors++;
        console.log(`   ❌ Error processing ${csvEvent._id}: ${eventError.message}`);
      }
    }

    // Summary
    console.log('\n' + '━'.repeat(50));
    console.log('📝 Cleanup Summary');
    console.log('━'.repeat(50));
    if (limit && totalFound > limit) {
      console.log(`   Total migrated CSV events: ${totalFound}`);
      console.log(`   Checked (limited): ${results.checked}`);
    } else {
      console.log(`   CSV events checked: ${results.checked}`);
    }
    console.log(`   Duplicates found: ${results.duplicatesFound}`);
    console.log(`   Deleted: ${results.deleted}`);
    if (results.errors > 0) {
      console.log(`   Errors: ${results.errors}`);
    }
    console.log('━'.repeat(50));

    if (dryRun) {
      console.log('\n⚠️  DRY RUN - No changes were made');
      console.log('Run without --dry-run to delete duplicates');
    } else {
      console.log('\n✅ Cleanup complete!');
    }

  } finally {
    await client.close();
    console.log('\n🔌 MongoDB connection closed');
  }
}

cleanup()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
