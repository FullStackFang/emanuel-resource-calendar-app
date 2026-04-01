#!/usr/bin/env node
/**
 * Migration: Remove internalData from templeEvents__Events
 *
 * Phase 1 of Event Data Architecture Cleanup.
 *
 * What this does:
 * 1. For each document with internalData:
 *    a. Moves unique fields (registrationNotes, staffAssignments, setupStatus,
 *       estimatedCost, actualCost, customFields, rsId, etc.) into calendarData
 *       (only if not already present there)
 *    b. Maps renamed fields: mecCategories → categories, setupMinutes → setupTimeMinutes,
 *       teardownMinutes → teardownTimeMinutes, internalNotes → eventNotes
 *    c. $unsets the internalData field
 *
 * 2. Safe and idempotent — skips docs without internalData, doesn't overwrite
 *    existing calendarData values
 *
 * Usage:
 *   node migrate-remove-internal-data.js --dry-run    # Preview changes
 *   node migrate-remove-internal-data.js              # Apply changes
 *   node migrate-remove-internal-data.js --verify     # Verify results
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION_NAME = 'templeEvents__Events';
const BATCH_SIZE = 100;

// Fields to move from internalData to calendarData
// Format: { internalDataField: calendarDataField }
const FIELD_MAP = {
  // Fields that are renamed
  mecCategories: 'categories',
  setupMinutes: 'setupTimeMinutes',
  teardownMinutes: 'teardownTimeMinutes',
  internalNotes: 'eventNotes',

  // Fields that keep the same name
  registrationNotes: 'registrationNotes',
  staffAssignments: 'staffAssignments',
  setupStatus: 'setupStatus',
  estimatedCost: 'estimatedCost',
  actualCost: 'actualCost',
  customFields: 'customFields',

  // CSV import fields
  rsId: 'rsId',
  rsEventCode: 'rsEventCode',
  rsStartDate: 'rsStartDate',
  rsStartTime: 'rsStartTime',
  rsEndDate: 'rsEndDate',
  rsEndTime: 'rsEndTime',
  rsImportSource: 'rsImportSource',
  rsImportedAt: 'rsImportedAt',
  rsImportSessionId: 'rsImportSessionId',
  createRegistrationEvent: 'createRegistrationEvent',
  isCSVImport: 'isCSVImport',
  isRegistrationEvent: 'isRegistrationEvent',
  linkedMainEventId: 'linkedMainEventId',
  importedAt: 'importedAt',

  // Other enrichment fields
  assignedTo: 'assignedTo',
  setupTime: 'setupTime',
  teardownTime: 'teardownTime',
  doorOpenTime: 'doorOpenTime',
  doorCloseTime: 'doorCloseTime',
  setupNotes: 'setupNotes',
  doorNotes: 'doorNotes',
  eventNotes: 'eventNotes',
  recurrence: 'recurrence',

  // Requester fields from CSV imports
  requesterName: 'requesterName',
  requesterEmail: 'requesterEmail',
  requesterID: 'requesterID',
  attendeeCount: 'attendeeCount',
  isRecurring: 'isRecurring',

  // Other metadata
  lastModifiedBy: 'lastModifiedBy',
  lastModifiedAt: 'lastModifiedAt',
  lastModifiedReason: 'lastModifiedReason',
};

const isDryRun = process.argv.includes('--dry-run');
const isVerify = process.argv.includes('--verify');

async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    console.log(`\n📋 Migration: Remove internalData from ${COLLECTION_NAME}`);
    console.log(`   Database: ${DB_NAME}`);
    console.log(`   Mode: ${isDryRun ? '🔍 DRY RUN' : isVerify ? '✅ VERIFY' : '🔧 APPLY'}\n`);

    // Get counts
    const totalDocs = await collection.countDocuments();
    const docsWithInternalData = await collection.countDocuments({
      internalData: { $exists: true }
    });
    const docsWithoutInternalData = await collection.countDocuments({
      internalData: { $exists: false }
    });
    const docsWithCalendarData = await collection.countDocuments({
      calendarData: { $exists: true }
    });

    console.log(`   Total documents: ${totalDocs}`);
    console.log(`   With internalData: ${docsWithInternalData}`);
    console.log(`   Without internalData: ${docsWithoutInternalData}`);
    console.log(`   With calendarData: ${docsWithCalendarData}\n`);

    if (isVerify) {
      if (docsWithInternalData === 0) {
        console.log('   ✅ Migration complete! No documents have internalData.');
      } else {
        console.log(`   ⚠️  ${docsWithInternalData} documents still have internalData.`);
        // Show sample
        const sample = await collection.findOne({ internalData: { $exists: true } });
        if (sample) {
          console.log(`   Sample document eventId: ${sample.eventId}`);
          console.log(`   internalData keys: ${Object.keys(sample.internalData || {}).join(', ')}`);
        }
      }
      return;
    }

    if (docsWithInternalData === 0) {
      console.log('   No documents with internalData found. Nothing to migrate.\n');
      return;
    }

    // Process in batches
    const docsToProcess = await collection.find({
      internalData: { $exists: true }
    }).toArray();

    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < docsToProcess.length; i += BATCH_SIZE) {
      const batch = docsToProcess.slice(i, i + BATCH_SIZE);

      for (const doc of batch) {
        try {
          const internalData = doc.internalData || {};
          const calendarData = doc.calendarData || {};

          // Build $set operations: move fields that don't already exist in calendarData
          const setOps = {};
          let fieldsMovedCount = 0;

          for (const [srcField, destField] of Object.entries(FIELD_MAP)) {
            if (srcField in internalData && internalData[srcField] !== undefined && internalData[srcField] !== null) {
              // Only set if not already in calendarData (don't overwrite)
              if (!(destField in calendarData) || calendarData[destField] === undefined || calendarData[destField] === null) {
                // Don't move empty arrays or empty strings (they're just defaults)
                const value = internalData[srcField];
                if (Array.isArray(value) && value.length === 0) continue;
                if (value === '' || value === 0) continue;

                setOps[`calendarData.${destField}`] = value;
                fieldsMovedCount++;
              }
            }
          }

          if (isDryRun) {
            migratedCount++;
          } else {
            // Apply: move fields + unset internalData
            const updateOps = { $unset: { internalData: '' } };
            if (Object.keys(setOps).length > 0) {
              updateOps.$set = setOps;
            }

            await collection.updateOne({ _id: doc._id }, updateOps);
            migratedCount++;
          }
        } catch (err) {
          console.error(`   ❌ Error processing ${doc.eventId}: ${err.message}`);
          errorCount++;
        }
      }

      // Progress bar
      const processed = Math.min(i + BATCH_SIZE, docsToProcess.length);
      const percent = Math.round((processed / docsToProcess.length) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${docsToProcess.length})`);

      // Rate limit delay between batches
      if (!isDryRun && i + BATCH_SIZE < docsToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log('\n');
    console.log(`   ${isDryRun ? 'Would migrate' : 'Migrated'}: ${migratedCount}`);
    console.log(`   Skipped: ${skippedCount}`);
    console.log(`   Errors: ${errorCount}`);

    if (!isDryRun) {
      // Verify
      const remaining = await collection.countDocuments({
        internalData: { $exists: true }
      });
      console.log(`\n   Remaining with internalData: ${remaining}`);
      if (remaining === 0) {
        console.log('   ✅ Migration complete!');
      }
    }

    console.log('');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
