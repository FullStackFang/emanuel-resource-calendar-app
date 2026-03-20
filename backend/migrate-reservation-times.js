#!/usr/bin/env node
/**
 * Migration: Rename setupTime/teardownTime to reservationStartTime/reservationEndTime
 *
 * What this does:
 * 1. Copies calendarData.setupTime → calendarData.reservationStartTime
 * 2. Copies calendarData.teardownTime → calendarData.reservationEndTime
 * 3. Copies calendarData.setupTimeMinutes → calendarData.reservationStartMinutes
 * 4. Copies calendarData.teardownTimeMinutes → calendarData.reservationEndMinutes
 * 5. Clears old fields: setupTime → '', teardownTime → '', setupTimeMinutes → 0, teardownTimeMinutes → 0
 *
 * Safe and idempotent — skips docs where reservationStartTime/reservationEndTime already set.
 *
 * Usage:
 *   node migrate-reservation-times.js --dry-run    # Preview changes
 *   node migrate-reservation-times.js              # Apply changes
 *   node migrate-reservation-times.js --verify     # Verify results
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION = 'templeEvents__Events';
const BATCH_SIZE = 100;

const isDryRun = process.argv.includes('--dry-run');
const isVerify = process.argv.includes('--verify');

async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION);

    console.log(`\nMigration: Rename setupTime/teardownTime to reservationStartTime/reservationEndTime`);
    console.log(`   Database: ${DB_NAME}`);
    console.log(`   Collection: ${COLLECTION}`);
    console.log(`   Mode: ${isDryRun ? 'DRY RUN' : isVerify ? 'VERIFY' : 'APPLY'}\n`);

    // Get counts for reporting
    const totalDocs = await collection.countDocuments();
    const withSetupTime = await collection.countDocuments({
      'calendarData.setupTime': { $exists: true, $nin: ['', null] }
    });
    const withTeardownTime = await collection.countDocuments({
      'calendarData.teardownTime': { $exists: true, $nin: ['', null] }
    });
    const withSetupMinutes = await collection.countDocuments({
      'calendarData.setupTimeMinutes': { $gt: 0 }
    });
    const withTeardownMinutes = await collection.countDocuments({
      'calendarData.teardownTimeMinutes': { $gt: 0 }
    });
    const alreadyMigrated = await collection.countDocuments({
      $or: [
        { 'calendarData.reservationStartTime': { $exists: true, $nin: ['', null] } },
        { 'calendarData.reservationEndTime': { $exists: true, $nin: ['', null] } }
      ]
    });

    console.log(`   Total documents: ${totalDocs}`);
    console.log(`   With calendarData.setupTime (non-empty): ${withSetupTime}`);
    console.log(`   With calendarData.teardownTime (non-empty): ${withTeardownTime}`);
    console.log(`   With calendarData.setupTimeMinutes (> 0): ${withSetupMinutes}`);
    console.log(`   With calendarData.teardownTimeMinutes (> 0): ${withTeardownMinutes}`);
    console.log(`   Already migrated (reservationStartTime/EndTime set): ${alreadyMigrated}\n`);

    if (isVerify) {
      const remainingSetup = await collection.countDocuments({
        'calendarData.setupTime': { $exists: true, $nin: ['', null] }
      });
      const remainingTeardown = await collection.countDocuments({
        'calendarData.teardownTime': { $exists: true, $nin: ['', null] }
      });
      const remainingSetupMin = await collection.countDocuments({
        'calendarData.setupTimeMinutes': { $gt: 0 }
      });
      const remainingTeardownMin = await collection.countDocuments({
        'calendarData.teardownTimeMinutes': { $gt: 0 }
      });
      const withNewStart = await collection.countDocuments({
        'calendarData.reservationStartTime': { $exists: true, $nin: ['', null] }
      });
      const withNewEnd = await collection.countDocuments({
        'calendarData.reservationEndTime': { $exists: true, $nin: ['', null] }
      });

      console.log('   Verification Results:');
      console.log(`   With reservationStartTime (non-empty): ${withNewStart}`);
      console.log(`   With reservationEndTime (non-empty): ${withNewEnd}`);
      console.log(`   Remaining setupTime (non-empty): ${remainingSetup}`);
      console.log(`   Remaining teardownTime (non-empty): ${remainingTeardown}`);
      console.log(`   Remaining setupTimeMinutes (> 0): ${remainingSetupMin}`);
      console.log(`   Remaining teardownTimeMinutes (> 0): ${remainingTeardownMin}`);

      if (remainingSetup === 0 && remainingTeardown === 0 && remainingSetupMin === 0 && remainingTeardownMin === 0) {
        console.log('\n   Migration complete! All old fields have been cleared.');
      } else {
        console.log(`\n   ${remainingSetup + remainingTeardown + remainingSetupMin + remainingTeardownMin} field(s) still have old values.`);
      }
      return;
    }

    // Find events that need migration:
    // - Has non-empty setupTime or teardownTime, OR setupTimeMinutes > 0, OR teardownTimeMinutes > 0
    // - AND does NOT already have reservationStartTime or reservationEndTime set (idempotent)
    const docsToMigrate = await collection.find({
      $and: [
        {
          $or: [
            { 'calendarData.setupTime': { $exists: true, $nin: ['', null] } },
            { 'calendarData.teardownTime': { $exists: true, $nin: ['', null] } },
            { 'calendarData.setupTimeMinutes': { $gt: 0 } },
            { 'calendarData.teardownTimeMinutes': { $gt: 0 } }
          ]
        },
        {
          $and: [
            { $or: [
              { 'calendarData.reservationStartTime': { $exists: false } },
              { 'calendarData.reservationStartTime': { $in: ['', null] } }
            ]},
            { $or: [
              { 'calendarData.reservationEndTime': { $exists: false } },
              { 'calendarData.reservationEndTime': { $in: ['', null] } }
            ]}
          ]
        }
      ]
    }).toArray();

    console.log(`   Documents to migrate: ${docsToMigrate.length}\n`);

    if (docsToMigrate.length === 0) {
      console.log('   No documents need migration. All already migrated or no old fields found.\n');
      return;
    }

    // Show samples in dry run
    if (isDryRun) {
      const sampleCount = Math.min(5, docsToMigrate.length);
      console.log(`   Sample documents (first ${sampleCount}):`);
      for (let s = 0; s < sampleCount; s++) {
        const doc = docsToMigrate[s];
        const cd = doc.calendarData || {};
        const title = cd.eventTitle || doc.eventTitle || 'Untitled';
        console.log(`     - "${title}" (${doc._id})`);
        if (cd.setupTime) console.log(`       setupTime: '${cd.setupTime}' -> reservationStartTime`);
        if (cd.teardownTime) console.log(`       teardownTime: '${cd.teardownTime}' -> reservationEndTime`);
        if (cd.setupTimeMinutes > 0) console.log(`       setupTimeMinutes: ${cd.setupTimeMinutes} -> reservationStartMinutes`);
        if (cd.teardownTimeMinutes > 0) console.log(`       teardownTimeMinutes: ${cd.teardownTimeMinutes} -> reservationEndMinutes`);
      }
      console.log(`\n   Would migrate ${docsToMigrate.length} documents. Run without --dry-run to apply.\n`);
      return;
    }

    // Process in batches using bulkWrite (each doc has different values to copy)
    let migratedCount = 0;

    for (let i = 0; i < docsToMigrate.length; i += BATCH_SIZE) {
      const batch = docsToMigrate.slice(i, i + BATCH_SIZE);

      const bulkOps = batch.map(doc => {
        const cd = doc.calendarData || {};
        return {
          updateOne: {
            filter: { _id: doc._id },
            update: {
              $set: {
                'calendarData.reservationStartTime': cd.setupTime || '',
                'calendarData.reservationEndTime': cd.teardownTime || '',
                'calendarData.reservationStartMinutes': cd.setupTimeMinutes || 0,
                'calendarData.reservationEndMinutes': cd.teardownTimeMinutes || 0,
                'calendarData.setupTime': '',
                'calendarData.teardownTime': '',
                'calendarData.setupTimeMinutes': 0,
                'calendarData.teardownTimeMinutes': 0
              }
            }
          }
        };
      });

      const result = await collection.bulkWrite(bulkOps);
      migratedCount += result.modifiedCount;

      // Progress bar
      const processed = Math.min(i + BATCH_SIZE, docsToMigrate.length);
      const percent = Math.round((processed / docsToMigrate.length) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${docsToMigrate.length})`);

      // Rate limit delay between batches
      if (i + BATCH_SIZE < docsToMigrate.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`\n   Migrated: ${migratedCount} documents\n`);

    // Post-migration verification
    const remainingOld = await collection.countDocuments({
      $or: [
        { 'calendarData.setupTime': { $exists: true, $nin: ['', null] } },
        { 'calendarData.teardownTime': { $exists: true, $nin: ['', null] } },
        { 'calendarData.setupTimeMinutes': { $gt: 0 } },
        { 'calendarData.teardownTimeMinutes': { $gt: 0 } }
      ]
    });
    const newStartCount = await collection.countDocuments({
      'calendarData.reservationStartTime': { $exists: true, $nin: ['', null] }
    });
    const newEndCount = await collection.countDocuments({
      'calendarData.reservationEndTime': { $exists: true, $nin: ['', null] }
    });

    console.log(`   Post-migration:`);
    console.log(`   With reservationStartTime (non-empty): ${newStartCount}`);
    console.log(`   With reservationEndTime (non-empty): ${newEndCount}`);
    console.log(`   Remaining with old fields (non-empty): ${remainingOld}`);

    if (remainingOld === 0) {
      console.log('\n   Migration complete!\n');
    } else {
      console.log(`\n   ${remainingOld} documents still have old field values.\n`);
    }

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
