#!/usr/bin/env node
/**
 * Migration: Deduplicate requester info in templeEvents__Events
 *
 * Phase 3 of Event Data Architecture Cleanup.
 *
 * What this does:
 * 1. For events with roomReservationData but missing requestedBy:
 *    - Creates requestedBy from calendarData requester fields
 * 2. For events with roomReservationData.requestedBy:
 *    - Moves department/phone from flat roomReservationData into requestedBy (if missing)
 * 3. Removes requester fields from calendarData:
 *    - $unsets calendarData.requesterName, calendarData.requesterEmail,
 *      calendarData.department, calendarData.phone
 *
 * Safe and idempotent — skips events without roomReservationData (CSV imports etc.)
 *
 * Usage:
 *   node migrate-deduplicate-requester-info.js --dry-run    # Preview changes
 *   node migrate-deduplicate-requester-info.js              # Apply changes
 *   node migrate-deduplicate-requester-info.js --verify     # Verify results
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION_NAME = 'templeEvents__Events';
const BATCH_SIZE = 100;

const isDryRun = process.argv.includes('--dry-run');
const isVerify = process.argv.includes('--verify');

async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    console.log(`\n📋 Migration: Deduplicate requester info in ${COLLECTION_NAME}`);
    console.log(`   Database: ${DB_NAME}`);
    console.log(`   Mode: ${isDryRun ? '🔍 DRY RUN' : isVerify ? '✅ VERIFY' : '🔧 APPLY'}\n`);

    // Get counts
    const totalDocs = await collection.countDocuments();
    const docsWithRoomRes = await collection.countDocuments({
      roomReservationData: { $exists: true, $ne: null }
    });
    const docsWithRequestedBy = await collection.countDocuments({
      'roomReservationData.requestedBy': { $exists: true }
    });
    const docsWithCalRequester = await collection.countDocuments({
      'calendarData.requesterEmail': { $exists: true }
    });
    const docsNeedingRequestedBy = await collection.countDocuments({
      roomReservationData: { $exists: true, $ne: null },
      'roomReservationData.requestedBy': { $exists: false },
      'calendarData.requesterEmail': { $exists: true }
    });

    console.log(`   Total documents: ${totalDocs}`);
    console.log(`   With roomReservationData: ${docsWithRoomRes}`);
    console.log(`   With requestedBy nested: ${docsWithRequestedBy}`);
    console.log(`   With calendarData.requesterEmail: ${docsWithCalRequester}`);
    console.log(`   Needing requestedBy creation: ${docsNeedingRequestedBy}\n`);

    if (isVerify) {
      const remaining = await collection.countDocuments({
        roomReservationData: { $exists: true, $ne: null },
        'calendarData.requesterEmail': { $exists: true }
      });
      if (remaining === 0) {
        console.log('   ✅ Migration complete! No room reservations have calendarData.requesterEmail.');
      } else {
        console.log(`   ⚠️  ${remaining} room reservation events still have calendarData.requesterEmail.`);
      }
      return;
    }

    // Step 1: Create requestedBy for events that have roomReservationData but no requestedBy
    if (docsNeedingRequestedBy > 0) {
      console.log(`   Step 1: Creating requestedBy for ${docsNeedingRequestedBy} events...`);
      const docsToFix = await collection.find({
        roomReservationData: { $exists: true, $ne: null },
        'roomReservationData.requestedBy': { $exists: false },
        'calendarData.requesterEmail': { $exists: true }
      }).toArray();

      let fixedCount = 0;
      for (let i = 0; i < docsToFix.length; i += BATCH_SIZE) {
        const batch = docsToFix.slice(i, i + BATCH_SIZE);
        for (const doc of batch) {
          const cd = doc.calendarData || {};
          const rrd = doc.roomReservationData || {};
          const requestedBy = {
            userId: doc.createdBy || doc.requesterId || '',
            name: cd.requesterName || rrd.requesterName || doc.createdByName || '',
            email: cd.requesterEmail || rrd.requesterEmail || doc.createdByEmail || '',
            department: cd.department || rrd.department || '',
            phone: cd.phone || rrd.phone || ''
          };

          if (!isDryRun) {
            await collection.updateOne({ _id: doc._id }, {
              $set: { 'roomReservationData.requestedBy': requestedBy }
            });
          }
          fixedCount++;
        }

        const processed = Math.min(i + BATCH_SIZE, docsToFix.length);
        const percent = Math.round((processed / docsToFix.length) * 100);
        process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${docsToFix.length})`);

        if (!isDryRun && i + BATCH_SIZE < docsToFix.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      console.log(`\n   ${isDryRun ? 'Would create' : 'Created'} requestedBy: ${fixedCount}`);
    }

    // Step 2: Move flat department/phone into requestedBy (if not already there)
    const docsWithFlatDept = await collection.find({
      'roomReservationData.department': { $exists: true },
      'roomReservationData.requestedBy': { $exists: true },
      'roomReservationData.requestedBy.department': { $exists: false }
    }).toArray();

    if (docsWithFlatDept.length > 0) {
      console.log(`   Step 2: Moving flat department/phone into requestedBy for ${docsWithFlatDept.length} events...`);
      let movedCount = 0;
      for (let i = 0; i < docsWithFlatDept.length; i += BATCH_SIZE) {
        const batch = docsWithFlatDept.slice(i, i + BATCH_SIZE);
        for (const doc of batch) {
          if (!isDryRun) {
            const rrd = doc.roomReservationData || {};
            const setOps = {};
            if (rrd.department) setOps['roomReservationData.requestedBy.department'] = rrd.department;
            if (rrd.phone) setOps['roomReservationData.requestedBy.phone'] = rrd.phone;
            if (Object.keys(setOps).length > 0) {
              await collection.updateOne({ _id: doc._id }, {
                $set: setOps,
                $unset: {
                  'roomReservationData.department': '',
                  'roomReservationData.phone': ''
                }
              });
            }
          }
          movedCount++;
        }

        const processed = Math.min(i + BATCH_SIZE, docsWithFlatDept.length);
        const percent = Math.round((processed / docsWithFlatDept.length) * 100);
        process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${docsWithFlatDept.length})`);

        if (!isDryRun && i + BATCH_SIZE < docsWithFlatDept.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      console.log(`\n   ${isDryRun ? 'Would move' : 'Moved'} dept/phone: ${movedCount}`);
    }

    // Step 3: Remove requester fields from calendarData (for room reservation events only)
    const docsToClean = await collection.find({
      roomReservationData: { $exists: true, $ne: null },
      $or: [
        { 'calendarData.requesterName': { $exists: true } },
        { 'calendarData.requesterEmail': { $exists: true } },
        { 'calendarData.department': { $exists: true } },
        { 'calendarData.phone': { $exists: true } }
      ]
    }).toArray();

    if (docsToClean.length > 0) {
      console.log(`   Step 3: Removing calendarData requester fields from ${docsToClean.length} events...`);
      let cleanedCount = 0;
      for (let i = 0; i < docsToClean.length; i += BATCH_SIZE) {
        const batch = docsToClean.slice(i, i + BATCH_SIZE);

        if (isDryRun) {
          cleanedCount += batch.length;
        } else {
          const result = await collection.updateMany(
            { _id: { $in: batch.map(d => d._id) } },
            {
              $unset: {
                'calendarData.requesterName': '',
                'calendarData.requesterEmail': '',
                'calendarData.department': '',
                'calendarData.phone': ''
              }
            }
          );
          cleanedCount += result.modifiedCount;
        }

        const processed = Math.min(i + BATCH_SIZE, docsToClean.length);
        const percent = Math.round((processed / docsToClean.length) * 100);
        process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${docsToClean.length})`);

        if (!isDryRun && i + BATCH_SIZE < docsToClean.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      console.log(`\n   ${isDryRun ? 'Would clean' : 'Cleaned'}: ${cleanedCount}`);
    } else {
      console.log('   Step 3: No calendarData requester fields to clean.');
    }

    if (!isDryRun) {
      const remaining = await collection.countDocuments({
        roomReservationData: { $exists: true, $ne: null },
        'calendarData.requesterEmail': { $exists: true }
      });
      console.log(`\n   Remaining with calendarData.requesterEmail: ${remaining}`);
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
