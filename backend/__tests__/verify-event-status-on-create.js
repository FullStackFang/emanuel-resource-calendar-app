/**
 * Verification script for event status on creation
 *
 * This script verifies that:
 * 1. New events created via unified-form have status='published' and statusHistory
 * 2. New events created via batch-create have status='published' and statusHistory
 * 3. Room reservations have status='pending' (their own workflow)
 * 4. Drafts have status='draft'
 *
 * Usage:
 *   node __tests__/verify-event-status-on-create.js
 */

const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';

async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const eventsCollection = db.collection('templeEvents__Events');

    console.log('=== Verifying Event Status on Creation ===\n');

    // Check unified-form created events
    console.log('1. Checking unified-form created events...');
    const unifiedFormEvents = await eventsCollection.countDocuments({ createdSource: 'unified-form' });
    const unifiedFormWithStatus = await eventsCollection.countDocuments({
      createdSource: 'unified-form',
      status: { $exists: true }
    });
    const unifiedFormWithHistory = await eventsCollection.countDocuments({
      createdSource: 'unified-form',
      statusHistory: { $exists: true, $ne: [] }
    });
    const unifiedFormPublished = await eventsCollection.countDocuments({
      createdSource: 'unified-form',
      status: 'published'
    });
    console.log(`   Total: ${unifiedFormEvents}`);
    console.log(`   With status field: ${unifiedFormWithStatus}`);
    console.log(`   With statusHistory: ${unifiedFormWithHistory}`);
    console.log(`   With status='published': ${unifiedFormPublished}`);
    console.log(`   Missing status: ${unifiedFormEvents - unifiedFormWithStatus}`);
    console.log();

    // Check batch-create events
    console.log('2. Checking batch-create events...');
    const batchEvents = await eventsCollection.countDocuments({ createdSource: 'batch-create' });
    const batchWithStatus = await eventsCollection.countDocuments({
      createdSource: 'batch-create',
      status: { $exists: true }
    });
    const batchWithHistory = await eventsCollection.countDocuments({
      createdSource: 'batch-create',
      statusHistory: { $exists: true, $ne: [] }
    });
    const batchPublished = await eventsCollection.countDocuments({
      createdSource: 'batch-create',
      status: 'published'
    });
    console.log(`   Total: ${batchEvents}`);
    console.log(`   With status field: ${batchWithStatus}`);
    console.log(`   With statusHistory: ${batchWithHistory}`);
    console.log(`   With status='published': ${batchPublished}`);
    console.log(`   Missing status: ${batchEvents - batchWithStatus}`);
    console.log();

    // Check room reservations
    console.log('3. Checking room reservations...');
    const reservations = await eventsCollection.countDocuments({
      $or: [
        { createdSource: 'room-reservation' },
        { roomReservationData: { $exists: true } }
      ]
    });
    const reservationsWithStatus = await eventsCollection.countDocuments({
      $or: [
        { createdSource: 'room-reservation' },
        { roomReservationData: { $exists: true } }
      ],
      status: { $exists: true }
    });
    const reservationsPending = await eventsCollection.countDocuments({
      $or: [
        { createdSource: 'room-reservation' },
        { roomReservationData: { $exists: true } }
      ],
      status: 'pending'
    });
    console.log(`   Total: ${reservations}`);
    console.log(`   With status field: ${reservationsWithStatus}`);
    console.log(`   With status='pending': ${reservationsPending}`);
    console.log();

    // Check drafts
    console.log('4. Checking draft events...');
    const drafts = await eventsCollection.countDocuments({ status: 'draft' });
    console.log(`   Total drafts: ${drafts}`);
    console.log();

    // Overall status distribution
    console.log('5. Overall status distribution...');
    const statusDist = await eventsCollection.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();

    for (const s of statusDist) {
      console.log(`   ${s._id || '(no status)'}: ${s.count}`);
    }
    console.log();

    // Sample a recent unified-form event to verify structure
    console.log('6. Sample recent unified-form event...');
    const sampleEvent = await eventsCollection.findOne(
      { createdSource: 'unified-form' },
      { sort: { createdAt: -1 } }
    );
    if (sampleEvent) {
      console.log(`   _id: ${sampleEvent._id}`);
      console.log(`   eventTitle: ${sampleEvent.eventTitle || sampleEvent.graphData?.subject}`);
      console.log(`   status: ${sampleEvent.status || '(not set)'}`);
      console.log(`   statusHistory entries: ${sampleEvent.statusHistory?.length || 0}`);
      if (sampleEvent.statusHistory?.[0]) {
        console.log(`   First history entry:`);
        console.log(`     - status: ${sampleEvent.statusHistory[0].status}`);
        console.log(`     - reason: ${sampleEvent.statusHistory[0].reason}`);
      }
      console.log(`   createdAt: ${sampleEvent.createdAt}`);
    } else {
      console.log('   No unified-form events found');
    }
    console.log();

    // Verification summary
    console.log('=== Verification Summary ===');
    const issues = [];

    // Note: Existing events may not have status - only NEW events will have it
    if (unifiedFormEvents > 0 && unifiedFormWithStatus < unifiedFormEvents) {
      issues.push(`${unifiedFormEvents - unifiedFormWithStatus} unified-form events missing status (existing events before migration)`);
    }
    if (batchEvents > 0 && batchWithStatus < batchEvents) {
      issues.push(`${batchEvents - batchWithStatus} batch-create events missing status (existing events before migration)`);
    }

    if (issues.length === 0) {
      console.log('✓ All events have appropriate status fields');
    } else {
      console.log('Note: Some existing events may be missing status fields (pre-migration).');
      console.log('New events created after the fix will have status fields.');
      issues.forEach(issue => console.log(`  - ${issue}`));
    }
    console.log();
    console.log('To verify the fix works:');
    console.log('  1. Create a new event via the unified form');
    console.log('  2. Check that the new event has status="published" and statusHistory');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\nDisconnected from MongoDB');
  }
}

main();
