/**
 * One-time script to clean up duplicate event records
 *
 * Finds events with the same userId + graphData.id but different eventId
 * Keeps the newest record (by _id), deletes older duplicates
 *
 * Run with: node cleanup-duplicate-events.js
 * Preview: node cleanup-duplicate-events.js --dry-run
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

async function cleanupDuplicates() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    if (isDryRun) {
      console.log('\n🔍 DRY RUN MODE - No changes will be made\n');
    }

    const db = client.db(DB_NAME);
    const collection = db.collection('templeEvents__Events');

    // Find all duplicates using aggregation
    console.log('🔍 Finding duplicate events...');
    const duplicates = await collection.aggregate([
      {
        $match: {
          'graphData.id': { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: {
            userId: '$userId',
            graphId: '$graphData.id'
          },
          count: { $sum: 1 },
          docs: { $push: { _id: '$_id', eventId: '$eventId', subject: '$graphData.subject' } }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]).toArray();

    console.log(`📊 Found ${duplicates.length} sets of duplicates\n`);

    if (duplicates.length === 0) {
      console.log('✨ No duplicates found! Database is clean.');
      return;
    }

    let totalDeleted = 0;

    // Process each set of duplicates
    for (const dup of duplicates) {
      const { userId, graphId } = dup._id;
      const docs = dup.docs;

      console.log(`\n📋 Duplicate: "${docs[0].subject}"`);
      console.log(`   User: ${userId}`);
      console.log(`   Graph ID: ${graphId}`);
      console.log(`   Found ${docs.length} copies:`);

      // Prefer keeping rsSched records over UUID duplicates
      // rsSched records are the original imports; UUID records are sync duplicates
      const rsSchedDocs = docs.filter(d => d.eventId.startsWith('rssched-'));
      const uuidDocs = docs.filter(d => !d.eventId.startsWith('rssched-'));

      let toKeep, toDelete;
      if (rsSchedDocs.length > 0) {
        // Keep the rsSched record (prefer original import)
        // If multiple rsSched records somehow exist, keep the newest
        rsSchedDocs.sort((a, b) => b._id.toString().localeCompare(a._id.toString()));
        toKeep = rsSchedDocs[0];
        toDelete = [...rsSchedDocs.slice(1), ...uuidDocs];
      } else {
        // No rsSched records, keep newest UUID (fallback)
        docs.sort((a, b) => b._id.toString().localeCompare(a._id.toString()));
        toKeep = docs[0];
        toDelete = docs.slice(1);
      }

      // Show whether the kept record is rsSched or UUID
      const keepType = toKeep.eventId.startsWith('rssched-') ? '(rsSched)' : '(UUID)';
      console.log(`   ✅ ${isDryRun ? 'Would keep' : 'Keeping'}: eventId ${toKeep.eventId} ${keepType}`);

      for (const doc of toDelete) {
        const deleteType = doc.eventId.startsWith('rssched-') ? '(rsSched)' : '(UUID)';
        if (isDryRun) {
          console.log(`   🗑️  Would delete: eventId ${doc.eventId} ${deleteType}`);
          totalDeleted++;
        } else {
          console.log(`   🗑️  Deleting: eventId ${doc.eventId} ${deleteType}`);
          await collection.deleteOne({ _id: doc._id });
          totalDeleted++;
        }
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    if (isDryRun) {
      console.log(`🔍 DRY RUN Complete!`);
      console.log(`📊 Found ${duplicates.length} duplicate sets`);
      console.log(`🗑️  Would delete ${totalDeleted} duplicate records`);
      console.log(`\nRun without --dry-run to actually delete these records.`);
    } else {
      console.log(`✅ Cleanup Complete!`);
      console.log(`📊 Processed ${duplicates.length} duplicate sets`);
      console.log(`🗑️  Deleted ${totalDeleted} duplicate records`);
    }
    console.log(`${'='.repeat(60)}\n`);

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  } finally {
    await client.close();
    console.log('👋 Disconnected from MongoDB');
  }
}

// Run the cleanup
cleanupDuplicates()
  .then(() => {
    console.log('\n✨ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });
