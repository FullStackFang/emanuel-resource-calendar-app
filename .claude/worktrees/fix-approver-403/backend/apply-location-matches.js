// apply-location-matches.js
// Phase 2: Apply location matches from reviewed CSV
//
// Purpose:
// - Read the reviewed CSV file
// - Apply location updates to events where action = "UPDATE"
// - Use manualLocationIds if provided, otherwise use proposedLocationIds
// - Recalculate locationDisplayNames from the assigned locations
//
// Run with: node apply-location-matches.js --file csv-imports/location-matches-YYYY-MM-DD.csv
// Optional: --dry-run to preview changes without applying

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');
const path = require('path');
const { calculateLocationDisplayNames } = require('./utils/locationUtils');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';

/**
 * Parse CSV content into array of objects
 * @param {string} content - CSV file content
 * @returns {Array} Array of row objects
 */
function parseCSV(content) {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length < 2) return [];

  // Parse header
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

/**
 * Parse a single CSV row handling quoted fields
 * @param {string} line - CSV line
 * @returns {Array} Array of field values
 */
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
        // Escaped quote
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

/**
 * Parse semicolon-separated ObjectIds string
 * @param {string} str - Semicolon-separated ID string
 * @returns {Array<ObjectId>} Array of ObjectIds
 */
function parseLocationIds(str) {
  if (!str || !str.trim()) return [];

  return str
    .split(';')
    .map(s => s.trim())
    .filter(s => s && s !== 'VIRTUAL_NOT_FOUND')
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

async function applyLocationMatches() {
  // Parse command line arguments
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

  if (!csvFile) {
    console.error('Usage: node apply-location-matches.js --file <csv-file> [--dry-run]');
    console.error('Example: node apply-location-matches.js --file csv-imports/location-matches-2024-01-15.csv');
    process.exit(1);
  }

  // Resolve file path
  const resolvedPath = path.isAbsolute(csvFile) ? csvFile : path.join(__dirname, csvFile);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: CSV file not found: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(`${dryRun ? '[DRY RUN] ' : ''}Applying location matches from CSV\n`);
  console.log('Configuration:');
  console.log(`  CSV file: ${resolvedPath}`);
  console.log(`  Database: ${DB_NAME}`);
  console.log(`  Dry run: ${dryRun}\n`);

  // Read and parse CSV
  console.log('Reading CSV file...');
  const content = fs.readFileSync(resolvedPath, 'utf8');
  const rows = parseCSV(content);
  console.log(`  Found ${rows.length} rows\n`);

  // Filter to UPDATE rows only
  const updateRows = rows.filter(row => row.action && row.action.toUpperCase() === 'UPDATE');
  console.log(`  Rows marked for UPDATE: ${updateRows.length}\n`);

  if (updateRows.length === 0) {
    console.log('No rows to update. Exiting.');
    process.exit(0);
  }

  // Validate environment
  if (!MONGODB_URI) {
    console.error('Error: MONGODB_CONNECTION_STRING or MONGODB_URI not defined in .env');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const eventsCollection = db.collection('templeEvents__Events');

    // Process updates
    console.log('Processing updates...');
    const stats = {
      total: 0,
      updated: 0,
      skipped: 0,
      errors: 0
    };

    const BATCH_SIZE = 50;
    const updates = [];

    for (const row of updateRows) {
      stats.total++;

      try {
        // Determine which location IDs to use
        const manualIds = row.manualLocationIds?.trim();
        const proposedIds = row.proposedLocationIds?.trim();
        const locationIdsStr = manualIds || proposedIds;

        if (!locationIdsStr) {
          console.log(`  Skipping event ${row.eventId}: No location IDs provided`);
          stats.skipped++;
          continue;
        }

        const locationIds = parseLocationIds(locationIdsStr);

        if (locationIds.length === 0) {
          console.log(`  Skipping event ${row.eventId}: No valid location IDs`);
          stats.skipped++;
          continue;
        }

        // Calculate display names
        const locationDisplayNames = await calculateLocationDisplayNames(locationIds, db);

        // Build update document
        const updateDoc = {
          $set: {
            locations: locationIds,
            locationDisplayNames,
            locationMatchStatus: 'matched',
            updatedAt: new Date()
          }
        };

        // Handle virtual meeting fields
        if (row.matchStatus === 'virtual' && row.virtualMeetingUrl) {
          updateDoc.$set.virtualMeetingUrl = row.virtualMeetingUrl;
          updateDoc.$set.virtualPlatform = row.virtualPlatform || 'Virtual Meeting';
        }

        // Remove unmatched tracking fields if present
        updateDoc.$unset = {
          unmatchedLocationStrings: ''
        };

        if (dryRun) {
          console.log(`  [DRY RUN] Would update event ${row.eventId}:`);
          console.log(`    locations: [${locationIds.map(id => id.toString()).join(', ')}]`);
          console.log(`    locationDisplayNames: "${locationDisplayNames}"`);
          stats.updated++;
        } else {
          updates.push({
            updateOne: {
              filter: { _id: new ObjectId(row.eventId) },
              update: updateDoc
            }
          });
        }

        // Execute batch if full
        if (!dryRun && updates.length >= BATCH_SIZE) {
          const result = await eventsCollection.bulkWrite(updates, { ordered: false });
          stats.updated += result.modifiedCount;
          console.log(`  Batch updated: ${result.modifiedCount} events`);
          updates.length = 0;

          // Small delay for rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        }

      } catch (error) {
        console.error(`  Error processing event ${row.eventId}: ${error.message}`);
        stats.errors++;
      }
    }

    // Execute remaining updates
    if (!dryRun && updates.length > 0) {
      const result = await eventsCollection.bulkWrite(updates, { ordered: false });
      stats.updated += result.modifiedCount;
      console.log(`  Final batch updated: ${result.modifiedCount} events`);
    }

    console.log('\nUpdate complete!\n');
    console.log('Statistics:');
    console.log(`  Total rows processed: ${stats.total}`);
    console.log(`  Events updated: ${stats.updated}`);
    console.log(`  Events skipped: ${stats.skipped}`);
    console.log(`  Errors: ${stats.errors}`);

    if (dryRun) {
      console.log('\n[DRY RUN] No changes were made to the database.');
      console.log('Run without --dry-run to apply changes.');
    }

  } catch (error) {
    console.error('Update failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\nDisconnected from MongoDB');
  }
}

// Run
applyLocationMatches()
  .then(() => {
    console.log('\nApply script finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Apply script failed:', error);
    process.exit(1);
  });
