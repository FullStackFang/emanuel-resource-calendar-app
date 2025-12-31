// generate-location-summary.js
// Creates a summary CSV grouped by unique originalLocation strings
// Much easier to review than individual events

require('dotenv').config();
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';

function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function generateSummary() {
  console.log('Generating location summary...\n');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);

    // Get all locations
    const locations = await db.collection('templeEvents__Locations').find({ active: { $ne: false } }).toArray();
    const locationMap = new Map(locations.map(l => [l._id.toString(), l.displayName || l.name]));
    console.log(`Loaded ${locations.length} locations\n`);

    // Get all events
    const events = await db.collection('templeEvents__Events').find({ isDeleted: { $ne: true } }).toArray();
    console.log(`Loaded ${events.length} events\n`);

    // Group by originalLocation
    const locationGroups = new Map();
    let skippedValid = 0;

    for (const event of events) {
      const currentLocs = event.locations || [];
      const validLocs = currentLocs.filter(id => locationMap.has(id.toString()));

      // Skip if already has valid locations
      if (validLocs.length === currentLocs.length && currentLocs.length > 0) {
        skippedValid++;
        continue;
      }

      const originalLocation = event.graphData?.location?.displayName || '(empty)';

      if (!locationGroups.has(originalLocation)) {
        locationGroups.set(originalLocation, {
          count: 0,
          sampleEventId: event._id.toString(),
          sampleTitle: event.graphData?.subject || event.eventTitle || ''
        });
      }
      locationGroups.get(originalLocation).count++;
    }

    console.log(`Skipped ${skippedValid} events with valid locations`);
    console.log(`Found ${locationGroups.size} unique location strings needing review\n`);

    // Sort by count descending
    const sorted = [...locationGroups.entries()].sort((a, b) => b[1].count - a[1].count);

    // Build CSV
    const lines = ['originalLocation,eventCount,sampleEventTitle,suggestedLocationName,suggestedLocationId'];

    for (const [loc, data] of sorted) {
      lines.push([
        escapeCSV(loc),
        data.count,
        escapeCSV(data.sampleTitle),
        '', // suggestedLocationName - user fills this
        ''  // suggestedLocationId - user fills this
      ].join(','));
    }

    // Write CSV
    const csvPath = path.join(__dirname, 'csv-imports', 'location-summary.csv');
    fs.writeFileSync(csvPath, lines.join('\n'), 'utf8');

    console.log(`Summary CSV written to: ${csvPath}`);
    console.log(`\nTop 20 unmatched locations by frequency:`);
    console.log('─'.repeat(60));

    for (let i = 0; i < Math.min(20, sorted.length); i++) {
      const [loc, data] = sorted[i];
      console.log(`  ${data.count.toString().padStart(4)} events: "${loc}"`);
    }

    console.log('\n─'.repeat(60));
    console.log('Next steps:');
    console.log('1. Open csv-imports/location-summary.csv in Excel');
    console.log('2. For each row, fill in suggestedLocationName and suggestedLocationId');
    console.log('3. Use csv-imports/locations-reference.csv to find the correct IDs');

  } finally {
    await client.close();
  }
}

generateSummary().catch(console.error);
