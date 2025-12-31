// regenerate-all-eventids.js
// Migration script to regenerate ALL eventId values with UUIDs
//
// This script will:
// - Generate a new unique UUID for EVERY event in templeEvents__Events
// - Process in batches to avoid rate limiting
// - Preserve all other data (graphData, internalData, etc.)
//
// Run with: node regenerate-all-eventids.js

require('dotenv').config();
const { MongoClient } = require('mongodb');
const { randomUUID } = require('crypto');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';
const BATCH_SIZE = 100;

async function regenerateAllEventIds() {
  console.log('🚀 Starting migration: Regenerate ALL eventId values with UUIDs\n');

  // Validate environment variables
  if (!MONGODB_URI) {
    console.error('❌ Error: MONGODB_URI is not defined in .env file');
    console.error('Please ensure your .env file contains MONGODB_URI or MONGODB_CONNECTION_STRING');
    process.exit(1);
  }

  console.log('📝 Configuration:');
  console.log(`   Database Name: ${DB_NAME}`);
  console.log(`   MongoDB URI: ${MONGODB_URI.substring(0, 20)}...`);
  console.log(`   Batch Size: ${BATCH_SIZE}\n`);

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const collection = db.collection('templeEvents__Events');

    // Step 1: Count total documents
    const totalDocs = await collection.countDocuments({});
    console.log(`📊 Total documents in collection: ${totalDocs}\n`);

    if (totalDocs === 0) {
      console.log('⚠️  No documents found in collection. Nothing to migrate.\n');
      return;
    }

    // Step 2: Count documents by current eventId status
    const stats = {
      withEventId: await collection.countDocuments({ eventId: { $exists: true, $ne: null, $ne: '' } }),
      noEventId: await collection.countDocuments({
        $or: [
          { eventId: { $exists: false } },
          { eventId: null },
          { eventId: '' }
        ]
      })
    };

    console.log('📈 Current eventId distribution:');
    console.log(`   - Has eventId: ${stats.withEventId}`);
    console.log(`   - Missing eventId: ${stats.noEventId}\n`);

    // Step 3: Get ALL documents
    console.log('🔄 Fetching all events...');
    const allEvents = await collection.find({}).toArray();
    console.log(`   Found ${allEvents.length} events to process\n`);

    // Step 4: Process in batches
    console.log('🔄 Regenerating eventId values with UUIDs...\n');
    let totalUpdated = 0;

    for (let i = 0; i < allEvents.length; i += BATCH_SIZE) {
      const batch = allEvents.slice(i, i + BATCH_SIZE);

      // Update each document in the batch with a new UUID
      const bulkOps = batch.map(event => ({
        updateOne: {
          filter: { _id: event._id },
          update: { $set: { eventId: randomUUID() } }
        }
      }));

      const result = await collection.bulkWrite(bulkOps);
      totalUpdated += result.modifiedCount;

      console.log(`   Progress: ${totalUpdated}/${allEvents.length} events updated (${Math.round((totalUpdated/allEvents.length)*100)}%)`);

      // Add delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < allEvents.length) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      }
    }

    console.log(`\n   ✅ Updated ${totalUpdated} events with new eventId values\n`);

    // Step 5: Verify migration results
    console.log('📊 Post-migration eventId distribution:');
    const newStats = {
      withEventId: await collection.countDocuments({ eventId: { $exists: true, $ne: null, $ne: '' } }),
      noEventId: await collection.countDocuments({
        $or: [
          { eventId: { $exists: false } },
          { eventId: null },
          { eventId: '' }
        ]
      })
    };

    console.log(`   - Has eventId: ${newStats.withEventId}`);
    console.log(`   - Missing eventId: ${newStats.noEventId}\n`);

    // Verify all documents now have eventId
    if (newStats.noEventId === 0 && newStats.withEventId === totalDocs) {
      console.log('✅ SUCCESS: All documents now have a unique UUID eventId!\n');
    } else {
      console.log(`⚠️  WARNING: ${newStats.noEventId} documents still have no eventId\n`);
    }

    // Step 6: Sample a few eventIds to verify they are UUIDs
    console.log('🔍 Sample of new eventId values:');
    const samples = await collection.find({}).limit(5).toArray();
    samples.forEach((event, idx) => {
      console.log(`   ${idx + 1}. ${event.eventId} (${event.graphData?.subject || 'No subject'})`);
    });
    console.log('');

    // Summary
    console.log('📝 Migration Summary:');
    console.log(`   Total documents: ${totalDocs}`);
    console.log(`   Documents updated: ${totalUpdated}`);
    console.log(`   Before - Had eventId: ${stats.withEventId}`);
    console.log(`   After - Has eventId: ${newStats.withEventId}`);
    console.log(`   New UUIDs generated: ${totalUpdated}\n`);

    console.log('✅ Migration completed successfully!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('🔌 MongoDB connection closed');
  }
}

// Run migration
regenerateAllEventIds()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
