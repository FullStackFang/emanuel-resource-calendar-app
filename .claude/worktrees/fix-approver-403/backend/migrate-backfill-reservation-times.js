#!/usr/bin/env node
/**
 * Migration: Backfill reservationStartTime/reservationEndTime from startTime/endTime
 *
 * After making reservation times required, existing records that only had
 * event startTime/endTime (no reservationStartTime/reservationEndTime) fail validation.
 * This copies startTime → reservationStartTime and endTime → reservationEndTime
 * for any record missing reservation times.
 *
 * Safe and idempotent — skips docs where reservationStartTime/reservationEndTime already set.
 *
 * Usage:
 *   node migrate-backfill-reservation-times.js --dry-run    # Preview changes
 *   node migrate-backfill-reservation-times.js              # Apply changes
 *   node migrate-backfill-reservation-times.js --verify     # Verify results
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION = 'templeEvents__Events';
const BATCH_SIZE = 100;

const isDryRun = process.argv.includes('--dry-run');
const isVerify = process.argv.includes('--verify');

async function processBatch(collection, batch) {
  const bulkOps = batch.map(doc => {
    const cd = doc.calendarData || {};
    const setFields = {};

    if (!cd.reservationStartTime || cd.reservationStartTime === '') {
      setFields['calendarData.reservationStartTime'] = cd.startTime || '';
    }
    if (!cd.reservationEndTime || cd.reservationEndTime === '') {
      setFields['calendarData.reservationEndTime'] = cd.endTime || '';
    }

    return {
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: setFields }
      }
    };
  });

  const result = await collection.bulkWrite(bulkOps);
  return result.modifiedCount;
}

async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION);

    console.log('\nMigration: Backfill reservationStartTime/reservationEndTime from startTime/endTime');
    console.log(`   Database: ${DB_NAME}`);
    console.log(`   Collection: ${COLLECTION}`);
    console.log(`   Mode: ${isDryRun ? 'DRY RUN' : isVerify ? 'VERIFY' : 'APPLY'}\n`);

    // Get counts for reporting
    const totalDocs = await collection.countDocuments();
    const withStartTime = await collection.countDocuments({
      'calendarData.startTime': { $exists: true, $nin: ['', null] }
    });
    const withEndTime = await collection.countDocuments({
      'calendarData.endTime': { $exists: true, $nin: ['', null] }
    });
    const withResStart = await collection.countDocuments({
      'calendarData.reservationStartTime': { $exists: true, $nin: ['', null] }
    });
    const withResEnd = await collection.countDocuments({
      'calendarData.reservationEndTime': { $exists: true, $nin: ['', null] }
    });

    console.log(`   Total documents: ${totalDocs}`);
    console.log(`   With calendarData.startTime (non-empty): ${withStartTime}`);
    console.log(`   With calendarData.endTime (non-empty): ${withEndTime}`);
    console.log(`   With calendarData.reservationStartTime (non-empty): ${withResStart}`);
    console.log(`   With calendarData.reservationEndTime (non-empty): ${withResEnd}\n`);

    if (isVerify) {
      // Count records that have startTime/endTime but still missing reservation times
      const missingResStart = await collection.countDocuments({
        'calendarData.startTime': { $exists: true, $nin: ['', null] },
        $or: [
          { 'calendarData.reservationStartTime': { $exists: false } },
          { 'calendarData.reservationStartTime': { $in: ['', null] } }
        ]
      });
      const missingResEnd = await collection.countDocuments({
        'calendarData.endTime': { $exists: true, $nin: ['', null] },
        $or: [
          { 'calendarData.reservationEndTime': { $exists: false } },
          { 'calendarData.reservationEndTime': { $in: ['', null] } }
        ]
      });

      console.log('   Verification Results:');
      console.log(`   With reservationStartTime (non-empty): ${withResStart}`);
      console.log(`   With reservationEndTime (non-empty): ${withResEnd}`);
      console.log(`   Have startTime but missing reservationStartTime: ${missingResStart}`);
      console.log(`   Have endTime but missing reservationEndTime: ${missingResEnd}`);

      if (missingResStart === 0 && missingResEnd === 0) {
        console.log('\n   Migration complete! All records with event times have reservation times.\n');
      } else {
        console.log(`\n   ${missingResStart + missingResEnd} record(s) still need backfill.\n`);
      }
      return;
    }

    // Query for events that need backfill:
    // - Has non-empty startTime or endTime
    // - AND is missing reservationStartTime or reservationEndTime
    const query = {
      $and: [
        {
          $or: [
            { 'calendarData.startTime': { $exists: true, $nin: ['', null] } },
            { 'calendarData.endTime': { $exists: true, $nin: ['', null] } }
          ]
        },
        {
          $or: [
            { 'calendarData.reservationStartTime': { $exists: false } },
            { 'calendarData.reservationStartTime': { $in: ['', null] } },
            { 'calendarData.reservationEndTime': { $exists: false } },
            { 'calendarData.reservationEndTime': { $in: ['', null] } }
          ]
        }
      ]
    };

    const totalToMigrate = await collection.countDocuments(query);
    console.log(`   Documents to migrate: ${totalToMigrate}\n`);

    if (totalToMigrate === 0) {
      console.log('   No documents need migration.\n');
      return;
    }

    // Show samples in dry run
    if (isDryRun) {
      const samples = await collection.find(query).limit(5)
        .project({ 'calendarData.eventTitle': 1, 'calendarData.startTime': 1, 'calendarData.endTime': 1, 'calendarData.reservationStartTime': 1, 'calendarData.reservationEndTime': 1, eventTitle: 1, status: 1 })
        .toArray();
      console.log(`   Sample documents (first ${samples.length}):`);
      for (const doc of samples) {
        const cd = doc.calendarData || {};
        const title = cd.eventTitle || doc.eventTitle || 'Untitled';
        const resStartExists = cd.reservationStartTime && cd.reservationStartTime !== '';
        const resEndExists = cd.reservationEndTime && cd.reservationEndTime !== '';
        console.log(`     - "${title}" (${doc._id}) [status: ${doc.status || 'unknown'}]`);
        if (!resStartExists && cd.startTime) {
          console.log(`       startTime '${cd.startTime}' -> reservationStartTime`);
        }
        if (!resEndExists && cd.endTime) {
          console.log(`       endTime '${cd.endTime}' -> reservationEndTime`);
        }
      }
      console.log(`\n   Would migrate ${totalToMigrate} documents. Run without --dry-run to apply.\n`);
      return;
    }

    // Stream through cursor in batches — no bulk toArray() call
    let migratedCount = 0;
    let processed = 0;
    let batch = [];

    const cursor = collection.find(query).project({
      _id: 1,
      'calendarData.startTime': 1,
      'calendarData.endTime': 1,
      'calendarData.reservationStartTime': 1,
      'calendarData.reservationEndTime': 1
    });

    for await (const doc of cursor) {
      batch.push(doc);

      if (batch.length >= BATCH_SIZE) {
        migratedCount += await processBatch(collection, batch);
        processed += batch.length;
        batch = [];

        const percent = Math.round((processed / totalToMigrate) * 100);
        process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${totalToMigrate})`);

        // Rate limit delay between batches
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Process remaining docs
    if (batch.length > 0) {
      migratedCount += await processBatch(collection, batch);
      processed += batch.length;
      process.stdout.write(`\r   [Progress] 100% (${processed}/${totalToMigrate})`);
    }

    console.log(`\n   Migrated: ${migratedCount} documents\n`);

    // Post-migration verification
    const postResStart = await collection.countDocuments({
      'calendarData.reservationStartTime': { $exists: true, $nin: ['', null] }
    });
    const postResEnd = await collection.countDocuments({
      'calendarData.reservationEndTime': { $exists: true, $nin: ['', null] }
    });
    const stillMissing = await collection.countDocuments({
      $and: [
        {
          $or: [
            { 'calendarData.startTime': { $exists: true, $nin: ['', null] } },
            { 'calendarData.endTime': { $exists: true, $nin: ['', null] } }
          ]
        },
        {
          $or: [
            { 'calendarData.reservationStartTime': { $exists: false } },
            { 'calendarData.reservationStartTime': { $in: ['', null] } },
            { 'calendarData.reservationEndTime': { $exists: false } },
            { 'calendarData.reservationEndTime': { $in: ['', null] } }
          ]
        }
      ]
    });

    console.log('   Post-migration:');
    console.log(`   With reservationStartTime (non-empty): ${postResStart}`);
    console.log(`   With reservationEndTime (non-empty): ${postResEnd}`);
    console.log(`   Still missing reservation times: ${stillMissing}`);

    if (stillMissing === 0) {
      console.log('\n   Migration complete!\n');
    } else {
      console.log(`\n   ${stillMissing} documents still missing reservation times.\n`);
    }

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
