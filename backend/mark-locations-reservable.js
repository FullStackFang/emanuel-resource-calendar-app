/**
 * Script to mark existing locations as reservable
 *
 * Run with: node mark-locations-reservable.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING;
const DATABASE_NAME = process.env.MONGODB_DATABASE_NAME || 'templeEventsDB';

async function markLocationsReservable() {
  let client;

  try {
    console.log('Connecting to MongoDB...');
    client = await MongoClient.connect(MONGODB_URI);
    const db = client.db(DATABASE_NAME);
    const locationsCollection = db.collection('templeEvents__Locations');

    // Get all locations without isReservable flag
    const locations = await locationsCollection.find({}).sort({ name: 1 }).toArray();

    console.log(`\n=== Found ${locations.length} total locations ===\n`);

    const reservableCount = locations.filter(l => l.isReservable === true).length;
    const nonReservableCount = locations.filter(l => !l.isReservable).length;

    console.log(`Already reservable: ${reservableCount}`);
    console.log(`Not yet reservable: ${nonReservableCount}\n`);

    if (reservableCount > 0) {
      console.log('Currently reservable locations:');
      locations.filter(l => l.isReservable === true).forEach((loc, idx) => {
        console.log(`  ${idx + 1}. ${loc.name} (${loc.building || 'No building'}, ${loc.floor || 'No floor'})`);
      });
      console.log('');
    }

    console.log('Locations that could be marked as reservable:');
    const notReservable = locations.filter(l => !l.isReservable);
    notReservable.slice(0, 20).forEach((loc, idx) => {
      console.log(`  ${idx + 1}. ${loc.name}`);
      if (loc.building && loc.floor) {
        console.log(`     Location: ${loc.building} - ${loc.floor}`);
      }
      if (loc.capacity) {
        console.log(`     Capacity: ${loc.capacity}`);
      }
      if (loc.importSource) {
        console.log(`     Source: ${loc.importSource}`);
      }
    });

    if (notReservable.length > 20) {
      console.log(`  ... and ${notReservable.length - 20} more`);
    }

    console.log('\n=== Options ===');
    console.log('1. To mark ALL locations as reservable, uncomment the code below');
    console.log('2. To mark specific locations, modify the filter criteria');
    console.log('3. To mark by name pattern, use a regex filter\n');

    // UNCOMMENT ONE OF THE OPTIONS BELOW TO MARK LOCATIONS AS RESERVABLE

    // Option 1: Mark ALL locations as reservable
    // const result = await locationsCollection.updateMany(
    //   { isReservable: { $ne: true } },
    //   { $set: { isReservable: true, updatedAt: new Date() } }
    // );
    // console.log(`✓ Marked ${result.modifiedCount} locations as reservable`);

    // Option 2: Mark specific locations by name
    // const namesToMark = ['Isaac Mayer Wise Hall', 'Chapel', 'Social Hall'];
    // const result = await locationsCollection.updateMany(
    //   { name: { $in: namesToMark }, isReservable: { $ne: true } },
    //   { $set: { isReservable: true, updatedAt: new Date() } }
    // );
    // console.log(`✓ Marked ${result.modifiedCount} locations as reservable`);

    // Option 3: Mark locations with building AND floor data
    // const result = await locationsCollection.updateMany(
    //   {
    //     building: { $exists: true, $ne: null },
    //     floor: { $exists: true, $ne: null },
    //     isReservable: { $ne: true }
    //   },
    //   { $set: { isReservable: true, updatedAt: new Date() } }
    // );
    // console.log(`✓ Marked ${result.modifiedCount} locations as reservable`);

    console.log('No changes made. Uncomment code above to mark locations as reservable.');

  } catch (error) {
    console.error('Script failed:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('\nDatabase connection closed.');
    }
  }
}

// Run script
markLocationsReservable();
