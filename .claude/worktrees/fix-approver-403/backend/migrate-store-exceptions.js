/**
 * Migration: Add fields to support storing recurring event exceptions
 *
 * Adds fields needed to properly store and link exceptions:
 * - exceptionEventIds: Array of linked exception eventIds (for masters)
 * - graphData.cancelledOccurrences: Track deleted occurrences (for masters)
 *
 * Note: We use graphData.seriesMasterId (already populated by Graph API) to link
 * exceptions to their master events, avoiding redundant top-level fields.
 *
 * Also creates indexes for efficient exception queries.
 */

const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.MONGODB_DB_NAME || 'emanuelnyc-services';

if (!MONGODB_URI) {
  console.error('MONGODB_CONNECTION_STRING not found in environment variables');
  console.error('Please check that backend/.env file exists and contains MONGODB_CONNECTION_STRING');
  process.exit(1);
}

async function migrate() {
  console.log('Starting exception storage migration...\n');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db(DB_NAME);
    const eventsCollection = db.collection('templeEvents__Events');

    // Step 1: Add exceptionEventIds array to series masters
    console.log('\nAdding exceptionEventIds array to series masters...');
    const exceptionEventIdsResult = await eventsCollection.updateMany(
      {
        'graphData.type': 'seriesMaster',
        exceptionEventIds: { $exists: false }
      },
      { $set: { exceptionEventIds: [] } }
    );
    console.log(`Updated ${exceptionEventIdsResult.modifiedCount} series masters with exceptionEventIds`);

    // Step 2: Add cancelledOccurrences array to series masters
    console.log('\nAdding cancelledOccurrences array to series masters...');
    const cancelledOccurrencesResult = await eventsCollection.updateMany(
      {
        'graphData.type': 'seriesMaster',
        'graphData.cancelledOccurrences': { $exists: false }
      },
      { $set: { 'graphData.cancelledOccurrences': [] } }
    );
    console.log(`Updated ${cancelledOccurrencesResult.modifiedCount} series masters with cancelledOccurrences`);

    // Step 3: Create indexes for efficient exception queries
    console.log('\nCreating indexes for exception queries...');

    try {
      await eventsCollection.createIndex({ isException: 1 });
      console.log('Created index on isException');
    } catch (err) {
      console.log('Index on isException may already exist:', err.message);
    }

    try {
      await eventsCollection.createIndex({ originalStartDateTime: 1 });
      console.log('Created index on originalStartDateTime');
    } catch (err) {
      console.log('Index on originalStartDateTime may already exist:', err.message);
    }

    try {
      await eventsCollection.createIndex({ 'graphData.seriesMasterId': 1 });
      console.log('Created index on graphData.seriesMasterId');
    } catch (err) {
      console.log('Index on graphData.seriesMasterId may already exist:', err.message);
    }

    try {
      await eventsCollection.createIndex(
        { 'graphData.seriesMasterId': 1, originalStartDateTime: 1 }
      );
      console.log('Created compound index on graphData.seriesMasterId + originalStartDateTime');
    } catch (err) {
      console.log('Compound index may already exist:', err.message);
    }

    // Show summary statistics
    console.log('\nMigration Summary:');
    console.log('=======================================');

    const totalEvents = await eventsCollection.countDocuments();
    const seriesMasters = await eventsCollection.countDocuments({ 'graphData.type': 'seriesMaster' });
    const exceptions = await eventsCollection.countDocuments({ isException: true });
    const mastersWithExceptionArrays = await eventsCollection.countDocuments({
      'graphData.type': 'seriesMaster',
      exceptionEventIds: { $exists: true }
    });

    console.log(`Total events:              ${totalEvents}`);
    console.log(`Series masters:            ${seriesMasters}`);
    console.log(`Existing exceptions:       ${exceptions}`);
    console.log(`Masters with exception arrays: ${mastersWithExceptionArrays}`);
    console.log('=======================================');

    console.log('\nMigration completed successfully!');
    console.log('Note: Exceptions will be stored during next sync from Outlook.');

  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await client.close();
    console.log('\nDisconnected from MongoDB');
  }
}

// Run migration
migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
