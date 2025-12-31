// apply-location-mapping.js
// Apply location mappings from the reviewed CSV to all matching events
//
// Usage: node apply-location-mapping.js [--dry-run] [--file <path>]
// Default file: csv-imports/location-mapping-YYYY-MM-DD.csv (most recent)

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');
const path = require('path');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';

function parseCSV(content) {
  // Skip comment lines and empty lines
  const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
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

async function applyMapping() {
  const args = process.argv.slice(2);
  let csvFile = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) {
      csvFile = args[i + 1];
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  // Find most recent mapping file if not specified
  if (!csvFile) {
    const csvDir = path.join(__dirname, 'csv-imports');
    const files = fs.readdirSync(csvDir).filter(f => f.startsWith('location-mapping-') && f.endsWith('.csv'));
    if (files.length === 0) {
      console.error('No mapping file found. Run export-location-mapping.js first.');
      process.exit(1);
    }
    files.sort().reverse();
    csvFile = path.join(csvDir, files[0]);
  }

  const resolvedPath = path.isAbsolute(csvFile) ? csvFile : path.join(__dirname, csvFile);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(`${dryRun ? '[DRY RUN] ' : ''}Applying location mappings\n`);
  console.log(`File: ${resolvedPath}\n`);

  // Read and parse CSV
  const content = fs.readFileSync(resolvedPath, 'utf8');
  const rows = parseCSV(content);
  console.log(`Loaded ${rows.length} mapping rows\n`);

  // Filter to rows with finalLocationIds
  const mappings = rows.filter(row => row.finalLocationIds && row.finalLocationIds.trim());
  console.log(`Rows with finalLocationIds: ${mappings.length}\n`);

  if (mappings.length === 0) {
    console.log('No mappings to apply. Fill in finalLocationIds column in the CSV.');
    process.exit(0);
  }

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const eventsCollection = db.collection('templeEvents__Events');
    const locationsCollection = db.collection('templeEvents__Locations');

    // Load locations for display name lookup
    const locations = await locationsCollection.find({ active: { $ne: false } }).toArray();
    const locationNames = new Map(locations.map(l => [l._id.toString(), l.displayName || l.name]));

    let totalUpdated = 0;
    let totalEvents = 0;

    for (const mapping of mappings) {
      const originalDisplayName = mapping.originalDisplayName;
      const locationIds = parseLocationIds(mapping.finalLocationIds);

      if (locationIds.length === 0) {
        console.log(`  Skipping "${originalDisplayName}" - no valid IDs`);
        continue;
      }

      // Calculate display names
      const displayNames = locationIds.map(id => locationNames.get(id.toString()) || 'Unknown').join('; ');

      // Build query
      let query;
      if (originalDisplayName === '(empty)') {
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
          'graphData.location.displayName': originalDisplayName
        };
      }

      // Count matching events
      const count = await eventsCollection.countDocuments(query);
      totalEvents += count;

      console.log(`  "${originalDisplayName.substring(0, 50)}${originalDisplayName.length > 50 ? '...' : ''}" → "${displayNames}" (${count} events)`);

      if (!dryRun && count > 0) {
        const result = await eventsCollection.updateMany(query, {
          $set: {
            locations: locationIds,
            locationDisplayNames: displayNames,
            updatedAt: new Date()
          }
        });
        totalUpdated += result.modifiedCount;
      }
    }

    console.log('\n' + '─'.repeat(60));
    console.log(`Total mappings applied: ${mappings.length}`);
    console.log(`Total events affected: ${totalEvents}`);
    if (dryRun) {
      console.log('\n[DRY RUN] No changes made. Run without --dry-run to apply.');
    } else {
      console.log(`Events updated: ${totalUpdated}`);
    }

  } finally {
    await client.close();
  }
}

applyMapping().catch(console.error);
