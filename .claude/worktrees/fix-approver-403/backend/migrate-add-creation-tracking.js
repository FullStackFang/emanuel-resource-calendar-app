// migrate-add-creation-tracking.js
// Migration script to add creation tracking fields to all events in templeEvents__Events collection
//
// New fields added:
// - createdAt: Date - When record was first created in our system
// - createdBy: String - User ID (userId from JWT)
// - createdByEmail: String - User email address
// - createdByName: String - User display name
// - createdSource: String - How the event was created:
//     * "unified-form": Created via the unified event form
//     * "room-reservation": Created via room reservation request
//     * "graph-sync": Synced from Microsoft Graph API
//     * "csv-import": Imported via CSV
//     * "unknown": Cannot determine source
//
// Run with: node migrate-add-creation-tracking.js

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';

async function migrateCreationTracking() {
  console.log('🚀 Starting migration: Add creation tracking fields to templeEvents__Events\n');

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

    // Step 2: Count documents by current tracking status
    const stats = {
      noCreatedAt: await collection.countDocuments({ createdAt: { $exists: false } }),
      noCreatedBy: await collection.countDocuments({ createdBy: { $exists: false } }),
      noCreatedByEmail: await collection.countDocuments({ createdByEmail: { $exists: false } }),
      noCreatedSource: await collection.countDocuments({ createdSource: { $exists: false } }),
      hasGraphData: await collection.countDocuments({ 'graphData.createdDateTime': { $exists: true } }),
      hasRoomReservationData: await collection.countDocuments({ roomReservationData: { $exists: true } }),
      hasCsvImport: await collection.countDocuments({ 'internalData.importedAt': { $exists: true } }),
      alreadyComplete: await collection.countDocuments({
        createdAt: { $exists: true },
        createdBy: { $exists: true },
        createdByEmail: { $exists: true },
        createdSource: { $exists: true }
      })
    };

    console.log('📈 Current tracking field distribution:');
    console.log(`   - Missing createdAt: ${stats.noCreatedAt}`);
    console.log(`   - Missing createdBy: ${stats.noCreatedBy}`);
    console.log(`   - Missing createdByEmail: ${stats.noCreatedByEmail}`);
    console.log(`   - Missing createdSource: ${stats.noCreatedSource}`);
    console.log(`   - Already complete: ${stats.alreadyComplete}`);
    console.log(`\n   Event type distribution:`);
    console.log(`   - Has Graph data: ${stats.hasGraphData}`);
    console.log(`   - Has room reservation data: ${stats.hasRoomReservationData}`);
    console.log(`   - Has CSV import data: ${stats.hasCsvImport}\n`);

    const BATCH_SIZE = 100; // Process in batches to avoid Cosmos DB rate limiting (Error 16500)
    let totalUpdated = 0;

    // Step 3: Update Graph-synced events
    console.log('🔄 Step 1: Processing Graph-synced events...');
    const graphEvents = await collection.find({
      'graphData.createdDateTime': { $exists: true },
      $or: [
        { createdAt: { $exists: false } },
        { createdBy: { $exists: false } },
        { createdSource: { $exists: false } }
      ]
    }).toArray();

    console.log(`   Found ${graphEvents.length} Graph-synced events to update`);

    for (let i = 0; i < graphEvents.length; i += BATCH_SIZE) {
      const batch = graphEvents.slice(i, i + BATCH_SIZE);

      for (const event of batch) {
        const updateFields = {};

        // Use Graph's createdDateTime if available
        if (!event.createdAt && event.graphData?.createdDateTime) {
          updateFields.createdAt = new Date(event.graphData.createdDateTime);
        } else if (!event.createdAt) {
          // Fallback to lastSyncedAt or current date
          updateFields.createdAt = event.lastSyncedAt || new Date();
        }

        // Use Graph organizer info if available
        if (!event.createdBy) {
          updateFields.createdBy = event.userId || 'system';
        }

        if (!event.createdByEmail && event.graphData?.organizer?.emailAddress?.address) {
          updateFields.createdByEmail = event.graphData.organizer.emailAddress.address;
        } else if (!event.createdByEmail) {
          updateFields.createdByEmail = 'unknown@system';
        }

        if (!event.createdByName && event.graphData?.organizer?.emailAddress?.name) {
          updateFields.createdByName = event.graphData.organizer.emailAddress.name;
        } else if (!event.createdByName) {
          updateFields.createdByName = 'System';
        }

        if (!event.createdSource) {
          updateFields.createdSource = 'graph-sync';
        }

        if (Object.keys(updateFields).length > 0) {
          await collection.updateOne(
            { _id: event._id },
            { $set: updateFields }
          );
          totalUpdated++;
        }
      }

      console.log(`   Progress: ${Math.min((i + BATCH_SIZE), graphEvents.length)}/${graphEvents.length} events processed`);

      // Add delay between batches
      if (i + BATCH_SIZE < graphEvents.length) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      }
    }

    console.log(`   ✅ Updated ${totalUpdated} Graph-synced events\n`);

    // Step 4: Update room reservation events
    console.log('🔄 Step 2: Processing room reservation events...');
    const reservationEvents = await collection.find({
      roomReservationData: { $exists: true },
      $or: [
        { createdAt: { $exists: false } },
        { createdBy: { $exists: false } },
        { createdSource: { $exists: false } }
      ]
    }).toArray();

    console.log(`   Found ${reservationEvents.length} room reservation events to update`);
    let reservationsUpdated = 0;

    for (let i = 0; i < reservationEvents.length; i += BATCH_SIZE) {
      const batch = reservationEvents.slice(i, i + BATCH_SIZE);

      for (const event of batch) {
        const updateFields = {};

        // Use submittedAt from room reservation data
        if (!event.createdAt && event.roomReservationData?.submittedAt) {
          updateFields.createdAt = new Date(event.roomReservationData.submittedAt);
        } else if (!event.createdAt) {
          updateFields.createdAt = event.lastSyncedAt || new Date();
        }

        // Use requester info from room reservation data
        if (!event.createdBy) {
          updateFields.createdBy = event.roomReservationData?.requestedBy?.userId || event.userId || 'system';
        }

        if (!event.createdByEmail && event.roomReservationData?.requestedBy?.email) {
          updateFields.createdByEmail = event.roomReservationData.requestedBy.email;
        } else if (!event.createdByEmail) {
          updateFields.createdByEmail = 'unknown@system';
        }

        if (!event.createdByName && event.roomReservationData?.requestedBy?.name) {
          updateFields.createdByName = event.roomReservationData.requestedBy.name;
        } else if (!event.createdByName) {
          updateFields.createdByName = 'System';
        }

        if (!event.createdSource) {
          updateFields.createdSource = 'room-reservation';
        }

        if (Object.keys(updateFields).length > 0) {
          await collection.updateOne(
            { _id: event._id },
            { $set: updateFields }
          );
          reservationsUpdated++;
        }
      }

      console.log(`   Progress: ${Math.min((i + BATCH_SIZE), reservationEvents.length)}/${reservationEvents.length} events processed`);

      // Add delay between batches
      if (i + BATCH_SIZE < reservationEvents.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`   ✅ Updated ${reservationsUpdated} room reservation events\n`);

    // Step 5: Update CSV-imported events
    console.log('🔄 Step 3: Processing CSV-imported events...');
    const csvEvents = await collection.find({
      'internalData.importedAt': { $exists: true },
      roomReservationData: { $exists: false },
      'graphData.createdDateTime': { $exists: false },
      $or: [
        { createdAt: { $exists: false } },
        { createdBy: { $exists: false } },
        { createdSource: { $exists: false } }
      ]
    }).toArray();

    console.log(`   Found ${csvEvents.length} CSV-imported events to update`);
    let csvUpdated = 0;

    for (let i = 0; i < csvEvents.length; i += BATCH_SIZE) {
      const batch = csvEvents.slice(i, i + BATCH_SIZE);

      for (const event of batch) {
        const updateFields = {};

        // Use importedAt from internal data
        if (!event.createdAt && event.internalData?.importedAt) {
          updateFields.createdAt = new Date(event.internalData.importedAt);
        } else if (!event.createdAt) {
          updateFields.createdAt = event.lastSyncedAt || new Date();
        }

        if (!event.createdBy) {
          updateFields.createdBy = event.userId || 'csv-import-system';
        }

        if (!event.createdByEmail) {
          updateFields.createdByEmail = 'csv-import@system';
        }

        if (!event.createdByName) {
          updateFields.createdByName = 'CSV Import System';
        }

        if (!event.createdSource) {
          updateFields.createdSource = 'csv-import';
        }

        if (Object.keys(updateFields).length > 0) {
          await collection.updateOne(
            { _id: event._id },
            { $set: updateFields }
          );
          csvUpdated++;
        }
      }

      console.log(`   Progress: ${Math.min((i + BATCH_SIZE), csvEvents.length)}/${csvEvents.length} events processed`);

      // Add delay between batches
      if (i + BATCH_SIZE < csvEvents.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`   ✅ Updated ${csvUpdated} CSV-imported events\n`);

    // Step 6: Update remaining events (unknown source)
    console.log('🔄 Step 4: Processing remaining events (unknown source)...');
    const unknownEvents = await collection.find({
      $or: [
        { createdAt: { $exists: false } },
        { createdBy: { $exists: false } },
        { createdByEmail: { $exists: false } },
        { createdSource: { $exists: false } }
      ]
    }).toArray();

    console.log(`   Found ${unknownEvents.length} remaining events to update`);
    let unknownUpdated = 0;

    for (let i = 0; i < unknownEvents.length; i += BATCH_SIZE) {
      const batch = unknownEvents.slice(i, i + BATCH_SIZE);

      for (const event of batch) {
        const updateFields = {};

        if (!event.createdAt) {
          // Use lastSyncedAt if available, otherwise use current date
          updateFields.createdAt = event.lastSyncedAt || event.cachedAt || new Date();
        }

        if (!event.createdBy) {
          updateFields.createdBy = event.userId || 'unknown';
        }

        if (!event.createdByEmail) {
          updateFields.createdByEmail = 'unknown@system';
        }

        if (!event.createdByName) {
          updateFields.createdByName = 'Unknown';
        }

        if (!event.createdSource) {
          updateFields.createdSource = 'unknown';
        }

        if (Object.keys(updateFields).length > 0) {
          await collection.updateOne(
            { _id: event._id },
            { $set: updateFields }
          );
          unknownUpdated++;
        }
      }

      console.log(`   Progress: ${Math.min((i + BATCH_SIZE), unknownEvents.length)}/${unknownEvents.length} events processed`);

      // Add delay between batches
      if (i + BATCH_SIZE < unknownEvents.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`   ✅ Updated ${unknownUpdated} remaining events\n`);

    // Step 7: Verify migration results
    console.log('📊 Post-migration field distribution:');
    const newStats = {
      hasCreatedAt: await collection.countDocuments({ createdAt: { $exists: true } }),
      hasCreatedBy: await collection.countDocuments({ createdBy: { $exists: true } }),
      hasCreatedByEmail: await collection.countDocuments({ createdByEmail: { $exists: true } }),
      hasCreatedSource: await collection.countDocuments({ createdSource: { $exists: true } }),
      complete: await collection.countDocuments({
        createdAt: { $exists: true },
        createdBy: { $exists: true },
        createdByEmail: { $exists: true },
        createdSource: { $exists: true }
      })
    };

    console.log(`   - Has createdAt: ${newStats.hasCreatedAt}/${totalDocs}`);
    console.log(`   - Has createdBy: ${newStats.hasCreatedBy}/${totalDocs}`);
    console.log(`   - Has createdByEmail: ${newStats.hasCreatedByEmail}/${totalDocs}`);
    console.log(`   - Has createdSource: ${newStats.hasCreatedSource}/${totalDocs}`);
    console.log(`   - Complete (all fields): ${newStats.complete}/${totalDocs}\n`);

    // Count by source
    console.log('📊 Creation source distribution:');
    const sourceCounts = {
      unifiedForm: await collection.countDocuments({ createdSource: 'unified-form' }),
      roomReservation: await collection.countDocuments({ createdSource: 'room-reservation' }),
      graphSync: await collection.countDocuments({ createdSource: 'graph-sync' }),
      csvImport: await collection.countDocuments({ createdSource: 'csv-import' }),
      unknown: await collection.countDocuments({ createdSource: 'unknown' })
    };

    console.log(`   - unified-form: ${sourceCounts.unifiedForm}`);
    console.log(`   - room-reservation: ${sourceCounts.roomReservation}`);
    console.log(`   - graph-sync: ${sourceCounts.graphSync}`);
    console.log(`   - csv-import: ${sourceCounts.csvImport}`);
    console.log(`   - unknown: ${sourceCounts.unknown}\n`);

    // Verify all documents have required fields
    if (newStats.complete === totalDocs) {
      console.log('✅ SUCCESS: All documents now have complete creation tracking fields!\n');
    } else {
      const missing = totalDocs - newStats.complete;
      console.log(`⚠️  WARNING: ${missing} documents still missing some tracking fields\n`);
    }

    // Summary
    const totalProcessed = totalUpdated + reservationsUpdated + csvUpdated + unknownUpdated;
    console.log('📝 Migration Summary:');
    console.log(`   Total documents processed: ${totalProcessed}`);
    console.log(`   - Graph-synced events: ${totalUpdated}`);
    console.log(`   - Room reservations: ${reservationsUpdated}`);
    console.log(`   - CSV imports: ${csvUpdated}`);
    console.log(`   - Unknown source: ${unknownUpdated}\n`);

    console.log('✅ Migration completed successfully!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    await client.close();
    console.log('🔌 MongoDB connection closed');
  }
}

// Run migration
migrateCreationTracking()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
