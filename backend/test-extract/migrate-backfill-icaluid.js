/**
 * Migration script to backfill iCalUId for existing events
 *
 * Finds events with graphData.id but no graphData.iCalUId,
 * queries Graph API to get the iCalUId, and updates the record.
 *
 * Run with:
 *   node migrate-backfill-icaluid.js --access-token=<token> --dry-run
 *   node migrate-backfill-icaluid.js --access-token=<token>
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING;
const DB_NAME = process.env.MONGODB_DATABASE_NAME;

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const accessToken = args.find(a => a.startsWith('--access-token='))?.split('=')[1];
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0');
const offset = parseInt(args.find(a => a.startsWith('--offset='))?.split('=')[1] || '0');

async function migrate() {
  if (!accessToken) {
    console.error('Error: --access-token=<token> is required');
    console.log('\nUsage:');
    console.log('  node migrate-backfill-icaluid.js --access-token=<token> --dry-run');
    console.log('  node migrate-backfill-icaluid.js --access-token=<token>');
    console.log('  node migrate-backfill-icaluid.js --access-token=<token> --limit=100');
    console.log('  node migrate-backfill-icaluid.js --access-token=<token> --limit=100 --offset=200');
    console.log('\nOptions:');
    console.log('  --limit=N   Only process N records (default: all)');
    console.log('  --offset=N  Skip first N records (default: 0)');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    if (isDryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be made\n');
    }

    const db = client.db(DB_NAME);
    const collection = db.collection('templeEvents__Events');

    // Find events with graphData.id but no iCalUId
    console.log('🔍 Querying for events without iCalUId...');
    if (limit > 0) {
      console.log(`   Limit: ${limit} records, Offset: ${offset}`);
    }
    console.log('   (This may take a moment if there are many events)\n');

    // Build query with optional limit/offset
    let query = collection.find({
      'graphData.id': { $exists: true, $ne: null },
      'graphData.iCalUId': { $exists: false }
    });

    if (offset > 0) {
      query = query.skip(offset);
    }
    if (limit > 0) {
      query = query.limit(limit);
    }

    const events = await query.toArray();

    // Get total count for context
    const totalCount = await collection.countDocuments({
      'graphData.id': { $exists: true, $ne: null },
      'graphData.iCalUId': { $exists: false }
    });

    console.log(`📊 Found ${events.length} events to process (${totalCount} total without iCalUId)\n`);

    if (events.length === 0) {
      console.log('✨ All events already have iCalUId!');
      return;
    }

    let updated = 0;
    let failed = 0;
    let notFound = 0;

    // Process in batches to respect rate limits
    const BATCH_SIZE = 20;
    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      const batch = events.slice(i, i + BATCH_SIZE);

      // Build batch request
      const batchRequests = batch.map((event, idx) => ({
        id: String(idx + 1),
        method: 'GET',
        url: `/me/events/${event.graphData.id}?$select=id,iCalUId`
      }));

      try {
        const response = await fetch('https://graph.microsoft.com/v1.0/$batch', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ requests: batchRequests })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ Batch request failed: ${response.status} - ${errorText}`);
          failed += batch.length;
          continue;
        }

        const result = await response.json();

        for (const res of result.responses) {
          const idx = parseInt(res.id) - 1;
          const event = batch[idx];

          if (res.status === 200 && res.body?.iCalUId) {
            if (isDryRun) {
              console.log(`[DRY RUN] Would update: ${event.graphData.subject}`);
              console.log(`  iCalUId: ${res.body.iCalUId}`);
            } else {
              await collection.updateOne(
                { _id: event._id },
                { $set: { 'graphData.iCalUId': res.body.iCalUId } }
              );
              console.log(`✅ Updated: ${event.graphData.subject}`);
            }
            updated++;
          } else if (res.status === 404) {
            console.log(`⚠️  Not found in Graph: ${event.graphData.subject}`);
            notFound++;
          } else {
            console.log(`❌ Failed: ${event.graphData.subject} - ${res.body?.error?.message || 'Unknown error'}`);
            failed++;
          }
        }

        // Rate limit: wait between batches
        if (i + BATCH_SIZE < events.length) {
          console.log(`\n⏳ Waiting 1 second before next batch...`);
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (error) {
        console.error(`❌ Batch error:`, error.message);
        failed += batch.length;
      }

      console.log(`\n📈 Progress: ${Math.min(i + BATCH_SIZE, events.length)}/${events.length}`);
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 Migration Summary:');
    console.log(`   ✅ Updated: ${updated}`);
    console.log(`   ⚠️  Not found in Graph: ${notFound}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log('='.repeat(50));

  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  } finally {
    await client.close();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

// Run the migration
migrate()
  .then(() => {
    console.log('\n✨ Migration completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration failed:', error);
    process.exit(1);
  });
