/**
 * Migration: Remove dead effectiveStart/effectiveEnd fields from events
 *
 * These top-level fields were written at creation time but never read back by any code.
 * All consumers (SchedulingAssistant, RoomTimeline, LocationListSelect) read dynamically-
 * computed values from the availability API response, not these stored fields.
 *
 * Usage:
 *   node migrate-remove-effective-dates.js --dry-run    # Preview changes
 *   node migrate-remove-effective-dates.js              # Apply changes
 *   node migrate-remove-effective-dates.js --verify     # Verify results
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION = 'templeEvents__Events';
const BATCH_SIZE = 100;

const isDryRun = process.argv.includes('--dry-run');
const isVerify = process.argv.includes('--verify');

async function run() {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION);

    console.log(`\n  Database: ${DB_NAME}`);
    console.log(`  Collection: ${COLLECTION}`);
    console.log(`  Mode: ${isDryRun ? 'DRY RUN' : isVerify ? 'VERIFY' : 'APPLY'}\n`);

    // Count documents with these fields
    const withEffectiveStart = await collection.countDocuments({ effectiveStart: { $exists: true } });
    const withEffectiveEnd = await collection.countDocuments({ effectiveEnd: { $exists: true } });
    const withEither = await collection.countDocuments({
      $or: [
        { effectiveStart: { $exists: true } },
        { effectiveEnd: { $exists: true } }
      ]
    });

    console.log(`  Documents with effectiveStart: ${withEffectiveStart}`);
    console.log(`  Documents with effectiveEnd: ${withEffectiveEnd}`);
    console.log(`  Documents with either field: ${withEither}\n`);

    if (isVerify) {
      if (withEither === 0) {
        console.log('  ✓ No documents have effectiveStart or effectiveEnd. Migration is clean.\n');
      } else {
        console.log(`  ✗ ${withEither} document(s) still have these fields.\n`);
      }
      return;
    }

    if (withEither === 0) {
      console.log('  No documents to update. Nothing to do.\n');
      return;
    }

    if (isDryRun) {
      console.log(`  Would remove effectiveStart/effectiveEnd from ${withEither} document(s).\n`);
      return;
    }

    // Apply: batch $unset
    const docsToProcess = await collection.find({
      $or: [
        { effectiveStart: { $exists: true } },
        { effectiveEnd: { $exists: true } }
      ]
    }, { projection: { _id: 1 } }).toArray();

    for (let i = 0; i < docsToProcess.length; i += BATCH_SIZE) {
      const batch = docsToProcess.slice(i, i + BATCH_SIZE);
      await collection.updateMany(
        { _id: { $in: batch.map(d => d._id) } },
        { $unset: { effectiveStart: '', effectiveEnd: '' } }
      );

      const processed = Math.min(i + BATCH_SIZE, docsToProcess.length);
      const percent = Math.round((processed / docsToProcess.length) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${docsToProcess.length})`);

      if (i + BATCH_SIZE < docsToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log('\n');

    // Verify
    const remaining = await collection.countDocuments({
      $or: [
        { effectiveStart: { $exists: true } },
        { effectiveEnd: { $exists: true } }
      ]
    });
    console.log(`  Done. Remaining documents with these fields: ${remaining}`);
    if (remaining === 0) {
      console.log('  ✓ Migration complete.\n');
    } else {
      console.log('  ✗ Some documents still have these fields. Re-run the migration.\n');
    }

  } finally {
    await client.close();
  }
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
