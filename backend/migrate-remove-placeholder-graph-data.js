#!/usr/bin/env node
/**
 * Migration: Remove placeholder graphData from templeEvents__Events
 *
 * Phase 2 of Event Data Architecture Cleanup.
 *
 * What this does:
 * 1. Finds documents with graphData that lack a real Graph ID (graphData.id is missing
 *    or starts with "csv_import_" / "evt-")
 * 2. $unsets graphData on those documents (sets to null)
 * 3. Leaves documents with real graphData.id untouched (published events synced to Graph)
 *
 * Safe and idempotent — skips docs without graphData or with real Graph IDs.
 *
 * Usage:
 *   node migrate-remove-placeholder-graph-data.js --dry-run    # Preview changes
 *   node migrate-remove-placeholder-graph-data.js              # Apply changes
 *   node migrate-remove-placeholder-graph-data.js --verify     # Verify results
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

    console.log(`\n📋 Migration: Remove placeholder graphData from ${COLLECTION_NAME}`);
    console.log(`   Database: ${DB_NAME}`);
    console.log(`   Mode: ${isDryRun ? '🔍 DRY RUN' : isVerify ? '✅ VERIFY' : '🔧 APPLY'}\n`);

    // Get counts
    const totalDocs = await collection.countDocuments();
    const docsWithGraphData = await collection.countDocuments({
      graphData: { $exists: true, $ne: null }
    });
    const docsWithRealGraphId = await collection.countDocuments({
      'graphData.id': { $exists: true, $ne: null },
      $and: [
        { 'graphData.id': { $not: /^csv_import_/ } },
        { 'graphData.id': { $not: /^evt-/ } }
      ]
    });
    const docsWithPlaceholder = await collection.countDocuments({
      graphData: { $exists: true, $ne: null },
      $or: [
        { 'graphData.id': { $exists: false } },
        { 'graphData.id': null },
        { 'graphData.id': { $regex: /^csv_import_/ } },
        { 'graphData.id': { $regex: /^evt-/ } }
      ]
    });

    console.log(`   Total documents: ${totalDocs}`);
    console.log(`   With graphData (non-null): ${docsWithGraphData}`);
    console.log(`   With real Graph ID: ${docsWithRealGraphId}`);
    console.log(`   With placeholder graphData: ${docsWithPlaceholder}\n`);

    if (isVerify) {
      if (docsWithPlaceholder === 0) {
        console.log('   ✅ Migration complete! No documents have placeholder graphData.');
      } else {
        console.log(`   ⚠️  ${docsWithPlaceholder} documents still have placeholder graphData.`);
        const sample = await collection.findOne({
          graphData: { $exists: true, $ne: null },
          $or: [
            { 'graphData.id': { $exists: false } },
            { 'graphData.id': null },
            { 'graphData.id': { $regex: /^csv_import_/ } },
            { 'graphData.id': { $regex: /^evt-/ } }
          ]
        });
        if (sample) {
          console.log(`   Sample document eventId: ${sample.eventId}`);
          console.log(`   graphData.id: ${sample.graphData?.id || '(none)'}`);
          console.log(`   graphData keys: ${Object.keys(sample.graphData || {}).join(', ')}`);
        }
      }
      return;
    }

    if (docsWithPlaceholder === 0) {
      console.log('   No documents with placeholder graphData found. Nothing to migrate.\n');
      return;
    }

    // Process in batches
    const docsToProcess = await collection.find({
      graphData: { $exists: true, $ne: null },
      $or: [
        { 'graphData.id': { $exists: false } },
        { 'graphData.id': null },
        { 'graphData.id': { $regex: /^csv_import_/ } },
        { 'graphData.id': { $regex: /^evt-/ } }
      ]
    }).toArray();

    let migratedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < docsToProcess.length; i += BATCH_SIZE) {
      const batch = docsToProcess.slice(i, i + BATCH_SIZE);

      if (isDryRun) {
        migratedCount += batch.length;
      } else {
        try {
          const result = await collection.updateMany(
            { _id: { $in: batch.map(d => d._id) } },
            { $set: { graphData: null } }
          );
          migratedCount += result.modifiedCount;
        } catch (err) {
          console.error(`   ❌ Error processing batch: ${err.message}`);
          errorCount += batch.length;
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
    console.log(`   Errors: ${errorCount}`);

    if (!isDryRun) {
      const remaining = await collection.countDocuments({
        graphData: { $exists: true, $ne: null },
        $or: [
          { 'graphData.id': { $exists: false } },
          { 'graphData.id': null },
          { 'graphData.id': { $regex: /^csv_import_/ } },
          { 'graphData.id': { $regex: /^evt-/ } }
        ]
      });
      console.log(`\n   Remaining with placeholder graphData: ${remaining}`);
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
