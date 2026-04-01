/**
 * Cleanup script for buggy sync records (duplicates created by graph-sync)
 *
 * DELETE criteria:
 * - rschedData does not exist (not an rsSched-imported event)
 * - AND createdSource: "graph-sync" (created by sync, not manually)
 * - AND createdByEmail: TempleEventsSandbox or TempleEvents (service accounts)
 *
 * These are duplicate records created when graph-sync didn't recognize
 * existing events due to different graphData.id values across mailboxes.
 * The fix uses iCalUId for deduplication instead.
 *
 * Run with:
 *   node cleanup-buggy-sync-records.js --dry-run    # Preview only
 *   node cleanup-buggy-sync-records.js              # Actually delete
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

async function cleanup() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    if (isDryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be made\n');
    }

    const db = client.db(DB_NAME);
    const collection = db.collection('templeEvents__Events');

    // Find buggy records
    console.log('🔍 Finding buggy sync records...');
    console.log('   Criteria:');
    console.log('   - rschedData does not exist');
    console.log('   - createdSource: "graph-sync"');
    console.log('   - createdByEmail: TempleEventsSandbox or TempleEvents\n');

    const buggyRecords = await collection.find({
      rschedData: { $exists: false },
      createdSource: 'graph-sync',
      createdByEmail: { $in: [
        'TempleEventsSandbox@emanuelnyc.org',
        'TempleEvents@emanuelnyc.org'
      ]}
    }).toArray();

    console.log(`📊 Found ${buggyRecords.length} buggy records\n`);

    if (buggyRecords.length === 0) {
      console.log('✨ No buggy records found! Database is clean.');
      return;
    }

    // Show ALL records to be deleted
    console.log('📋 Records to delete:');
    console.log('=' .repeat(70));
    buggyRecords.forEach((record, i) => {
      console.log(`\n${i + 1}. "${record.graphData?.subject || record.eventTitle || 'No subject'}"`);
      console.log(`   eventId: ${record.eventId}`);
      console.log(`   startDateTime: ${record.startDateTime || 'N/A'}`);
      console.log(`   createdSource: ${record.createdSource}`);
      console.log(`   createdByEmail: ${record.createdByEmail}`);
    });
    console.log('\n' + '=' .repeat(70));

    if (isDryRun) {
      console.log(`\n🔍 DRY RUN Complete!`);
      console.log(`📊 Would delete ${buggyRecords.length} buggy records`);
      console.log(`\nRun without --dry-run to actually delete these records.`);
    } else {
      // Actually delete the records
      console.log(`\n🗑️  Deleting ${buggyRecords.length} buggy records...`);

      const ids = buggyRecords.map(r => r._id);
      const result = await collection.deleteMany({ _id: { $in: ids } });

      console.log(`\n✅ Cleanup Complete!`);
      console.log(`📊 Deleted ${result.deletedCount} records`);
    }

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  } finally {
    await client.close();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

// Run the cleanup
cleanup()
  .then(() => {
    console.log('\n✨ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });
