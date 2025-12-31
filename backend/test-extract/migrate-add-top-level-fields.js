// migrate-add-top-level-fields.js
// Migration script to add top-level application fields to all events in templeEvents__Events collection
//
// PURPOSE: Eliminate the need for runtime transformation by storing data in application-friendly format
// ARCHITECTURE:
//   - Top-level fields: Application layer (forms, UI) - eventTitle, startDate, startTime, etc.
//   - graphData nested: Microsoft Graph/Outlook integration layer
//   - internalData nested: Future integrations layer (reserved)
//
// This migration:
// 1. Extracts data from nested structures (graphData, roomReservationData, internalData)
// 2. Parses ISO datetime strings into separate date/time fields for forms
// 3. Adds top-level fields while preserving all nested data
// 4. Handles multiple data sources with proper fallback logic
//
// Run with: node migrate-add-top-level-fields.js
// Dry run: node migrate-add-top-level-fields.js --dry-run

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';
const DRY_RUN = process.argv.includes('--dry-run');

// Helper function to parse ISO datetime into separate date and time
function parseDateTimeToFields(isoString) {
  if (!isoString) return { date: '', time: '' };

  try {
    const dt = new Date(isoString);
    if (isNaN(dt.getTime())) {
      console.error(`Invalid date: ${isoString}`);
      return { date: '', time: '' };
    }

    // Extract date as YYYY-MM-DD
    const date = dt.toISOString().split('T')[0];

    // Extract time as HH:MM
    const hours = String(dt.getHours()).padStart(2, '0');
    const minutes = String(dt.getMinutes()).padStart(2, '0');
    const time = `${hours}:${minutes}`;

    return { date, time };
  } catch (err) {
    console.error(`Error parsing datetime ${isoString}:`, err.message);
    return { date: '', time: '' };
  }
}

async function migrateTopLevelFields() {
  console.log('🚀 Starting migration: Add top-level fields to templeEvents__Events\n');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made to the database\n');
  }

  // Validate environment variables
  if (!MONGODB_URI) {
    console.error('❌ Error: MONGODB_URI is not defined in .env file');
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

    // Step 2: Count documents by current field status
    const stats = {
      hasTopLevelFields: await collection.countDocuments({ eventTitle: { $exists: true } }),
      missingTopLevelFields: await collection.countDocuments({ eventTitle: { $exists: false } }),
      hasGraphData: await collection.countDocuments({ 'graphData.subject': { $exists: true } }),
      hasRoomReservationData: await collection.countDocuments({ roomReservationData: { $exists: true } }),
      hasInternalData: await collection.countDocuments({ internalData: { $exists: true } })
    };

    console.log('📈 Current field distribution:');
    console.log(`   - Already has top-level fields: ${stats.hasTopLevelFields}`);
    console.log(`   - Missing top-level fields: ${stats.missingTopLevelFields}`);
    console.log(`   - Has graphData: ${stats.hasGraphData}`);
    console.log(`   - Has roomReservationData: ${stats.hasRoomReservationData}`);
    console.log(`   - Has internalData: ${stats.hasInternalData}\n`);

    if (stats.missingTopLevelFields === 0) {
      console.log('✅ All events already have top-level fields. No migration needed!');
      return;
    }

    const BATCH_SIZE = 100; // Process in batches to avoid Cosmos DB rate limiting
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    // Step 3: Query events that need migration
    console.log('🔄 Querying events that need migration...');
    const eventsToMigrate = await collection.find({
      eventTitle: { $exists: false } // Only events without top-level fields
    }).toArray();

    console.log(`   Found ${eventsToMigrate.length} events to migrate\n`);

    // Step 4: Process events in batches
    for (let i = 0; i < eventsToMigrate.length; i += BATCH_SIZE) {
      const batch = eventsToMigrate.slice(i, i + BATCH_SIZE);
      console.log(`📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1} (${i + 1}-${Math.min(i + BATCH_SIZE, eventsToMigrate.length)} of ${eventsToMigrate.length})...`);

      for (const event of batch) {
        try {
          // Build top-level fields object
          const topLevelFields = {};

          // === CORE EVENT INFO ===
          // Extract subject/title from multiple sources
          topLevelFields.eventTitle = event.graphData?.subject ||
                                      event.roomReservationData?.eventTitle ||
                                      event.internalData?.subject ||
                                      'Untitled Event';

          // Extract description
          topLevelFields.eventDescription = event.graphData?.bodyPreview ||
                                           event.graphData?.body?.content ||
                                           event.roomReservationData?.eventDescription ||
                                           event.internalData?.description ||
                                           '';

          // === DATE/TIME FIELDS ===
          // Parse start datetime
          const startDateTime = event.graphData?.start?.dateTime ||
                               event.roomReservationData?.startDateTime ||
                               event.internalData?.startDateTime;

          if (startDateTime) {
            const { date, time } = parseDateTimeToFields(startDateTime);
            topLevelFields.startDate = date;
            topLevelFields.startTime = time;
            topLevelFields.startDateTime = startDateTime; // Also store combined format
          } else {
            console.warn(`⚠️  Event ${event._id} missing start datetime`);
            topLevelFields.startDate = '';
            topLevelFields.startTime = '';
            topLevelFields.startDateTime = '';
          }

          // Parse end datetime
          const endDateTime = event.graphData?.end?.dateTime ||
                             event.roomReservationData?.endDateTime ||
                             event.internalData?.endDateTime;

          if (endDateTime) {
            const { date, time } = parseDateTimeToFields(endDateTime);
            topLevelFields.endDate = date;
            topLevelFields.endTime = time;
            topLevelFields.endDateTime = endDateTime; // Also store combined format
          } else {
            console.warn(`⚠️  Event ${event._id} missing end datetime`);
            topLevelFields.endDate = '';
            topLevelFields.endTime = '';
            topLevelFields.endDateTime = '';
          }

          // === TIMING FIELDS (setup/teardown/door times) ===
          // Check multiple sources with proper fallback
          topLevelFields.setupTime = event.roomReservationData?.timing?.setupTime ||
                                    event.internalData?.setupTime ||
                                    '';

          topLevelFields.teardownTime = event.roomReservationData?.timing?.teardownTime ||
                                       event.internalData?.teardownTime ||
                                       '';

          topLevelFields.doorOpenTime = event.roomReservationData?.timing?.doorOpenTime ||
                                       event.internalData?.doorOpenTime ||
                                       '';

          topLevelFields.doorCloseTime = event.roomReservationData?.timing?.doorCloseTime ||
                                        event.internalData?.doorCloseTime ||
                                        '';

          topLevelFields.setupTimeMinutes = event.roomReservationData?.timing?.setupTimeMinutes ||
                                           event.internalData?.setupMinutes ||
                                           event.setupMinutes ||
                                           0;

          topLevelFields.teardownTimeMinutes = event.roomReservationData?.timing?.teardownTimeMinutes ||
                                              event.internalData?.teardownMinutes ||
                                              event.teardownMinutes ||
                                              0;

          // === NOTES FIELDS ===
          topLevelFields.setupNotes = event.roomReservationData?.internalNotes?.setupNotes ||
                                     event.internalData?.setupNotes ||
                                     event.internalNotes?.setupNotes ||
                                     '';

          topLevelFields.doorNotes = event.roomReservationData?.internalNotes?.doorNotes ||
                                    event.internalData?.doorNotes ||
                                    event.internalNotes?.doorNotes ||
                                    '';

          topLevelFields.eventNotes = event.roomReservationData?.internalNotes?.eventNotes ||
                                     event.internalData?.eventNotes ||
                                     event.internalNotes?.eventNotes ||
                                     '';

          // === LOCATION FIELDS ===
          topLevelFields.location = event.graphData?.location?.displayName ||
                                   event.roomReservationData?.location ||
                                   event.internalData?.location ||
                                   '';

          // === VIRTUAL MEETING FIELDS ===
          topLevelFields.virtualMeetingUrl = event.virtualMeetingUrl ||
                                            event.graphData?.onlineMeetingUrl ||
                                            event.graphData?.onlineMeeting?.joinUrl ||
                                            null;

          topLevelFields.virtualPlatform = event.virtualPlatform || null;

          // === ROOM RESERVATION FIELDS ===
          if (event.roomReservationData) {
            topLevelFields.requestedRooms = event.roomReservationData.requestedRooms || [];
            topLevelFields.requesterName = event.roomReservationData.requestedBy?.name || '';
            topLevelFields.requesterEmail = event.roomReservationData.requestedBy?.email || '';
            topLevelFields.department = event.roomReservationData.requestedBy?.department || '';
            topLevelFields.phone = event.roomReservationData.requestedBy?.phone || '';
            topLevelFields.attendeeCount = event.roomReservationData.attendeeCount || 0;
            topLevelFields.priority = event.roomReservationData.priority || 'medium';
            topLevelFields.specialRequirements = event.roomReservationData.specialRequirements || '';
            topLevelFields.contactName = event.roomReservationData.contactPerson?.name || '';
            topLevelFields.contactEmail = event.roomReservationData.contactPerson?.email || '';
            topLevelFields.isOnBehalfOf = event.roomReservationData.contactPerson?.isOnBehalfOf || false;
            topLevelFields.reviewNotes = event.roomReservationData.reviewNotes || '';
          }

          // === CATEGORY/ASSIGNMENT FIELDS ===
          topLevelFields.mecCategories = event.mecCategories ||
                                        event.internalData?.mecCategories ||
                                        [];

          topLevelFields.assignedTo = event.assignedTo ||
                                     event.internalData?.assignedTo ||
                                     '';

          // === FLAGS ===
          topLevelFields.isAllDayEvent = event.graphData?.isAllDay ||
                                        event.internalData?.isAllDay ||
                                        false;

          // Dry run: just log, don't update
          if (DRY_RUN) {
            console.log(`   [DRY RUN] Would update event ${event._id}: ${topLevelFields.eventTitle}`);
            totalUpdated++;
          } else {
            // Actually update the document
            await collection.updateOne(
              { _id: event._id },
              { $set: topLevelFields }
            );
            totalUpdated++;
          }

        } catch (error) {
          console.error(`   ❌ Error processing event ${event._id}:`, error.message);
          totalErrors++;
        }
      }

      console.log(`   ✅ Batch complete: ${totalUpdated} updated, ${totalErrors} errors\n`);

      // Add delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < eventsToMigrate.length) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      }
    }

    // Step 5: Verify migration results
    console.log('📊 Post-migration field distribution:');
    const newStats = {
      hasTopLevelFields: await collection.countDocuments({ eventTitle: { $exists: true } }),
      missingTopLevelFields: await collection.countDocuments({ eventTitle: { $exists: false } })
    };

    console.log(`   - Has top-level fields: ${newStats.hasTopLevelFields}/${totalDocs}`);
    console.log(`   - Missing top-level fields: ${newStats.missingTopLevelFields}/${totalDocs}\n`);

    // Verify all documents have required fields
    if (newStats.missingTopLevelFields === 0) {
      console.log('✅ SUCCESS: All documents now have top-level fields!\n');
    } else {
      console.log(`⚠️  WARNING: ${newStats.missingTopLevelFields} documents still missing top-level fields\n`);
    }

    // Summary
    console.log('📝 Migration Summary:');
    console.log(`   Total documents processed: ${totalUpdated}`);
    console.log(`   Successful updates: ${totalUpdated}`);
    console.log(`   Errors: ${totalErrors}`);
    console.log(`   Skipped: ${totalSkipped}\n`);

    if (DRY_RUN) {
      console.log('🔍 DRY RUN COMPLETE - No changes were made');
      console.log('   Run without --dry-run flag to apply changes\n');
    } else {
      console.log('✅ Migration completed successfully!\n');
    }

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
migrateTopLevelFields()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
