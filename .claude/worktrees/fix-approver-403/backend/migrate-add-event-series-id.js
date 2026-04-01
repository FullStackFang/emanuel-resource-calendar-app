// migrate-add-event-series-id.js
// Migration script to add eventSeriesId field to all events in templeEvents__Events collection
//
// eventSeriesId values:
// - null: Single event (not part of a multi-day series)
// - "<timestamp>-<random>": Part of a multi-day event series (all events with same ID are related)
//
// This field enables:
// - Linking multi-day events created from a single form submission
// - Future group management features (edit/delete all events in series)
// - Consistent data structure across all events
//
// Run with: node backend/migrate-add-event-series-id.js

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';

async function migrateEventSeriesId() {
  console.log('🚀 Starting migration: Add eventSeriesId field to templeEvents__Events\n');

  // Validate environment variables
  if (!MONGODB_URI) {
    console.error('❌ Error: MONGODB_URI is not defined in .env file');
    console.error('Please ensure your .env file contains MONGODB_URI');
    process.exit(1);
  }

  console.log('📝 Configuration:');
  console.log(`   Database Name: ${DB_NAME}`);
  console.log(`   MongoDB URI: ${MONGODB_URI.substring(0, 20)}...\n`);

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
      console.log('ℹ️  Collection is empty. Nothing to migrate.\n');
      return;
    }

    // Step 2: Count documents by eventSeriesId status
    const stats = {
      noEventSeriesId: await collection.countDocuments({ eventSeriesId: { $exists: false } }),
      hasEventSeriesId: await collection.countDocuments({ eventSeriesId: { $exists: true } }),
      nullEventSeriesId: await collection.countDocuments({ eventSeriesId: null }),
      nonNullEventSeriesId: await collection.countDocuments({
        eventSeriesId: { $exists: true, $ne: null }
      })
    };

    console.log('📈 Current eventSeriesId distribution:');
    console.log(`   - No eventSeriesId field: ${stats.noEventSeriesId}`);
    console.log(`   - Has eventSeriesId field: ${stats.hasEventSeriesId}`);
    console.log(`     - eventSeriesId is null: ${stats.nullEventSeriesId}`);
    console.log(`     - eventSeriesId has value: ${stats.nonNullEventSeriesId}\n`);

    // Step 3: Check if migration is needed
    if (stats.noEventSeriesId === 0) {
      console.log('✅ All documents already have eventSeriesId field. No migration needed.\n');
      return;
    }

    // Step 4: Update documents without eventSeriesId field
    // Process in batches to avoid Cosmos DB rate limiting (Error 16500)
    console.log('🔄 Adding eventSeriesId: null to documents without the field...');
    const BATCH_SIZE = 100;
    let totalUpdated = 0;

    // Find all events that need updating
    const eventsToUpdate = await collection.find({
      eventSeriesId: { $exists: false }
    }).toArray();

    console.log(`   Found ${eventsToUpdate.length} events to update\n`);

    // Process in batches
    for (let i = 0; i < eventsToUpdate.length; i += BATCH_SIZE) {
      const batch = eventsToUpdate.slice(i, i + BATCH_SIZE);
      const ids = batch.map(e => e._id);

      const result = await collection.updateMany(
        { _id: { $in: ids } },
        { $set: { eventSeriesId: null } }
      );

      totalUpdated += result.modifiedCount;
      console.log(`   Progress: ${totalUpdated}/${eventsToUpdate.length} events updated`);

      // Add delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < eventsToUpdate.length) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      }
    }

    console.log(`\n   ✅ Updated ${totalUpdated} events with eventSeriesId: null\n`);

    // Step 5: Verify migration results
    console.log('📊 Post-migration eventSeriesId distribution:');
    const newStats = {
      noEventSeriesId: await collection.countDocuments({ eventSeriesId: { $exists: false } }),
      hasEventSeriesId: await collection.countDocuments({ eventSeriesId: { $exists: true } }),
      nullEventSeriesId: await collection.countDocuments({ eventSeriesId: null }),
      nonNullEventSeriesId: await collection.countDocuments({
        eventSeriesId: { $exists: true, $ne: null }
      })
    };

    console.log(`   - No eventSeriesId field: ${newStats.noEventSeriesId}`);
    console.log(`   - Has eventSeriesId field: ${newStats.hasEventSeriesId}`);
    console.log(`     - eventSeriesId is null: ${newStats.nullEventSeriesId}`);
    console.log(`     - eventSeriesId has value: ${newStats.nonNullEventSeriesId}\n`);

    // Verify all documents have eventSeriesId
    if (newStats.noEventSeriesId === 0) {
      console.log('✅ SUCCESS: All documents now have an eventSeriesId field!\n');
    } else {
      console.log(`⚠️  WARNING: ${newStats.noEventSeriesId} documents still missing eventSeriesId field\n`);
    }

    // Summary
    console.log('📝 Migration Summary:');
    console.log(`   Total documents in collection: ${totalDocs}`);
    console.log(`   Documents updated: ${totalUpdated}`);
    console.log(`   Documents with eventSeriesId=null: ${newStats.nullEventSeriesId}`);
    console.log(`   Documents with eventSeriesId value: ${newStats.nonNullEventSeriesId}\n`);

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
migrateEventSeriesId()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
