/**
 * Create Non-Physical Location
 *
 * Creates a special "Non-Physical Location" in templeEvents__Locations
 * This serves as a catch-all for virtual meetings, holidays, and non-physical locations
 */

require('dotenv').config({ path: __dirname + '/.env' });
const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGODB_CONNECTION_STRING;
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DATABASE_NAME || 'calendar';

// Validate environment variables
if (!MONGODB_URI) {
  console.error('❌ Error: MONGODB connection string not set');
  process.exit(1);
}

async function createNonPhysicalLocation() {
  console.log('🚀 Creating Non-Physical Location...\n');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const locationsCollection = db.collection('templeEvents__Locations');

    // Check if non-physical location already exists
    const existing = await locationsCollection.findOne({
      name: 'Non-Physical Location'
    });

    if (existing) {
      console.log('ℹ️  Non-Physical Location already exists:');
      console.log(`   ID: ${existing._id}`);
      console.log(`   Name: ${existing.name}`);
      console.log(`   Aliases: ${existing.aliases?.length || 0}`);
      console.log('\n✨ No changes needed\n');
      return existing._id;
    }

    // Create the non-physical location
    const nonPhysicalLocation = {
      name: 'Non-Physical Location',
      displayName: 'Non-Physical Location',
      aliases: [],
      active: true,
      description: 'Catch-all for virtual meetings, holidays, and non-physical locations',
      capacity: null,
      features: [],
      accessibility: [],
      building: null,
      floor: null,
      address: null,
      coordinates: null,
      status: 'approved',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await locationsCollection.insertOne(nonPhysicalLocation);

    console.log('✅ Non-Physical Location created successfully!');
    console.log(`   ID: ${result.insertedId}`);
    console.log(`   Name: ${nonPhysicalLocation.name}`);
    console.log(`   Description: ${nonPhysicalLocation.description}`);
    console.log('\n💡 Use this location ID when assigning virtual/non-physical location strings\n');

    return result.insertedId;

  } catch (error) {
    console.error('❌ Failed to create Non-Physical Location:', error);
    throw error;
  } finally {
    await client.close();
    console.log('👋 Database connection closed\n');
  }
}

// Run if called directly
if (require.main === module) {
  createNonPhysicalLocation()
    .then((locationId) => {
      console.log(`✨ Script completed successfully. Location ID: ${locationId}`);
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 Script failed:', error);
      process.exit(1);
    });
}

module.exports = { createNonPhysicalLocation };
