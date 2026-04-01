// migrate-reorganize-room-reservation-data.js
// Migration script to reorganize roomReservationData structure in templeEvents__Events
//
// Purpose: Move requester/contact info INTO roomReservationData, keep operational data at top level
//
// Changes:
// - Move requesterName, requesterEmail, department, phone → roomReservationData.requestedBy
// - Move contactName, contactEmail, isOnBehalfOf → roomReservationData.contactPerson
// - Move reviewNotes → roomReservationData.reviewNotes
// - Keep at top level: attendeeCount, specialRequirements, timing fields, notes
//
// Run with: node migrate-reorganize-room-reservation-data.js

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';

async function migrateRoomReservationData() {
  console.log('🚀 Starting migration: Reorganize roomReservationData structure\n');

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

    // Step 1: Count total documents and reservations
    const totalDocs = await collection.countDocuments({});
    const reservationDocs = await collection.countDocuments({ roomReservationData: { $exists: true, $ne: null } });

    console.log(`📊 Database statistics:`);
    console.log(`   Total documents: ${totalDocs}`);
    console.log(`   Documents with roomReservationData: ${reservationDocs}\n`);

    if (reservationDocs === 0) {
      console.log('ℹ️  No room reservations found. Nothing to migrate.');
      return;
    }

    // Step 2: Analyze current structure
    console.log('🔍 Analyzing current data structure...');
    const sampleReservation = await collection.findOne({
      roomReservationData: { $exists: true, $ne: null }
    });

    if (sampleReservation) {
      console.log('\n📄 Sample document structure (before migration):');
      console.log('   Top-level fields:');
      if (sampleReservation.requesterName) console.log(`     - requesterName: "${sampleReservation.requesterName}"`);
      if (sampleReservation.requesterEmail) console.log(`     - requesterEmail: "${sampleReservation.requesterEmail}"`);
      if (sampleReservation.department) console.log(`     - department: "${sampleReservation.department}"`);
      if (sampleReservation.phone) console.log(`     - phone: "${sampleReservation.phone}"`);
      if (sampleReservation.contactName) console.log(`     - contactName: "${sampleReservation.contactName}"`);
      if (sampleReservation.contactEmail) console.log(`     - contactEmail: "${sampleReservation.contactEmail}"`);
      if (sampleReservation.isOnBehalfOf !== undefined) console.log(`     - isOnBehalfOf: ${sampleReservation.isOnBehalfOf}`);
      if (sampleReservation.reviewNotes) console.log(`     - reviewNotes: "${sampleReservation.reviewNotes}"`);
      console.log(`     - attendeeCount: ${sampleReservation.attendeeCount} (will stay)`);
      console.log(`     - specialRequirements: "${sampleReservation.specialRequirements}" (will stay)`);

      console.log('\n   roomReservationData structure:');
      if (sampleReservation.roomReservationData.requestedBy) {
        console.log('     ✅ requestedBy already exists');
      } else {
        console.log('     ❌ requestedBy needs to be created');
      }
      if (sampleReservation.roomReservationData.contactPerson) {
        console.log('     ✅ contactPerson already exists');
      } else if (sampleReservation.isOnBehalfOf) {
        console.log('     ❌ contactPerson needs to be created (isOnBehalfOf = true)');
      }
    }

    // Step 3: Count documents that need migration
    const needsMigration = await collection.countDocuments({
      roomReservationData: { $exists: true, $ne: null },
      $or: [
        { requesterName: { $exists: true } },
        { requesterEmail: { $exists: true } },
        { department: { $exists: true } },
        { phone: { $exists: true } },
        { contactName: { $exists: true } },
        { contactEmail: { $exists: true } },
        { isOnBehalfOf: { $exists: true } }
      ]
    });

    console.log(`\n📊 Documents requiring migration: ${needsMigration}`);

    if (needsMigration === 0) {
      console.log('✅ All documents are already in the correct structure!');
      return;
    }

    console.log('\n⚠️  WARNING: This migration will modify your database.');
    console.log('   Please ensure you have a backup before proceeding.\n');

    // Step 4: Perform migration in batches
    console.log('🔄 Starting migration process...\n');

    const BATCH_SIZE = 100;
    let processedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;

    // Find all reservations that need migration
    const reservationsToMigrate = await collection.find({
      roomReservationData: { $exists: true, $ne: null },
      $or: [
        { requesterName: { $exists: true } },
        { requesterEmail: { $exists: true } },
        { department: { $exists: true } },
        { phone: { $exists: true } },
        { contactName: { $exists: true } },
        { contactEmail: { $exists: true } },
        { isOnBehalfOf: { $exists: true } }
      ]
    }).toArray();

    console.log(`Found ${reservationsToMigrate.length} documents to process\n`);

    // Process in batches
    for (let i = 0; i < reservationsToMigrate.length; i += BATCH_SIZE) {
      const batch = reservationsToMigrate.slice(i, i + BATCH_SIZE);

      for (const doc of batch) {
        try {
          // Build update operations
          const updateOps = {
            $set: {},
            $unset: {}
          };

          // Build requestedBy object if top-level fields exist
          if (doc.requesterName || doc.requesterEmail || doc.department || doc.phone) {
            updateOps.$set['roomReservationData.requestedBy'] = {
              userId: doc.roomReservationData?.requestedBy?.userId || doc.createdBy || doc.userId,
              name: doc.requesterName || doc.roomReservationData?.requestedBy?.name || '',
              email: doc.requesterEmail || doc.roomReservationData?.requestedBy?.email || '',
              department: doc.department || doc.roomReservationData?.requestedBy?.department || '',
              phone: doc.phone || doc.roomReservationData?.requestedBy?.phone || ''
            };

            // Mark top-level fields for removal
            if (doc.requesterName) updateOps.$unset.requesterName = '';
            if (doc.requesterEmail) updateOps.$unset.requesterEmail = '';
            if (doc.department) updateOps.$unset.department = '';
            if (doc.phone) updateOps.$unset.phone = '';
          }

          // Build contactPerson object if isOnBehalfOf or contact info exists
          if (doc.isOnBehalfOf && (doc.contactName || doc.contactEmail)) {
            updateOps.$set['roomReservationData.contactPerson'] = {
              name: doc.contactName || doc.roomReservationData?.contactPerson?.name || '',
              email: doc.contactEmail || doc.roomReservationData?.contactPerson?.email || '',
              isOnBehalfOf: true
            };

            // Mark fields for removal
            if (doc.contactName) updateOps.$unset.contactName = '';
            if (doc.contactEmail) updateOps.$unset.contactEmail = '';
          } else if (!doc.isOnBehalfOf) {
            // Explicitly set to null if not on behalf of
            updateOps.$set['roomReservationData.contactPerson'] = null;

            // Still remove old fields if they exist
            if (doc.contactName) updateOps.$unset.contactName = '';
            if (doc.contactEmail) updateOps.$unset.contactEmail = '';
          }

          // Always remove isOnBehalfOf from top level (info is in contactPerson)
          if (doc.isOnBehalfOf !== undefined) {
            updateOps.$unset.isOnBehalfOf = '';
          }

          // Move reviewNotes into roomReservationData if it exists at top level
          if (doc.reviewNotes && !doc.roomReservationData?.reviewNotes) {
            updateOps.$set['roomReservationData.reviewNotes'] = doc.reviewNotes;
            updateOps.$unset.reviewNotes = '';
          }

          // Only update if there are changes to make
          if (Object.keys(updateOps.$set).length > 0 || Object.keys(updateOps.$unset).length > 0) {
            // Remove empty operations
            if (Object.keys(updateOps.$set).length === 0) delete updateOps.$set;
            if (Object.keys(updateOps.$unset).length === 0) delete updateOps.$unset;

            await collection.updateOne(
              { _id: doc._id },
              updateOps
            );
            updatedCount++;
          }

          processedCount++;

        } catch (error) {
          console.error(`   ❌ Error processing document ${doc._id}:`, error.message);
          errorCount++;
        }
      }

      // Progress update
      console.log(`   Progress: ${processedCount}/${reservationsToMigrate.length} documents processed (${updatedCount} updated)`);

      // Add delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < reservationsToMigrate.length) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      }
    }

    console.log(`\n✅ Migration completed!`);
    console.log(`   Documents processed: ${processedCount}`);
    console.log(`   Documents updated: ${updatedCount}`);
    console.log(`   Errors: ${errorCount}\n`);

    // Step 5: Verify migration results
    console.log('🔍 Verifying migration results...\n');

    const afterMigration = {
      withRequestedBy: await collection.countDocuments({
        'roomReservationData.requestedBy': { $exists: true }
      }),
      withContactPerson: await collection.countDocuments({
        'roomReservationData.contactPerson': { $exists: true, $ne: null }
      }),
      withOldRequesterName: await collection.countDocuments({
        roomReservationData: { $exists: true },
        requesterName: { $exists: true }
      }),
      withOldContactName: await collection.countDocuments({
        roomReservationData: { $exists: true },
        contactName: { $exists: true }
      })
    };

    console.log('📊 Post-migration statistics:');
    console.log(`   Reservations with requestedBy: ${afterMigration.withRequestedBy}`);
    console.log(`   Reservations with contactPerson: ${afterMigration.withContactPerson}`);
    console.log(`   Reservations still with old requesterName: ${afterMigration.withOldRequesterName}`);
    console.log(`   Reservations still with old contactName: ${afterMigration.withOldContactName}\n`);

    // Show sample after migration
    const sampleAfter = await collection.findOne({
      'roomReservationData.requestedBy': { $exists: true }
    });

    if (sampleAfter) {
      console.log('📄 Sample document structure (after migration):');
      console.log('   roomReservationData.requestedBy:');
      console.log(`     - name: "${sampleAfter.roomReservationData.requestedBy.name}"`);
      console.log(`     - email: "${sampleAfter.roomReservationData.requestedBy.email}"`);
      console.log(`     - department: "${sampleAfter.roomReservationData.requestedBy.department}"`);
      console.log(`     - phone: "${sampleAfter.roomReservationData.requestedBy.phone}"`);

      if (sampleAfter.roomReservationData.contactPerson) {
        console.log('\n   roomReservationData.contactPerson:');
        console.log(`     - name: "${sampleAfter.roomReservationData.contactPerson.name}"`);
        console.log(`     - email: "${sampleAfter.roomReservationData.contactPerson.email}"`);
        console.log(`     - isOnBehalfOf: ${sampleAfter.roomReservationData.contactPerson.isOnBehalfOf}`);
      }

      console.log('\n   Top-level fields (operational data):');
      console.log(`     - attendeeCount: ${sampleAfter.attendeeCount}`);
      console.log(`     - specialRequirements: "${sampleAfter.specialRequirements}"`);
      console.log(`     - setupTime: "${sampleAfter.setupTime}"`);
      console.log(`     - teardownTime: "${sampleAfter.teardownTime}"`);
    }

    if (afterMigration.withOldRequesterName === 0 && afterMigration.withOldContactName === 0) {
      console.log('\n✅ SUCCESS: All room reservation data has been reorganized!');
    } else {
      console.log('\n⚠️  WARNING: Some documents still have old top-level fields.');
      console.log('   This may be expected if they also have the new structure.');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n🔌 MongoDB connection closed');
  }
}

// Run migration
migrateRoomReservationData()
  .then(() => {
    console.log('\n✅ Migration script completed successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
