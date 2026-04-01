/**
 * Quick verification script to test deleted events query
 * Run: node verify-deleted-query.js
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';

async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db(DB_NAME);
    const eventsCollection = db.collection('templeEvents__Events');

    // Test query 1: Find all deleted events (Approval Queue query)
    const deletedQuery = {
      $or: [
        { status: 'deleted' },
        { isDeleted: true }
      ]
    };

    console.log('\n=== Query 1: All deleted events ===');
    console.log('Query:', JSON.stringify(deletedQuery, null, 2));

    const deletedEvents = await eventsCollection.find(deletedQuery).toArray();
    console.log(`Found ${deletedEvents.length} deleted events`);

    deletedEvents.forEach((event, i) => {
      console.log(`\n[${i + 1}] ${event.eventTitle || event.graphData?.subject || 'Untitled'}`);
      console.log(`    _id: ${event._id}`);
      console.log(`    status: ${event.status}`);
      console.log(`    isDeleted: ${event.isDeleted}`);
      console.log(`    createdBy: ${event.createdBy}`);
      console.log(`    createdByEmail: ${event.createdByEmail}`);
      console.log(`    hasRoomReservationData: ${!!event.roomReservationData}`);
    });

    // Test query 2: Specific event by ID
    const specificId = '69824e7f0897ed06f80f33c7';
    console.log(`\n=== Query 2: Find specific event ${specificId} ===`);

    const { ObjectId } = require('mongodb');
    const specificEvent = await eventsCollection.findOne({ _id: new ObjectId(specificId) });

    if (specificEvent) {
      console.log('Found event:');
      console.log(`  eventTitle: ${specificEvent.eventTitle}`);
      console.log(`  status: ${specificEvent.status}`);
      console.log(`  isDeleted: ${specificEvent.isDeleted}`);
      console.log(`  createdBy: ${specificEvent.createdBy}`);
    } else {
      console.log('Event NOT found!');
    }

    // Test if the specific event matches the deleted query
    console.log('\n=== Query 3: Does specific event match deleted query? ===');
    const matchingEvent = await eventsCollection.findOne({
      _id: new ObjectId(specificId),
      ...deletedQuery
    });
    console.log(matchingEvent ? 'YES - Event matches deleted query' : 'NO - Event does NOT match deleted query');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
    console.log('\nDisconnected from MongoDB');
  }
}

main();
