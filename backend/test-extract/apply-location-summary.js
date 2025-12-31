// apply-location-summary.js
// Applies location mappings from the summary CSV to all matching events
//
// Usage: node apply-location-summary.js [--dry-run]
// Reads: csv-imports/location-summary.csv

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');
const path = require('path');
const { calculateLocationDisplayNames } = require('./utils/locationUtils');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';

function parseCSV(content) {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVRow(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVRow(lines[i]);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row);
  }

  return rows;
}

function parseCSVRow(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && !inQuotes) {
      inQuotes = true;
    } else if (char === '"' && inQuotes) {
      if (nextChar === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = false;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }

  fields.push(field);
  return fields;
}

function parseLocationIds(str) {
  if (!str || !str.trim()) return [];

  return str
    .split(';')
    .map(s => s.trim())
    .filter(s => s)
    .map(s => {
      try {
        return new ObjectId(s);
      } catch (e) {
        console.warn(`  Warning: Invalid ObjectId "${s}"`);
        return null;
      }
    })
    .filter(id => id !== null);
}

async function applySummary() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`${dryRun ? '[DRY RUN] ' : ''}Applying location mappings from summary CSV\n`);

  // Read CSV
  const csvPath = path.join(__dirname, 'csv-imports', 'location-summary.csv');
  if (!fs.existsSync(csvPath)) {
    console.error(`Error: ${csvPath} not found`);
    console.error('Run: node generate-location-summary.js first');
    process.exit(1);
  }

  const content = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCSV(content);
  console.log(`Read ${rows.length} rows from CSV\n`);

  // Filter to rows with suggestedLocationId
  const mappings = rows.filter(row => row.suggestedLocationId && row.suggestedLocationId.trim());
  console.log(`Found ${mappings.length} rows with location mappings to apply\n`);

  if (mappings.length === 0) {
    console.log('No mappings to apply. Fill in suggestedLocationId column in the CSV.');
    process.exit(0);
  }

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const eventsCollection = db.collection('templeEvents__Events');

    let totalUpdated = 0;
    let totalEvents = 0;

    for (const mapping of mappings) {
      const originalLocation = mapping.originalLocation;
      const locationIds = parseLocationIds(mapping.suggestedLocationId);

      if (locationIds.length === 0) {
        console.log(`  Skipping "${originalLocation}" - no valid location IDs`);
        continue;
      }

      // Calculate display names
      const locationDisplayNames = await calculateLocationDisplayNames(locationIds, db);

      // Build query - handle (empty) specially
      let query;
      if (originalLocation === '(empty)') {
        query = {
          isDeleted: { $ne: true },
          $or: [
            { 'graphData.location.displayName': { $exists: false } },
            { 'graphData.location.displayName': '' },
            { 'graphData.location.displayName': null }
          ]
        };
      } else {
        query = {
          isDeleted: { $ne: true },
          'graphData.location.displayName': originalLocation
        };
      }

      // Count matching events
      const count = await eventsCollection.countDocuments(query);
      totalEvents += count;

      console.log(`  "${originalLocation}" -> "${locationDisplayNames}" (${count} events)`);

      if (!dryRun && count > 0) {
        const result = await eventsCollection.updateMany(query, {
          $set: {
            locations: locationIds,
            locationDisplayNames: locationDisplayNames,
            updatedAt: new Date()
          }
        });
        totalUpdated += result.modifiedCount;
      }
    }

    console.log('\n' + '─'.repeat(60));
    console.log(`Total events affected: ${totalEvents}`);
    if (dryRun) {
      console.log('[DRY RUN] No changes made. Run without --dry-run to apply.');
    } else {
      console.log(`Events updated: ${totalUpdated}`);
    }

  } finally {
    await client.close();
  }
}

applySummary().catch(console.error);
