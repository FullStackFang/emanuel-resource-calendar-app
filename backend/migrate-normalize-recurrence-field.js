// migrate-normalize-recurrence-field.js
// Migration script to normalize recurrence to top-level field only.
//
// Before: recurrence data may exist at top-level `recurrence` OR `calendarData.recurrence`
// After: recurrence data always at top-level `recurrence`; `calendarData.recurrence` removed
//
// This eliminates the dual-location pattern that required $or queries and || fallbacks.
//
// Run with:
//   node migrate-normalize-recurrence-field.js --dry-run    # Preview changes
//   node migrate-normalize-recurrence-field.js              # Apply changes
//   node migrate-normalize-recurrence-field.js --verify     # Verify results

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';
const BATCH_SIZE = 100;

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isVerify = args.includes('--verify');

async function migrate() {
  const mode = isDryRun ? 'DRY RUN' : (isVerify ? 'VERIFY' : 'APPLY');
  console.log(`\n===============================================`);
  console.log(`  Migration: Normalize recurrence to top-level`);
  console.log(`  Mode: ${mode}`);
  console.log(`===============================================\n`);

  if (!MONGODB_URI) {
    console.error('Error: MONGODB_CONNECTION_STRING or MONGODB_URI is not defined in .env file');
    process.exit(1);
  }

  console.log('Configuration:');
  console.log(`   Database Name: ${DB_NAME}`);
  console.log(`   MongoDB URI: ${MONGODB_URI.substring(0, 30)}...`);
  console.log(`   Batch Size: ${BATCH_SIZE}\n`);

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const collection = db.collection('templeEvents__Events');

    if (isVerify) {
      await verify(collection);
      return;
    }

    // --- STATISTICS ---
    console.log('--- Current State ---\n');

    const totalDocs = await collection.countDocuments({});
    const hasTopLevel = await collection.countDocuments({
      recurrence: { $exists: true, $ne: null }
    });
    const hasCalendarDataOnly = await collection.countDocuments({
      recurrence: { $in: [null, undefined] },
      'calendarData.recurrence': { $exists: true, $ne: null }
    });
    const hasBoth = await collection.countDocuments({
      recurrence: { $exists: true, $ne: null },
      'calendarData.recurrence': { $exists: true, $ne: null }
    });
    const hasCalendarDataAny = await collection.countDocuments({
      'calendarData.recurrence': { $exists: true, $ne: null }
    });

    console.log(`Total documents: ${totalDocs}`);
    console.log(`With top-level recurrence: ${hasTopLevel}`);
    console.log(`With calendarData.recurrence ONLY (needs promotion): ${hasCalendarDataOnly}`);
    console.log(`With both locations: ${hasBoth}`);
    console.log(`With calendarData.recurrence (total, to be $unset): ${hasCalendarDataAny}`);

    if (hasCalendarDataOnly === 0 && hasCalendarDataAny === 0) {
      console.log('\nNothing to migrate. All recurrence data already at top level.');
      return;
    }

    // --- PHASE 1: Promote calendarData.recurrence to top-level where missing ---
    if (hasCalendarDataOnly > 0) {
      console.log(`\n--- Phase 1: Promote ${hasCalendarDataOnly} calendarData-only docs ---\n`);

      const docsToPromote = await collection.find({
        recurrence: { $in: [null, undefined] },
        'calendarData.recurrence': { $exists: true, $ne: null }
      }).project({ _id: 1, 'calendarData.recurrence': 1 }).toArray();

      for (let i = 0; i < docsToPromote.length; i += BATCH_SIZE) {
        const batch = docsToPromote.slice(i, i + BATCH_SIZE);

        if (!isDryRun) {
          for (const doc of batch) {
            await collection.updateOne(
              { _id: doc._id },
              { $set: { recurrence: doc.calendarData.recurrence } }
            );
          }
        }

        const processed = Math.min(i + BATCH_SIZE, docsToPromote.length);
        const percent = Math.round((processed / docsToPromote.length) * 100);
        process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${docsToPromote.length})`);

        if (i + BATCH_SIZE < docsToPromote.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      console.log(`\n   Promoted: ${docsToPromote.length} documents`);
    }

    // --- PHASE 2: Remove calendarData.recurrence from all docs ---
    if (hasCalendarDataAny > 0) {
      console.log(`\n--- Phase 2: Remove calendarData.recurrence from ${hasCalendarDataAny} docs ---\n`);

      if (!isDryRun) {
        const docsToClean = await collection.find({
          'calendarData.recurrence': { $exists: true }
        }).project({ _id: 1 }).toArray();

        for (let i = 0; i < docsToClean.length; i += BATCH_SIZE) {
          const batch = docsToClean.slice(i, i + BATCH_SIZE);
          const batchIds = batch.map(d => d._id);

          await collection.updateMany(
            { _id: { $in: batchIds } },
            { $unset: { 'calendarData.recurrence': '' } }
          );

          const processed = Math.min(i + BATCH_SIZE, docsToClean.length);
          const percent = Math.round((processed / docsToClean.length) * 100);
          process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${docsToClean.length})`);

          if (i + BATCH_SIZE < docsToClean.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        console.log(`\n   Cleaned: ${docsToClean.length} documents`);
      } else {
        console.log(`   [DRY RUN] Would remove calendarData.recurrence from ${hasCalendarDataAny} documents`);
      }
    }

    // --- SUMMARY ---
    console.log('\n--- Migration Summary ---\n');
    console.log(`Mode: ${mode}`);
    console.log(`Promoted to top-level: ${hasCalendarDataOnly}`);
    console.log(`Cleaned calendarData.recurrence: ${hasCalendarDataAny}`);
    if (!isDryRun) {
      console.log('\nRun with --verify to confirm normalization.');
    }

  } finally {
    await client.close();
    console.log('\nDisconnected from MongoDB');
  }
}

async function verify(collection) {
  console.log('--- Verification ---\n');

  const remaining = await collection.countDocuments({
    'calendarData.recurrence': { $exists: true, $ne: null }
  });
  const topLevel = await collection.countDocuments({
    recurrence: { $exists: true, $ne: null }
  });

  console.log(`Documents with top-level recurrence: ${topLevel}`);
  console.log(`Documents with calendarData.recurrence (should be 0): ${remaining}`);

  if (remaining === 0) {
    console.log('\n   Normalization complete. All recurrence data at top level.');
  } else {
    console.log(`\n   WARNING: ${remaining} documents still have calendarData.recurrence.`);
    console.log('   Re-run the migration script to process remaining documents.');
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
