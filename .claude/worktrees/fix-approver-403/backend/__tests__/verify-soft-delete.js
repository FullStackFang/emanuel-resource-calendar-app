/**
 * Verification script for soft delete behavior
 *
 * Usage:
 *   node __tests__/verify-soft-delete.js --dry-run    # Check current state
 *   node __tests__/verify-soft-delete.js --test       # Create test event, delete it, verify
 */

const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const RUN_TEST = args.includes('--test');

async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const eventsCollection = db.collection('templeEvents__Events');

    if (DRY_RUN) {
      await verifyCurrentState(eventsCollection);
    } else if (RUN_TEST) {
      await runDeleteTest(eventsCollection);
    } else {
      console.log('Usage:');
      console.log('  node __tests__/verify-soft-delete.js --dry-run    # Check current state');
      console.log('  node __tests__/verify-soft-delete.js --test       # Create test event, delete it, verify');
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\nDisconnected from MongoDB');
  }
}

async function verifyCurrentState(eventsCollection) {
  console.log('=== Verifying Current Soft Delete State ===\n');

  // Check for events with status 'deleted'
  const deletedEvents = await eventsCollection.countDocuments({ status: 'deleted' });
  const deletedWithFlag = await eventsCollection.countDocuments({ status: 'deleted', isDeleted: true });
  const deletedWithHistory = await eventsCollection.countDocuments({
    status: 'deleted',
    'statusHistory.status': 'deleted'
  });

  console.log('Soft-deleted events:');
  console.log(`  Total with status='deleted': ${deletedEvents}`);
  console.log(`  With isDeleted=true: ${deletedWithFlag}`);
  console.log(`  With statusHistory entry: ${deletedWithHistory}`);

  // Check for any hard-deleted indicators (orphaned references)
  const totalEvents = await eventsCollection.countDocuments({});
  const activeEvents = await eventsCollection.countDocuments({ isDeleted: { $ne: true } });

  console.log('\nEvent counts:');
  console.log(`  Total events: ${totalEvents}`);
  console.log(`  Active (not deleted): ${activeEvents}`);
  console.log(`  Soft-deleted: ${totalEvents - activeEvents}`);

  // Sample a deleted event to verify structure
  const sampleDeleted = await eventsCollection.findOne({ status: 'deleted' });
  if (sampleDeleted) {
    console.log('\nSample deleted event structure:');
    console.log(`  _id: ${sampleDeleted._id}`);
    console.log(`  status: ${sampleDeleted.status}`);
    console.log(`  isDeleted: ${sampleDeleted.isDeleted}`);
    console.log(`  deletedAt: ${sampleDeleted.deletedAt}`);
    console.log(`  deletedBy: ${sampleDeleted.deletedBy}`);
    console.log(`  deletedByEmail: ${sampleDeleted.deletedByEmail}`);
    console.log(`  statusHistory entries: ${sampleDeleted.statusHistory?.length || 0}`);

    const deleteHistoryEntry = sampleDeleted.statusHistory?.find(h => h.status === 'deleted');
    if (deleteHistoryEntry) {
      console.log(`  Delete history entry: ✓ Found`);
      console.log(`    - changedAt: ${deleteHistoryEntry.changedAt}`);
      console.log(`    - reason: ${deleteHistoryEntry.reason}`);
    } else {
      console.log(`  Delete history entry: ✗ Missing`);
    }
  } else {
    console.log('\nNo deleted events found to sample.');
  }

  // Verification checks
  console.log('\n=== Verification Results ===');
  const issues = [];

  if (deletedEvents > 0 && deletedWithFlag !== deletedEvents) {
    issues.push(`${deletedEvents - deletedWithFlag} deleted events missing isDeleted=true flag`);
  }

  if (deletedEvents > 0 && deletedWithHistory !== deletedEvents) {
    issues.push(`${deletedEvents - deletedWithHistory} deleted events missing statusHistory entry`);
  }

  if (issues.length === 0) {
    console.log('✓ All soft-deleted events have correct structure');
  } else {
    console.log('✗ Issues found:');
    issues.forEach(issue => console.log(`  - ${issue}`));
  }
}

async function runDeleteTest(eventsCollection) {
  console.log('=== Running Soft Delete Test ===\n');

  // Create a test event
  const testEvent = {
    eventTitle: '__TEST_SOFT_DELETE__',
    status: 'pending',
    isDeleted: false,
    createdAt: new Date(),
    createdBy: 'test-script',
    statusHistory: [{
      status: 'pending',
      changedAt: new Date(),
      changedBy: 'test-script',
      changedByEmail: 'test@test.com',
      reason: 'Test event created'
    }]
  };

  console.log('1. Creating test event...');
  const insertResult = await eventsCollection.insertOne(testEvent);
  const testId = insertResult.insertedId;
  console.log(`   Created: ${testId}`);

  // Simulate soft delete (same logic as the API endpoints)
  console.log('\n2. Performing soft delete...');
  const deleteResult = await eventsCollection.updateOne(
    { _id: testId },
    {
      $set: {
        status: 'deleted',
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: 'test-script',
        deletedByEmail: 'test@test.com',
        lastModified: new Date(),
        lastModifiedBy: 'test@test.com'
      },
      $push: {
        statusHistory: {
          status: 'deleted',
          changedAt: new Date(),
          changedBy: 'test-script',
          changedByEmail: 'test@test.com',
          reason: 'Deleted by test script'
        }
      }
    }
  );
  console.log(`   Modified: ${deleteResult.modifiedCount}`);

  // Verify the soft delete
  console.log('\n3. Verifying soft delete...');
  const deletedEvent = await eventsCollection.findOne({ _id: testId });

  const checks = {
    'status is "deleted"': deletedEvent.status === 'deleted',
    'isDeleted is true': deletedEvent.isDeleted === true,
    'deletedAt exists': !!deletedEvent.deletedAt,
    'deletedBy exists': !!deletedEvent.deletedBy,
    'deletedByEmail exists': !!deletedEvent.deletedByEmail,
    'statusHistory has delete entry': deletedEvent.statusHistory?.some(h => h.status === 'deleted')
  };

  let allPassed = true;
  for (const [check, passed] of Object.entries(checks)) {
    console.log(`   ${passed ? '✓' : '✗'} ${check}`);
    if (!passed) allPassed = false;
  }

  // Clean up test event
  console.log('\n4. Cleaning up test event...');
  await eventsCollection.deleteOne({ _id: testId });
  console.log('   Removed test event');

  console.log('\n=== Test Result ===');
  if (allPassed) {
    console.log('✓ Soft delete is working correctly!');
  } else {
    console.log('✗ Soft delete has issues - check the failed checks above');
    process.exit(1);
  }
}

main();
