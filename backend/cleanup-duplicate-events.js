/**
 * One-time script to clean up duplicate event records
 *
 * Finds events with the same userId + graphData.id but different eventId
 * Keeps the newest record (by _id), deletes older duplicates
 *
 * Run with: node cleanup-duplicate-events.js
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB_NAME || 'templeEventsDB';

async function cleanupDuplicates() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(DB_NAME);
    const collection = db.collection('templeEvents__InternalEvents');

    // Find all duplicates using aggregation
    console.log('\n🔍 Finding duplicate events...');
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

      // Sort by _id (MongoDB ObjectId contains timestamp)
      docs.sort((a, b) => a._id.toString().localeCompare(b._id.toString()));

      // Keep the newest (last one), delete the rest
      const toKeep = docs[docs.length - 1];
      const toDelete = docs.slice(0, -1);

      console.log(`   ✅ Keeping newest: eventId ${toKeep.eventId} (_id: ${toKeep._id})`);

      for (const doc of toDelete) {
        console.log(`   🗑️  Deleting older: eventId ${doc.eventId} (_id: ${doc._id})`);
        await collection.deleteOne({ _id: doc._id });
        totalDeleted++;
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Cleanup Complete!`);
    console.log(`📊 Processed ${duplicates.length} duplicate sets`);
    console.log(`🗑️  Deleted ${totalDeleted} duplicate records`);
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
