/**
 * Migration: Drop the draft auto-expire TTL index
 *
 * The draft_auto_cleanup index on templeEvents__Events was auto-deleting any
 * document with status='draft' 30 days after draftCreatedAt. That behavior was
 * removed from the app — this script drops the live index so Cosmos DB stops
 * enforcing it. Idempotent: safe to re-run.
 *
 * Usage:
 *   node migrate-drop-draft-ttl-index.js --dry-run
 *   node migrate-drop-draft-ttl-index.js
 *   node migrate-drop-draft-ttl-index.js --verify
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION = 'templeEvents__Events';
const INDEX_NAME = 'draft_auto_cleanup';

const isDryRun = process.argv.includes('--dry-run');
const isVerify = process.argv.includes('--verify');

async function findIndex(collection) {
  const indexes = await collection.indexes();
  return indexes.find((idx) => idx.name === INDEX_NAME) || null;
}

async function verify(collection) {
  const found = await findIndex(collection);
  if (found) {
    console.log(`   [Verify] Index '${INDEX_NAME}' STILL PRESENT`);
    console.log(`   [Verify]   keys: ${JSON.stringify(found.key)}`);
    if (found.expireAfterSeconds != null) {
      console.log(`   [Verify]   expireAfterSeconds: ${found.expireAfterSeconds}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`   [Verify] Index '${INDEX_NAME}' is absent. Clean.`);
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION);

    console.log(`\nMigration: Drop draft auto-expire TTL index`);
    console.log(`   Database:   ${DB_NAME}`);
    console.log(`   Collection: ${COLLECTION}`);
    console.log(`   Index:      ${INDEX_NAME}`);
    console.log(`   Mode:       ${isDryRun ? 'DRY RUN' : isVerify ? 'VERIFY' : 'APPLY'}\n`);

    if (isVerify) {
      await verify(collection);
      return;
    }

    const existing = await findIndex(collection);
    if (!existing) {
      console.log(`   Index '${INDEX_NAME}' not found. Nothing to do (already dropped).\n`);
      return;
    }

    console.log(`   Found index '${INDEX_NAME}':`);
    console.log(`     keys: ${JSON.stringify(existing.key)}`);
    if (existing.expireAfterSeconds != null) {
      console.log(`     expireAfterSeconds: ${existing.expireAfterSeconds}`);
    }
    if (existing.partialFilterExpression) {
      console.log(`     partialFilterExpression: ${JSON.stringify(existing.partialFilterExpression)}`);
    }

    if (isDryRun) {
      console.log(`\n   [DRY RUN] Would drop index '${INDEX_NAME}'. No changes made.\n`);
      return;
    }

    try {
      await collection.dropIndex(INDEX_NAME);
      console.log(`\n   Dropped index '${INDEX_NAME}'.\n`);
    } catch (err) {
      // Cosmos DB can refuse index modifications on non-empty collections (code 67).
      if (err && (err.code === 67 || err.codeName === 'CannotCreateIndex' || err.codeName === 'IndexNotFound')) {
        console.error(`   Failed to drop via driver (code=${err.code}, codeName=${err.codeName}).`);
        console.error(`   Fallback: drop the index manually in the Azure Cosmos DB portal.`);
        process.exitCode = 2;
        return;
      }
      throw err;
    }

    const after = await findIndex(collection);
    if (after) {
      console.error(`   WARNING: index '${INDEX_NAME}' is still present after drop attempt.`);
      process.exitCode = 2;
    } else {
      console.log(`   Confirmed: index '${INDEX_NAME}' is gone.\n`);
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
