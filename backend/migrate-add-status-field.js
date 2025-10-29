// migrate-add-status-field.js
// Migration script to add status field to all events in templeEvents__Events collection
//
// Status values:
// - "active": Published/confirmed events (visible on calendar)
// - "pending": Awaiting approval (new room reservation requests)
// - "inactive": Archived/cancelled events
//
// Run with: node migrate-add-status-field.js

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';

async function migrateStatusField() {
  console.log('🚀 Starting migration: Add status field to templeEvents__Events\n');

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

    // Step 2: Count documents by current status/type
    const stats = {
      noStatus: await collection.countDocuments({ status: { $exists: false } }),
      hasRoomReservationData: await collection.countDocuments({ roomReservationData: { $exists: true } }),
      oldPending: await collection.countDocuments({ status: 'room-reservation-request' }),
      oldApproved: await collection.countDocuments({ status: 'approved' }),
      oldRejected: await collection.countDocuments({ status: 'rejected' }),
      alreadyActive: await collection.countDocuments({ status: 'active' }),
      alreadyPending: await collection.countDocuments({ status: 'pending' }),
      alreadyInactive: await collection.countDocuments({ status: 'inactive' })
    };

    console.log('📈 Current status distribution:');
    console.log(`   - No status field: ${stats.noStatus}`);
    console.log(`   - Has roomReservationData: ${stats.hasRoomReservationData}`);
    console.log(`   - Old "room-reservation-request": ${stats.oldPending}`);
    console.log(`   - Old "approved": ${stats.oldApproved}`);
    console.log(`   - Old "rejected": ${stats.oldRejected}`);
    console.log(`   - Already "active": ${stats.alreadyActive}`);
    console.log(`   - Already "pending": ${stats.alreadyPending}`);
    console.log(`   - Already "inactive": ${stats.alreadyInactive}\n`);

    // Step 3: Update regular events (no roomReservationData) to "active"
    // Process in batches to avoid Cosmos DB rate limiting (Error 16500)
    console.log('🔄 Step 1: Setting regular events to "active"...');
    const BATCH_SIZE = 100;
    let regularEventsUpdated = 0;

    // Find all regular events that need updating
    const regularEvents = await collection.find({
      status: { $exists: false },
      roomReservationData: { $exists: false }
    }).toArray();

    console.log(`   Found ${regularEvents.length} regular events to update`);

    // Process in batches
    for (let i = 0; i < regularEvents.length; i += BATCH_SIZE) {
      const batch = regularEvents.slice(i, i + BATCH_SIZE);
      const ids = batch.map(e => e._id);

      const result = await collection.updateMany(
        { _id: { $in: ids } },
        { $set: { status: 'active' } }
      );

      regularEventsUpdated += result.modifiedCount;
      console.log(`   Progress: ${regularEventsUpdated}/${regularEvents.length} events updated`);

      // Add delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < regularEvents.length) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      }
    }

    console.log(`   ✅ Updated ${regularEventsUpdated} regular events to "active"\n`);
    const result1 = { modifiedCount: regularEventsUpdated };

    // Step 4: Map old room reservation statuses to new system
    console.log('🔄 Step 2: Mapping old reservation statuses...');

    // "room-reservation-request" → "pending"
    const result2 = await collection.updateMany(
      { status: 'room-reservation-request' },
      { $set: { status: 'pending' } }
    );
    console.log(`   ✅ Mapped ${result2.modifiedCount} "room-reservation-request" → "pending"`);

    // "approved" → "active"
    const result3 = await collection.updateMany(
      { status: 'approved' },
      { $set: { status: 'active' } }
    );
    console.log(`   ✅ Mapped ${result3.modifiedCount} "approved" → "active"`);

    // "rejected" → "inactive"
    const result4 = await collection.updateMany(
      { status: 'rejected' },
      { $set: { status: 'inactive' } }
    );
    console.log(`   ✅ Mapped ${result4.modifiedCount} "rejected" → "inactive"\n`);

    // Step 5: Handle any events with roomReservationData but no status
    console.log('🔄 Step 3: Setting remaining reservations with no status to "pending"...');
    const result5 = await collection.updateMany(
      {
        roomReservationData: { $exists: true },
        status: { $exists: false }
      },
      {
        $set: { status: 'pending' }
      }
    );
    console.log(`   ✅ Set ${result5.modifiedCount} reservations to "pending"\n`);

    // Step 6: Verify migration results
    console.log('📊 Post-migration status distribution:');
    const newStats = {
      active: await collection.countDocuments({ status: 'active' }),
      pending: await collection.countDocuments({ status: 'pending' }),
      inactive: await collection.countDocuments({ status: 'inactive' }),
      noStatus: await collection.countDocuments({ status: { $exists: false } })
    };

    console.log(`   - "active": ${newStats.active}`);
    console.log(`   - "pending": ${newStats.pending}`);
    console.log(`   - "inactive": ${newStats.inactive}`);
    console.log(`   - No status: ${newStats.noStatus}\n`);

    // Verify all documents have status
    if (newStats.noStatus === 0) {
      console.log('✅ SUCCESS: All documents now have a status field!\n');
    } else {
      console.log(`⚠️  WARNING: ${newStats.noStatus} documents still have no status field\n`);
    }

    // Summary
    const totalUpdated = result1.modifiedCount + result2.modifiedCount +
                        result3.modifiedCount + result4.modifiedCount + result5.modifiedCount;
    console.log('📝 Migration Summary:');
    console.log(`   Total documents updated: ${totalUpdated}`);
    console.log(`   - Regular events → "active": ${result1.modifiedCount}`);
    console.log(`   - Old statuses remapped: ${result2.modifiedCount + result3.modifiedCount + result4.modifiedCount}`);
    console.log(`   - Reservations set to "pending": ${result5.modifiedCount}\n`);

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
migrateStatusField()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
