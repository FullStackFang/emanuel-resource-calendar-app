/**
 * Migration Script: Migrate Rooms to Locations Collection
 *
 * This script migrates the hardcoded room data from templeEvents__Rooms
 * to templeEvents__Locations collection with isReservable flag.
 *
 * Run with: node migrate-rooms-to-locations.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING;
const DATABASE_NAME = process.env.MONGODB_DATABASE_NAME || 'templeEventsDB';

// Hardcoded room data from api-server.js (lines 10685-10820)
const roomsToMigrate = [
  {
    name: "Temple Emanu-El",
    locationCode: "TPL",
    displayName: "Temple Emanu-El",
    building: "Main Building",
    floor: "1st Floor",
    capacity: 400,
    features: ["piano", "stage", "microphone", "projector", "organ"],
    accessibility: ["wheelchair-accessible", "hearing-loop"],
    active: true,
    isReservable: true,
    description: "Main sanctuary for worship and large gatherings",
    notes: "Primary worship space",
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "Chapel",
    locationCode: "CPL",
    displayName: "Chapel",
    building: "Main Building",
    floor: "1st Floor",
    capacity: 200,
    features: ["piano", "stage", "microphone", "projector"],
    accessibility: ["wheelchair-accessible", "hearing-loop"],
    active: true,
    isReservable: true,
    description: "Main worship space with traditional setup",
    notes: "Reserved for services on Sabbath",
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "Music Room",
    locationCode: "MUS",
    displayName: "Music Room",
    building: "Main Building",
    floor: "2nd Floor",
    capacity: 25,
    features: ["piano", "music-stands", "acoustic-treatment"],
    accessibility: ["elevator"],
    active: true,
    isReservable: true,
    description: "Dedicated space for music practice and choir rehearsals",
    notes: "Requires coordination with music director",
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "Room 402",
    locationCode: "402",
    displayName: "Room 402",
    building: "Main Building",
    floor: "4th Floor",
    capacity: 20,
    features: ["tables", "chairs", "whiteboard"],
    accessibility: ["elevator"],
    active: true,
    isReservable: true,
    description: "Classroom space for educational programs",
    notes: "General purpose classroom",
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "Room 602",
    locationCode: "602",
    displayName: "6th Floor Lounge - 602",
    building: "Main Building",
    floor: "6th Floor",
    capacity: 40,
    features: ["comfortable-seating", "kitchenette", "tables"],
    accessibility: ["elevator"],
    active: true,
    isReservable: true,
    description: "Lounge area for social gatherings and meetings",
    notes: "Popular for committee meetings and social events",
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "Nursery School",
    locationCode: "NURSERY",
    displayName: "Nursery School",
    building: "Education Wing",
    floor: "Ground Floor",
    capacity: 15,
    features: ["child-furniture", "toys", "safety-equipment"],
    accessibility: ["wheelchair-accessible", "child-safe"],
    active: true,
    isReservable: true,
    description: "Early childhood education space",
    notes: "Requires advance coordination with nursery school director",
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "Social Hall",
    displayName: "Social Hall",
    building: "Main Building",
    floor: "1st Floor",
    capacity: 150,
    features: ["kitchen", "stage", "tables", "chairs"],
    accessibility: ["wheelchair-accessible"],
    active: true,
    isReservable: true,
    description: "Large multipurpose room with kitchen access",
    notes: "Can be divided with partition",
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "Conference Room A",
    displayName: "Conference Room A",
    building: "Main Building",
    floor: "2nd Floor",
    capacity: 12,
    features: ["av-equipment", "projector", "whiteboard", "conference-table"],
    accessibility: ["elevator"],
    active: true,
    isReservable: true,
    description: "Executive conference room with video conferencing",
    notes: "Requires advance booking for setup",
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "Conference Room B",
    displayName: "Conference Room B",
    building: "Main Building",
    floor: "2nd Floor",
    capacity: 8,
    features: ["whiteboard", "conference-table"],
    accessibility: ["elevator"],
    active: true,
    isReservable: true,
    description: "Small meeting room for intimate discussions",
    notes: "No AV equipment available",
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "Youth Room",
    displayName: "Youth Room",
    building: "Main Building",
    floor: "1st Floor",
    capacity: 30,
    features: ["games", "comfortable-seating", "tv", "kitchenette"],
    accessibility: ["wheelchair-accessible"],
    active: true,
    isReservable: true,
    description: "Casual space designed for youth activities",
    notes: "Snacks and beverages allowed",
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

async function migrateRoomsToLocations() {
  let client;

  try {
    console.log('Connecting to MongoDB...');
    client = await MongoClient.connect(MONGODB_URI);
    const db = client.db(DATABASE_NAME);
    const locationsCollection = db.collection('templeEvents__Locations');

    console.log(`\nMigrating ${roomsToMigrate.length} rooms to templeEvents__Locations...`);

    let inserted = 0;
    let skipped = 0;
    let updated = 0;

    for (const room of roomsToMigrate) {
      // Check if location already exists by name
      const existing = await locationsCollection.findOne({ name: room.name });

      if (existing) {
        // Update existing location to ensure it has isReservable flag
        const result = await locationsCollection.updateOne(
          { name: room.name },
          {
            $set: {
              isReservable: true,
              ...room,
              updatedAt: new Date()
            }
          }
        );

        if (result.modifiedCount > 0) {
          console.log(`✓ Updated: ${room.name} (set isReservable: true)`);
          updated++;
        } else {
          console.log(`- Skipped: ${room.name} (already exists with correct data)`);
          skipped++;
        }
      } else {
        // Insert new location
        await locationsCollection.insertOne(room);
        console.log(`✓ Inserted: ${room.name}`);
        inserted++;
      }
    }

    console.log(`\n=== Migration Complete ===`);
    console.log(`Inserted: ${inserted} new locations`);
    console.log(`Updated: ${updated} existing locations`);
    console.log(`Skipped: ${skipped} (already up to date)`);
    console.log(`Total processed: ${roomsToMigrate.length}`);

    // Verify results
    const reservableCount = await locationsCollection.countDocuments({ isReservable: true });
    console.log(`\nVerification: ${reservableCount} total reservable locations in database`);

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('\nDatabase connection closed.');
    }
  }
}

// Run migration
migrateRoomsToLocations();
