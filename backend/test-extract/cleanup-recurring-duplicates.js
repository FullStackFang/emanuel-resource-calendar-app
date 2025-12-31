/**
 * Cleanup script: Remove duplicate recurring event occurrences from MongoDB
 *
 * This script removes occurrence records that were incorrectly stored in the database.
 * These occurrences should only exist in Outlook; the frontend expands series masters dynamically.
 *
 * What this script does:
 * 1. Identifies duplicate occurrence records (missing type/seriesMasterId fields)
 * 2. Keeps only series master records (those with recurrence data)
 * 3. Deletes the duplicate occurrence records
 *
 * Safe to run multiple times - only removes duplicates, preserves masters.
 */

const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.MONGODB_DB_NAME || 'emanuelnyc-services';

if (!MONGODB_URI) {
  console.error('❌ MONGODB_CONNECTION_STRING not found in environment variables');
  console.error('Please check that backend/.env file exists and contains MONGODB_CONNECTION_STRING');
  process.exit(1);
}

async function cleanupDuplicates() {
  console.log('🧹 Starting cleanup: Remove duplicate recurring event occurrences\n');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(DB_NAME);
    const eventsCollection = db.collection('templeEvents__Events');

    // STEP 1: Find all events that are potential duplicates
    // These are events that:
    // - Have NO type field (or type is null/undefined)
    // - Have NO recurrence data
    // - Have NO seriesMasterId
    // - Were created by graph-sync
    console.log('\n🔍 Searching for duplicate occurrence records...');

    const duplicateQuery = {
      $or: [
        { 'graphData.type': { $exists: false } },
        { 'graphData.type': null }
      ],
      'graphData.recurrence': null,
      'graphData.seriesMasterId': null,
      'createdSource': 'graph-sync'
    };

    const potentialDuplicates = await eventsCollection.find(duplicateQuery).toArray();
    console.log(`   Found ${potentialDuplicates.length} potential duplicate occurrence records`);

    if (potentialDuplicates.length === 0) {
      console.log('\n✅ No duplicates found! Database is clean.');
      return;
    }

    // STEP 2: Show preview of what will be deleted
    console.log('\n📋 Preview of records to be deleted:');
    potentialDuplicates.slice(0, 5).forEach((doc, idx) => {
      console.log(`\n  ${idx + 1}. Subject: ${doc.graphData?.subject || 'N/A'}`);
      console.log(`     Date: ${doc.startDate || 'N/A'}`);
      console.log(`     EventId: ${doc.eventId}`);
      console.log(`     Type: ${doc.graphData?.type || 'null'}`);
      console.log(`     HasRecurrence: ${!!doc.graphData?.recurrence}`);
      console.log(`     SeriesMasterId: ${doc.graphData?.seriesMasterId || 'null'}`);
    });

    if (potentialDuplicates.length > 5) {
      console.log(`\n   ...and ${potentialDuplicates.length - 5} more`);
    }

    // STEP 3: Confirm deletion
    console.log('\n⚠️  This will PERMANENTLY DELETE these duplicate occurrence records.');
    console.log('   Series master records (with recurrence data) will be preserved.');
    console.log('\n   Press Ctrl+C to cancel, or wait 5 seconds to continue...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // STEP 4: Delete the duplicates
    console.log('\n🗑️  Deleting duplicate occurrence records...');
    const deleteResult = await eventsCollection.deleteMany(duplicateQuery);

    console.log(`\n✅ Cleanup complete!`);
    console.log(`   Deleted: ${deleteResult.deletedCount} duplicate occurrence records`);

    // STEP 5: Verify cleanup
    console.log('\n🔍 Verifying cleanup...');
    const remainingDuplicates = await eventsCollection.countDocuments(duplicateQuery);
    console.log(`   Remaining duplicates: ${remainingDuplicates}`);

    // STEP 6: Show summary statistics
    console.log('\n📊 Database Summary:');
    console.log('═══════════════════════════════════════');

    const totalEvents = await eventsCollection.countDocuments();
    const seriesMasters = await eventsCollection.countDocuments({
      'graphData.type': 'seriesMaster'
    });
    const standaloneEvents = await eventsCollection.countDocuments({
      'graphData.type': 'singleInstance'
    });

    console.log(`Total events:              ${totalEvents}`);
    console.log(`Series masters:            ${seriesMasters}`);
    console.log(`Standalone events:         ${standaloneEvents}`);
    console.log('═══════════════════════════════════════');

    console.log('\n✅ Migration completed successfully!');
    console.log('\n💡 Next steps:');
    console.log('   1. Test the calendar to ensure recurring events display correctly');
    console.log('   2. Create a new recurring event to verify no duplicates are created');
    console.log('   3. Monitor database for any new duplicate occurrences');

  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    throw error;
  } finally {
    await client.close();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

// Run cleanup
cleanupDuplicates()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
