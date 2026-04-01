/**
 * Migrate Virtual Locations
 *
 * This script finds all existing events with URL-based locations and updates them
 * to use the "Virtual Meeting" location instead of showing raw URLs.
 *
 * Run this script once to update existing events:
 * node migrate-virtual-locations.js
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_CONNECTION_STRING = process.env.MONGODB_CONNECTION_STRING;
const MONGODB_DATABASE_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';

// Check if a location string is a URL (virtual meeting)
function isVirtualLocation(locationString) {
  if (!locationString || typeof locationString !== 'string') {
    return false;
  }

  const trimmed = locationString.trim();

  // Check for common URL patterns and virtual meeting platforms
  const urlPatterns = [
    /^https?:\/\//i,                    // Standard URLs (http:// or https://)
    /zoom\.us\//i,                       // Zoom
    /teams\.microsoft\.com/i,            // Microsoft Teams
    /meet\.google\.com/i,                // Google Meet
    /webex\.com/i,                       // Webex
    /gotomeeting\.com/i,                 // GoToMeeting
    /bluejeans\.com/i,                   // BlueJeans
    /whereby\.com/i,                     // Whereby
    /meet\.jit\.si/i                     // Jitsi Meet
  ];

  return urlPatterns.some(pattern => pattern.test(trimmed));
}

// Extract virtual meeting platform name from a URL
function getVirtualPlatform(locationString) {
  if (!isVirtualLocation(locationString)) {
    return null;
  }

  const platformMap = {
    'zoom.us': 'Zoom',
    'teams.microsoft.com': 'Microsoft Teams',
    'meet.google.com': 'Google Meet',
    'webex.com': 'Webex',
    'gotomeeting.com': 'GoToMeeting',
    'bluejeans.com': 'BlueJeans',
    'whereby.com': 'Whereby',
    'meet.jit.si': 'Jitsi Meet'
  };

  const lowerLocation = locationString.toLowerCase();

  for (const [domain, platform] of Object.entries(platformMap)) {
    if (lowerLocation.includes(domain)) {
      return platform;
    }
  }

  // Generic fallback for unrecognized platforms
  return 'Virtual Meeting';
}

async function migrateVirtualLocations() {
  const client = new MongoClient(MONGODB_CONNECTION_STRING);

  try {
    console.log('Connecting to MongoDB...');
    await client.connect();
    console.log('Connected successfully to MongoDB');

    const db = client.db(MONGODB_DATABASE_NAME);
    const eventsCollection = db.collection('templeEvents__Events');
    const locationsCollection = db.collection('templeEvents__Locations');

    // Find the Virtual Meeting location
    const virtualLocation = await locationsCollection.findOne({
      name: 'Virtual Meeting'
    });

    if (!virtualLocation) {
      console.error('\n❌ Virtual Meeting location not found in database!');
      console.log('Please run create-virtual-location.js first.');
      process.exit(1);
    }

    console.log('\n✓ Found Virtual Meeting location:', virtualLocation._id.toString());

    // Find all events
    console.log('\nSearching for events with URL-based locations...');
    const allEvents = await eventsCollection.find({}).toArray();
    console.log(`Found ${allEvents.length} total events to check`);

    let updatedCount = 0;
    let skippedCount = 0;
    const updatedEvents = [];

    for (const event of allEvents) {
      // Check if the event's location is a URL
      const locationDisplayName = event.graphData?.location?.displayName;

      if (!locationDisplayName) {
        skippedCount++;
        continue;
      }

      if (isVirtualLocation(locationDisplayName)) {
        const platform = getVirtualPlatform(locationDisplayName);

        // Update the event with Virtual Meeting location
        const updateResult = await eventsCollection.updateOne(
          { _id: event._id },
          {
            $set: {
              locations: [virtualLocation._id],
              locationDisplayNames: 'Virtual Meeting',
              locationId: virtualLocation._id,
              'graphData.location.virtualMeetingUrl': locationDisplayName,
              'graphData.location.isVirtual': true,
              'graphData.location.virtualPlatform': platform,
              updatedAt: new Date()
            }
          }
        );

        if (updateResult.modifiedCount > 0) {
          updatedCount++;
          updatedEvents.push({
            subject: event.graphData?.subject || 'Untitled',
            originalUrl: locationDisplayName,
            platform: platform,
            eventId: event.eventId
          });
          console.log(`  ✓ Updated: "${event.graphData?.subject}" - ${platform}`);
        }
      } else {
        skippedCount++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total events checked: ${allEvents.length}`);
    console.log(`Events updated: ${updatedCount}`);
    console.log(`Events skipped: ${skippedCount}`);

    if (updatedCount > 0) {
      console.log('\n✓ Successfully migrated virtual locations!');
      console.log('\nUpdated events:');
      updatedEvents.forEach((e, i) => {
        console.log(`  ${i + 1}. "${e.subject}" - ${e.platform}`);
        console.log(`     URL: ${e.originalUrl.substring(0, 60)}...`);
      });
    } else {
      console.log('\n✓ No events with virtual meeting URLs found.');
    }

  } catch (error) {
    console.error('\n❌ Error during migration:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\nMongoDB connection closed.');
  }
}

// Run the migration
migrateVirtualLocations();
