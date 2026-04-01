/**
 * Create Virtual Meeting Location
 *
 * This script creates a "Virtual Meeting" location in the templeEvents__Locations collection.
 * This location is used to group all URL-based virtual meeting links (Zoom, Teams, etc.)
 * for easier filtering and organization.
 *
 * Run this script once to set up the virtual location:
 * node create-virtual-location.js
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_CONNECTION_STRING = process.env.MONGODB_CONNECTION_STRING;
const MONGODB_DATABASE_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';

async function createVirtualLocation() {
  const client = new MongoClient(MONGODB_CONNECTION_STRING);

  try {
    console.log('Connecting to MongoDB...');
    await client.connect();
    console.log('Connected successfully to MongoDB');

    const db = client.db(MONGODB_DATABASE_NAME);
    const locationsCollection = db.collection('templeEvents__Locations');

    // Check if Virtual Meeting location already exists
    const existingLocation = await locationsCollection.findOne({
      name: 'Virtual Meeting'
    });

    if (existingLocation) {
      console.log('\n✓ Virtual Meeting location already exists:');
      console.log(JSON.stringify(existingLocation, null, 2));
      return;
    }

    // Create the Virtual Meeting location
    const virtualLocation = {
      name: 'Virtual Meeting',
      displayName: 'Virtual Meeting',
      locationCode: 'VIRTUAL',
      building: '',
      floor: '',
      capacity: null,
      features: ['virtual', 'online'],
      accessibility: [],
      active: true,
      description: 'Virtual meetings conducted via online platforms (Zoom, Teams, Google Meet, etc.)',
      notes: 'System-managed location for grouping URL-based meeting links',
      aliases: ['virtual', 'online', 'zoom', 'teams', 'google meet', 'webex'],
      usageCount: 0,
      category: 'virtual',
      isSystemLocation: true,  // Indicates this is a system-managed location
      isVirtual: true,         // Flag for filtering virtual locations
      createdAt: new Date(),
      updatedAt: new Date()
    };

    console.log('\nCreating Virtual Meeting location...');
    const result = await locationsCollection.insertOne(virtualLocation);

    console.log('\n✓ Virtual Meeting location created successfully!');
    console.log('Location ID:', result.insertedId.toString());
    console.log('\nLocation details:');
    console.log(JSON.stringify(virtualLocation, null, 2));

    console.log('\n✓ Setup complete! Virtual location is now available for use.');
    console.log('Events with URL-based locations will automatically be assigned to this location.');

  } catch (error) {
    console.error('Error creating virtual location:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\nMongoDB connection closed.');
  }
}

// Run the script
createVirtualLocation();
