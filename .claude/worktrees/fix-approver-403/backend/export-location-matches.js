// export-location-matches.js
// Phase 1: Generate CSV report of event-location matches for review
//
// Purpose:
// - Analyze all events and their proposed location matches
// - Output CSV for manual review before applying changes
// - Auto-match locations using alias system
// - Flag unmatched locations for manual assignment
//
// Run with: node export-location-matches.js
// Output: csv-imports/location-matches-YYYY-MM-DD.csv

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');
const path = require('path');
const { normalizeLocationString, parseLocationString, isVirtualLocation, getVirtualPlatform } = require('./utils/locationUtils');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';

/**
 * Build a lookup map from normalized alias strings to location ObjectIds
 * @param {Array} locations - Array of location documents
 * @returns {Map} Map of normalized alias -> { locationId, locationName }
 */
function buildAliasMap(locations) {
  const aliasMap = new Map();

  for (const location of locations) {
    const locationInfo = {
      locationId: location._id,
      locationName: location.displayName || location.name
    };

    // Add aliases
    if (location.aliases && Array.isArray(location.aliases)) {
      for (const alias of location.aliases) {
        const normalized = normalizeLocationString(alias);
        if (normalized) {
          aliasMap.set(normalized, locationInfo);
        }
      }
    }

    // Add normalized name
    const normalizedName = normalizeLocationString(location.name);
    if (normalizedName) {
      aliasMap.set(normalizedName, locationInfo);
    }

    // Add normalized displayName
    if (location.displayName) {
      const normalizedDisplayName = normalizeLocationString(location.displayName);
      if (normalizedDisplayName) {
        aliasMap.set(normalizedDisplayName, locationInfo);
      }
    }
  }

  return aliasMap;
}

/**
 * Match a single location string against the alias map
 * @param {string} locationStr - Location string to match
 * @param {Map} aliasMap - Alias lookup map
 * @returns {object|null} Matched location info or null
 */
function matchLocation(locationStr, aliasMap) {
  if (!locationStr) return null;

  const normalized = normalizeLocationString(locationStr);
  if (!normalized) return null;

  // Exact match first
  if (aliasMap.has(normalized)) {
    return aliasMap.get(normalized);
  }

  // Try partial matching - check if any alias is contained in or contains the normalized string
  for (const [alias, locationInfo] of aliasMap.entries()) {
    // Skip very short aliases for partial matching to avoid false positives
    if (alias.length < 4) continue;

    if (normalized.includes(alias) || alias.includes(normalized)) {
      return locationInfo;
    }
  }

  return null;
}

/**
 * Process a single event and determine location matches
 * @param {object} event - Event document
 * @param {Map} aliasMap - Alias lookup map
 * @param {object} virtualLocation - Virtual Meeting location document
 * @param {Map} locationIdToName - Map of location ObjectId string to display name
 * @returns {object} Match result
 */
function processEvent(event, aliasMap, virtualLocation, locationIdToName) {
  const originalLocation = event.graphData?.location?.displayName || '';
  const currentLocationIds = event.locations || [];

  // Resolve current location IDs to names
  const currentLocationNames = currentLocationIds.map(id => {
    const name = locationIdToName.get(id.toString());
    return name || `Unknown (${id.toString()})`;
  });

  // Check for virtual meeting URL
  if (isVirtualLocation(originalLocation)) {
    return {
      eventId: event._id.toString(),
      eventTitle: event.graphData?.subject || event.eventTitle || '',
      eventDate: event.startDate || (event.graphData?.start?.dateTime ? event.graphData.start.dateTime.split('T')[0] : ''),
      originalLocation,
      currentLocationIds: currentLocationIds.map(id => id.toString()).join('; '),
      currentLocationNames: currentLocationNames.join('; '),
      proposedLocationIds: virtualLocation._id.toString(),
      proposedLocationNames: 'Virtual Meeting',
      matchStatus: 'virtual',
      unmatchedStrings: '',
      action: 'UPDATE',
      manualLocationIds: '',
      manualLocationNames: '',
      virtualMeetingUrl: originalLocation,
      virtualPlatform: getVirtualPlatform(originalLocation)
    };
  }

  // Empty location
  if (!originalLocation.trim()) {
    return {
      eventId: event._id.toString(),
      eventTitle: event.graphData?.subject || event.eventTitle || '',
      eventDate: event.startDate || (event.graphData?.start?.dateTime ? event.graphData.start.dateTime.split('T')[0] : ''),
      originalLocation: '',
      currentLocationIds: currentLocationIds.map(id => id.toString()).join('; '),
      currentLocationNames: currentLocationNames.join('; '),
      proposedLocationIds: '',
      proposedLocationNames: '',
      matchStatus: 'empty',
      unmatchedStrings: '',
      action: 'SKIP',
      manualLocationIds: '',
      manualLocationNames: '',
      virtualMeetingUrl: '',
      virtualPlatform: ''
    };
  }

  // Parse semicolon-delimited locations
  const locationStrings = parseLocationString(originalLocation);
  const matchedLocations = [];
  const unmatchedStrings = [];

  for (const locStr of locationStrings) {
    const match = matchLocation(locStr, aliasMap);
    if (match) {
      // Avoid duplicates
      if (!matchedLocations.find(m => m.locationId.toString() === match.locationId.toString())) {
        matchedLocations.push(match);
      }
    } else {
      unmatchedStrings.push(locStr);
    }
  }

  // Determine match status
  let matchStatus;
  let action;

  if (matchedLocations.length === 0 && unmatchedStrings.length > 0) {
    matchStatus = 'unmatched';
    action = 'REVIEW';
  } else if (matchedLocations.length > 0 && unmatchedStrings.length > 0) {
    matchStatus = 'partial';
    action = 'REVIEW';
  } else if (matchedLocations.length > 0) {
    matchStatus = 'matched';
    action = 'UPDATE';
  } else {
    matchStatus = 'empty';
    action = 'SKIP';
  }

  return {
    eventId: event._id.toString(),
    eventTitle: event.graphData?.subject || event.eventTitle || '',
    eventDate: event.startDate || (event.graphData?.start?.dateTime ? event.graphData.start.dateTime.split('T')[0] : ''),
    originalLocation,
    currentLocationIds: currentLocationIds.map(id => id.toString()).join('; '),
    currentLocationNames: currentLocationNames.join('; '),
    proposedLocationIds: matchedLocations.map(m => m.locationId.toString()).join('; '),
    proposedLocationNames: matchedLocations.map(m => m.locationName).join('; '),
    matchStatus,
    unmatchedStrings: unmatchedStrings.join('; '),
    action,
    manualLocationIds: '',
    manualLocationNames: '',
    virtualMeetingUrl: '',
    virtualPlatform: ''
  };
}

/**
 * Escape a field value for CSV
 * @param {string} value - Value to escape
 * @returns {string} Escaped value
 */
function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // If contains comma, quote, or newline, wrap in quotes and escape internal quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function exportLocationMatches() {
  console.log('Starting export of location matches for review\n');

  // Validate environment
  if (!MONGODB_URI) {
    console.error('Error: MONGODB_CONNECTION_STRING or MONGODB_URI not defined in .env');
    process.exit(1);
  }

  console.log('Configuration:');
  console.log(`  Database: ${DB_NAME}`);
  console.log(`  MongoDB URI: ${MONGODB_URI.substring(0, 30)}...\n`);

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const eventsCollection = db.collection('templeEvents__Events');
    const locationsCollection = db.collection('templeEvents__Locations');

    // Load all locations
    console.log('Loading locations...');
    const locations = await locationsCollection.find({ active: { $ne: false } }).toArray();
    console.log(`  Found ${locations.length} active locations\n`);

    // Build alias map
    console.log('Building alias lookup map...');
    const aliasMap = buildAliasMap(locations);
    console.log(`  Created ${aliasMap.size} alias mappings\n`);

    // Build location ID to name map for resolving current locations
    const locationIdToName = new Map();
    for (const loc of locations) {
      locationIdToName.set(loc._id.toString(), loc.displayName || loc.name);
    }

    // Get Virtual Meeting location
    const virtualLocation = locations.find(l => l.name === 'Virtual Meeting' || l.isVirtual === true);
    if (!virtualLocation) {
      console.error('Warning: "Virtual Meeting" location not found. Virtual meetings will be marked as unmatched.');
    } else {
      console.log(`  Virtual Meeting location ID: ${virtualLocation._id}\n`);
    }

    // Load all events
    console.log('Loading events...');
    const events = await eventsCollection.find({ isDeleted: { $ne: true } }).toArray();
    console.log(`  Found ${events.length} events to process\n`);

    // Process events
    console.log('Processing events...');
    const results = [];
    const stats = {
      total: 0,
      matched: 0,
      partial: 0,
      unmatched: 0,
      virtual: 0,
      empty: 0,
      skippedAlreadyHasLocations: 0
    };

    for (const event of events) {
      stats.total++;

      // SKIP events that already have valid location ObjectIds assigned
      const currentLocations = event.locations || [];
      if (currentLocations.length > 0) {
        // Verify these are valid ObjectIds referencing real locations
        const validLocationIds = currentLocations.filter(id => {
          const idStr = id.toString();
          return locations.some(loc => loc._id.toString() === idStr);
        });

        if (validLocationIds.length === currentLocations.length) {
          // All locations are valid - skip this event
          stats.skippedAlreadyHasLocations++;
          stats.matched++;
          continue;
        }
      }

      const result = processEvent(event, aliasMap, virtualLocation || { _id: 'VIRTUAL_NOT_FOUND', name: 'Virtual Meeting' }, locationIdToName);
      results.push(result);
      stats[result.matchStatus]++;

      if (stats.total % 500 === 0) {
        console.log(`  Processed ${stats.total}/${events.length} events...`);
      }
    }

    console.log(`\nProcessing complete!\n`);

    // Print statistics
    console.log('Statistics:');
    console.log(`  Total events scanned: ${stats.total}`);
    console.log(`  Already has valid locations (skipped): ${stats.skippedAlreadyHasLocations}`);
    console.log(`  ---`);
    console.log(`  Events needing review: ${results.length}`);
    console.log(`    - Can auto-match: ${stats.matched - stats.skippedAlreadyHasLocations}`);
    console.log(`    - Partial match: ${stats.partial}`);
    console.log(`    - Unmatched: ${stats.unmatched}`);
    console.log(`    - Virtual: ${stats.virtual}`);
    console.log(`    - Empty location: ${stats.empty}\n`);

    // Collect unique unmatched strings
    const unmatchedSet = new Set();
    for (const result of results) {
      if (result.unmatchedStrings) {
        result.unmatchedStrings.split('; ').filter(s => s).forEach(s => unmatchedSet.add(s));
      }
    }

    if (unmatchedSet.size > 0) {
      console.log('Unique unmatched location strings:');
      for (const str of Array.from(unmatchedSet).sort()) {
        console.log(`  - "${str}"`);
      }
      console.log('');
    }

    // Generate CSV
    const csvDir = path.join(__dirname, 'csv-imports');
    if (!fs.existsSync(csvDir)) {
      fs.mkdirSync(csvDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const csvPath = path.join(csvDir, `location-matches-${timestamp}.csv`);

    const headers = [
      'eventId',
      'eventTitle',
      'eventDate',
      'originalLocation',
      'currentLocationNames',
      'currentLocationIds',
      'proposedLocationNames',
      'proposedLocationIds',
      'matchStatus',
      'unmatchedStrings',
      'action',
      'manualLocationNames',
      'manualLocationIds',
      'virtualMeetingUrl',
      'virtualPlatform'
    ];

    const csvLines = [headers.join(',')];

    for (const result of results) {
      const row = headers.map(h => escapeCSV(result[h]));
      csvLines.push(row.join(','));
    }

    fs.writeFileSync(csvPath, csvLines.join('\n'), 'utf8');

    console.log(`CSV exported to: ${csvPath}`);
    console.log(`\nNext steps:`);
    console.log(`  1. Open the CSV in Excel`);
    console.log(`  2. Review rows with matchStatus = "unmatched" or "partial"`);
    console.log(`  3. For rows you want to update:`);
    console.log(`     - Set action = "UPDATE"`);
    console.log(`     - Optionally fill manualLocationIds with correct location IDs`);
    console.log(`  4. For rows to skip, set action = "SKIP"`);
    console.log(`  5. Save the CSV and run: node apply-location-matches.js --file ${csvPath}`);

    // Also generate locations reference
    const locRefPath = path.join(csvDir, 'locations-reference.csv');
    const locHeaders = ['_id', 'name', 'displayName', 'aliases', 'isReservable', 'isVirtual'];
    const locLines = [locHeaders.join(',')];

    for (const loc of locations) {
      locLines.push([
        escapeCSV(loc._id.toString()),
        escapeCSV(loc.name),
        escapeCSV(loc.displayName || ''),
        escapeCSV((loc.aliases || []).join('; ')),
        escapeCSV(loc.isReservable ? 'true' : 'false'),
        escapeCSV(loc.isVirtual ? 'true' : 'false')
      ].join(','));
    }

    fs.writeFileSync(locRefPath, locLines.join('\n'), 'utf8');
    console.log(`\nLocations reference exported to: ${locRefPath}`);

  } catch (error) {
    console.error('Export failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\nDisconnected from MongoDB');
  }
}

// Run export
exportLocationMatches()
  .then(() => {
    console.log('\nExport script finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Export script failed:', error);
    process.exit(1);
  });
