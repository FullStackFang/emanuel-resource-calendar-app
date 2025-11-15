/**
 * Migration: Add recurring event fields to templeEvents__Events collection
 *
 * Adds fields needed to support Outlook-compatible recurring events:
 * - isRecurringMaster: Identifies master events with recurrence patterns
 * - recurrenceType: Distinguishes between recurring types and legacy multi-day events
 * - seriesMasterId: Links instances to their master event
 * - isException: Marks modified occurrences
 * - originalStartDateTime: Preserves original time for exceptions
 * - syncedFromOutlook: Tracks source of recurring events
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

async function migrate() {
  console.log('🔄 Starting recurring events migration...\n');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(DB_NAME);
    const eventsCollection = db.collection('templeEvents__Events');

    // Add new fields with default values (process in batches for Cosmos DB)
    console.log('\n📝 Adding recurring event fields to all documents...');

    // Get total count first
    const totalCount = await eventsCollection.countDocuments({});
    console.log(`   Found ${totalCount} documents to update`);

    const batchSize = 100;
    let processedCount = 0;
    let updatedCount = 0;

    // Process in batches
    for (let skip = 0; skip < totalCount; skip += batchSize) {
      const batch = await eventsCollection.find({}).skip(skip).limit(batchSize).toArray();

      for (const doc of batch) {
        try {
          await eventsCollection.updateOne(
            { _id: doc._id },
            {
              $set: {
                isRecurringMaster: false,
                recurrenceType: 'none',
                seriesMasterId: null,
                isException: false,
                originalStartDateTime: null,
                syncedFromOutlook: false
              }
            }
          );
          updatedCount++;
        } catch (err) {
          console.warn(`   ⚠️  Failed to update document ${doc._id}: ${err.message}`);
        }
      }

      processedCount += batch.length;
      console.log(`   Progress: ${processedCount}/${totalCount}`);

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`✅ Updated ${updatedCount} documents`);

    // Update existing eventSeriesId events to use 'custom-multiday' type
    console.log('\n📝 Marking existing multi-day events...');
    const multiDayResult = await eventsCollection.updateMany(
      { eventSeriesId: { $ne: null, $exists: true } },
      {
        $set: {
          recurrenceType: 'custom-multiday'
        }
      }
    );

    console.log(`✅ Marked ${multiDayResult.modifiedCount} custom multi-day events`);

    // Update events with Graph API recurrence data
    console.log('\n📝 Identifying existing Outlook recurring events...');
    const outlookRecurringResult = await eventsCollection.updateMany(
      { 'graphData.recurrence': { $exists: true, $ne: null } },
      {
        $set: {
          isRecurringMaster: true,
          recurrenceType: 'outlook-recurring',
          syncedFromOutlook: true
        }
      }
    );

    console.log(`✅ Identified ${outlookRecurringResult.modifiedCount} Outlook recurring masters`);

    // Update events with seriesMasterId from Graph API
    console.log('\n📝 Linking recurring event instances to masters...');
    const instancesResult = await eventsCollection.updateMany(
      { 'graphData.seriesMasterId': { $exists: true, $ne: null } },
      [
        {
          $set: {
            seriesMasterId: '$graphData.seriesMasterId',
            recurrenceType: 'outlook-recurring',
            syncedFromOutlook: true,
            isRecurringMaster: false
          }
        }
      ]
    );

    console.log(`✅ Linked ${instancesResult.modifiedCount} recurring instances`);

    // Create indexes for efficient queries
    console.log('\n📝 Creating indexes...');

    await eventsCollection.createIndex({ seriesMasterId: 1 });
    console.log('✅ Created index on seriesMasterId');

    await eventsCollection.createIndex({ isRecurringMaster: 1 });
    console.log('✅ Created index on isRecurringMaster');

    await eventsCollection.createIndex({ recurrenceType: 1 });
    console.log('✅ Created index on recurrenceType');

    await eventsCollection.createIndex(
      { seriesMasterId: 1, 'graphData.start.dateTime': 1 }
    );
    console.log('✅ Created compound index on seriesMasterId + start time');

    // Show summary statistics
    console.log('\n📊 Migration Summary:');
    console.log('═══════════════════════════════════════');

    const totalEvents = await eventsCollection.countDocuments();
    const recurringMasters = await eventsCollection.countDocuments({ isRecurringMaster: true });
    const recurringInstances = await eventsCollection.countDocuments({
      seriesMasterId: { $ne: null },
      isRecurringMaster: false
    });
    const customMultiDay = await eventsCollection.countDocuments({ recurrenceType: 'custom-multiday' });
    const exceptions = await eventsCollection.countDocuments({ isException: true });

    console.log(`Total events:              ${totalEvents}`);
    console.log(`Recurring masters:         ${recurringMasters}`);
    console.log(`Recurring instances:       ${recurringInstances}`);
    console.log(`Custom multi-day events:   ${customMultiDay}`);
    console.log(`Exception instances:       ${exceptions}`);
    console.log('═══════════════════════════════════════');

    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await client.close();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

// Run migration
migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
