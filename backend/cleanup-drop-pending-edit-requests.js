/**
 * Cleanup: drop the legacy embedded `pendingEditRequest` field on events.
 *
 * Phase 1 of the Edit-Request Layer Refactor moves edit requests into a
 * first-class collection (templeEvents__EditRequests). The legacy embedded
 * field is no longer read or written by any new code paths and should be
 * removed before the new endpoint surface ships.
 *
 * This is NOT a migration: existing pendingEditRequest data is test-only and
 * does not need to be preserved. The script simply $unsets the field across
 * all events that still carry it.
 *
 * Run with:
 *   node cleanup-drop-pending-edit-requests.js --dry-run   # Preview count
 *   node cleanup-drop-pending-edit-requests.js             # Apply $unset
 *   node cleanup-drop-pending-edit-requests.js --verify    # Confirm zero remain
 *
 * Idempotent: safe to run multiple times.
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isVerify = args.includes('--verify');

const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 1000;

async function run() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB');
    console.log(`Database: ${DB_NAME}`);
    console.log('');

    if (isDryRun) console.log('DRY RUN — no changes will be applied');
    if (isVerify) console.log('VERIFY mode — no changes, status check only');
    console.log('');

    const db = client.db(DB_NAME);
    const events = db.collection('templeEvents__Events');

    const remaining = await events.countDocuments({
      pendingEditRequest: { $exists: true },
    });

    console.log(`Events with embedded pendingEditRequest: ${remaining}`);

    if (isVerify) {
      if (remaining === 0) {
        console.log('VERIFY OK — no embedded pendingEditRequest fields remain.');
      } else {
        console.log(`VERIFY FAIL — ${remaining} events still carry the legacy field.`);
        process.exitCode = 1;
      }
      return;
    }

    if (remaining === 0) {
      console.log('Nothing to do.');
      return;
    }

    if (isDryRun) {
      console.log('');
      console.log(`Would $unset pendingEditRequest on ${remaining} events.`);
      console.log('Run without --dry-run to apply.');
      return;
    }

    // Process in batches to respect Cosmos rate limits (per CLAUDE.md migration conventions).
    const docs = await events
      .find({ pendingEditRequest: { $exists: true } }, { projection: { _id: 1 } })
      .toArray();

    console.log('');
    let processed = 0;
    let modifiedTotal = 0;

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = docs.slice(i, i + BATCH_SIZE);
      const ids = batch.map((d) => d._id);

      const result = await events.updateMany(
        { _id: { $in: ids } },
        { $unset: { pendingEditRequest: '' } }
      );
      modifiedTotal += result.modifiedCount;

      processed = Math.min(i + BATCH_SIZE, docs.length);
      const percent = Math.round((processed / docs.length) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${docs.length})`);

      if (i + BATCH_SIZE < docs.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }
    process.stdout.write('\n');
    console.log('');

    const after = await events.countDocuments({
      pendingEditRequest: { $exists: true },
    });

    console.log('Cleanup complete.');
    console.log(`  Events touched:   ${modifiedTotal}`);
    console.log(`  Remaining after:  ${after}`);
    if (after !== 0) {
      console.log('  Note: non-zero remaining count indicates concurrent writes during cleanup; rerun is safe.');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

run();
