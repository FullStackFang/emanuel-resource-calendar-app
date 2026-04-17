/**
 * Migration: Remove calendarData.locationCodes from all events
 *
 * locationCodes (rsKey array) is no longer used for calendar grouping.
 * Events are now grouped solely by their calendarData.locations (ObjectId array).
 *
 * Run:
 *   node migrate-remove-location-codes.js --dry-run   # Preview scope
 *   node migrate-remove-location-codes.js             # Apply
 *   node migrate-remove-location-codes.js --verify    # Confirm field is gone
 */
const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const BATCH_SIZE = 25;

const isDryRun = process.argv.includes('--dry-run');
const isVerify = process.argv.includes('--verify');

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const col = db.collection('templeEvents__Events');

  if (isVerify) {
    const remaining = await col.countDocuments({ 'calendarData.locationCodes': { $exists: true } });
    if (remaining === 0) {
      console.log('✓ Verified: calendarData.locationCodes has been removed from all documents.');
    } else {
      console.log(`✗ ${remaining} documents still have calendarData.locationCodes.`);
    }
    await client.close();
    return;
  }

  const total = await col.countDocuments({ 'calendarData.locationCodes': { $exists: true } });
  console.log(`\nMode: ${isDryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log(`Documents with calendarData.locationCodes: ${total}`);

  if (total === 0) {
    console.log('Nothing to do.');
    await client.close();
    return;
  }

  if (isDryRun) {
    const samples = await col.find({ 'calendarData.locationCodes': { $exists: true } })
      .limit(5)
      .project({ eventId: 1, 'calendarData.locationCodes': 1, 'calendarData.locationDisplayNames': 1 })
      .toArray();
    console.log('\nSample documents (first 5):');
    samples.forEach(e => {
      console.log(`  ${e.eventId}: codes=${JSON.stringify(e.calendarData?.locationCodes)}, display="${e.calendarData?.locationDisplayNames}"`);
    });
    console.log(`\nDry run complete. ${total} documents would have calendarData.locationCodes removed.`);
    await client.close();
    return;
  }

  // Retry helper: on Cosmos DB 429, wait then retry the same batch
  async function updateBatchWithRetry(ids) {
    let attempt = 0;
    while (true) {
      try {
        await col.updateMany(
          { _id: { $in: ids } },
          { $unset: { 'calendarData.locationCodes': '' } }
        );
        return;
      } catch (err) {
        if (err.code === 16500) {
          // Parse RetryAfterMs from error message, default to 2s
          const match = err.message.match(/RetryAfterMs=(\d+)/);
          const waitMs = match ? parseInt(match[1]) + 500 : 2000;
          attempt++;
          process.stdout.write(`\r   [Rate limited, waiting ${waitMs}ms, attempt ${attempt}]   `);
          await new Promise(resolve => setTimeout(resolve, waitMs));
        } else {
          throw err;
        }
      }
    }
  }

  // Apply in batches
  const docs = await col.find({ 'calendarData.locationCodes': { $exists: true } })
    .project({ _id: 1 })
    .toArray();

  let processed = 0;

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    const ids = batch.map(d => d._id);

    await updateBatchWithRetry(ids);

    processed = Math.min(i + BATCH_SIZE, docs.length);
    const percent = Math.round((processed / docs.length) * 100);
    process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${docs.length})   `);

    if (i + BATCH_SIZE < docs.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log(`\n\nDone. Removed calendarData.locationCodes from ${processed} documents.`);
  console.log('Run with --verify to confirm.');
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
