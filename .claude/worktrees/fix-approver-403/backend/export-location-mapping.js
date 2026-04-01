// export-location-mapping.js
// Generate a user-friendly CSV for mapping event locations to templeEvents__Locations
//
// Output: Two CSVs
// 1. location-mapping.csv - The mapping file to review/edit
// 2. locations-reference.csv - Reference list of all locations with IDs

require('dotenv').config();
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';

function normalizeString(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, ' ');
}

function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes(';')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function exportMapping() {
  console.log('=== LOCATION MAPPING EXPORT ===\n');

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  // Get all locations
  const locations = await db.collection('templeEvents__Locations').find({ active: { $ne: false } }).toArray();
  console.log(`Loaded ${locations.length} locations\n`);

  // Build alias map for auto-matching
  const aliasMap = new Map();
  for (const loc of locations) {
    const addMapping = (str) => {
      const normalized = normalizeString(str);
      if (normalized) {
        aliasMap.set(normalized, { id: loc._id.toString(), name: loc.displayName || loc.name });
      }
    };

    if (loc.name) addMapping(loc.name);
    if (loc.displayName) addMapping(loc.displayName);
    if (loc.aliases) {
      for (const alias of loc.aliases) {
        addMapping(alias);
      }
    }
  }

  // Get all events and group by unique displayName
  const events = await db.collection('templeEvents__Events').find({ isDeleted: { $ne: true } }).toArray();
  console.log(`Loaded ${events.length} events\n`);

  // Track valid location IDs
  const validLocationIds = new Set(locations.map(l => l._id.toString()));

  // Group events by graphData.location.displayName
  const displayNameGroups = new Map();

  for (const event of events) {
    const currentLocs = event.locations || [];

    // Skip events that already have valid locations
    if (currentLocs.length > 0) {
      const allValid = currentLocs.every(id => validLocationIds.has(id.toString()));
      if (allValid) continue;
    }

    const displayName = event.graphData?.location?.displayName || '';

    if (!displayNameGroups.has(displayName)) {
      displayNameGroups.set(displayName, {
        count: 0,
        sampleEventId: event._id.toString(),
        sampleTitle: event.graphData?.subject || event.eventTitle || ''
      });
    }
    displayNameGroups.get(displayName).count++;
  }

  console.log(`Found ${displayNameGroups.size} unique display name strings needing mapping\n`);

  // Process each unique display name
  const mappingRows = [];

  for (const [displayName, data] of displayNameGroups) {
    // Parse semicolon-separated parts
    const parts = displayName ? displayName.split(';').map(s => s.trim()).filter(s => s) : [];

    // Try to auto-match each part
    const matchedParts = [];
    const unmatchedParts = [];

    for (const part of parts) {
      const normalized = normalizeString(part);
      if (aliasMap.has(normalized)) {
        const match = aliasMap.get(normalized);
        matchedParts.push({ original: part, ...match });
      } else {
        unmatchedParts.push(part);
      }
    }

    // Determine status
    let status;
    if (parts.length === 0) {
      status = 'EMPTY';
    } else if (unmatchedParts.length === 0) {
      status = 'AUTO';
    } else if (matchedParts.length > 0) {
      status = 'PARTIAL';
    } else {
      status = 'MANUAL';
    }

    mappingRows.push({
      originalDisplayName: displayName || '(empty)',
      eventCount: data.count,
      status,
      parsedParts: parts.join(' | '),
      autoMatchedNames: matchedParts.map(m => m.name).join('; '),
      autoMatchedIds: matchedParts.map(m => m.id).join('; '),
      unmatchedParts: unmatchedParts.join('; '),
      // User fills these in:
      finalLocationNames: status === 'AUTO' ? matchedParts.map(m => m.name).join('; ') : '',
      finalLocationIds: status === 'AUTO' ? matchedParts.map(m => m.id).join('; ') : '',
      sampleEventTitle: data.sampleTitle
    });
  }

  // Sort: MANUAL first (need attention), then PARTIAL, then AUTO, then EMPTY
  const statusOrder = { 'MANUAL': 0, 'PARTIAL': 1, 'AUTO': 2, 'EMPTY': 3 };
  mappingRows.sort((a, b) => {
    const orderDiff = statusOrder[a.status] - statusOrder[b.status];
    if (orderDiff !== 0) return orderDiff;
    return b.eventCount - a.eventCount; // Then by event count descending
  });

  // Generate mapping CSV
  const csvDir = path.join(__dirname, 'csv-imports');
  if (!fs.existsSync(csvDir)) {
    fs.mkdirSync(csvDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().split('T')[0];
  const mappingPath = path.join(csvDir, `location-mapping-${timestamp}.csv`);

  const mappingHeaders = [
    'originalDisplayName',
    'eventCount',
    'status',
    'parsedParts',
    'autoMatchedNames',
    'autoMatchedIds',
    'unmatchedParts',
    'finalLocationNames',
    'finalLocationIds',
    'sampleEventTitle'
  ];

  const mappingLines = [
    '# LOCATION MAPPING - Review and fill in finalLocationIds for MANUAL/PARTIAL rows',
    '# Status: AUTO=ready to apply | PARTIAL=some matched | MANUAL=needs all IDs | EMPTY=no location',
    '# For multiple locations use semicolon separator: id1; id2; id3',
    '# Reference locations-reference.csv for available location IDs',
    '',
    mappingHeaders.join(',')
  ];

  for (const row of mappingRows) {
    mappingLines.push(mappingHeaders.map(h => escapeCSV(row[h])).join(','));
  }

  fs.writeFileSync(mappingPath, mappingLines.join('\n'), 'utf8');

  // Generate locations reference CSV
  const refPath = path.join(csvDir, `locations-reference-${timestamp}.csv`);

  const refHeaders = ['locationId', 'name', 'displayName', 'building', 'floor', 'isReservable', 'aliases'];
  const refLines = [
    '# LOCATIONS REFERENCE - Use these IDs in the mapping file',
    '',
    refHeaders.join(',')
  ];

  // Sort locations by name
  const sortedLocations = [...locations].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  for (const loc of sortedLocations) {
    refLines.push([
      escapeCSV(loc._id.toString()),
      escapeCSV(loc.name),
      escapeCSV(loc.displayName || ''),
      escapeCSV(loc.building || ''),
      escapeCSV(loc.floor || ''),
      loc.isReservable ? 'Yes' : 'No',
      escapeCSV((loc.aliases || []).join('; '))
    ].join(','));
  }

  fs.writeFileSync(refPath, refLines.join('\n'), 'utf8');

  // Print summary
  const stats = {
    auto: mappingRows.filter(r => r.status === 'AUTO').length,
    partial: mappingRows.filter(r => r.status === 'PARTIAL').length,
    manual: mappingRows.filter(r => r.status === 'MANUAL').length,
    empty: mappingRows.filter(r => r.status === 'EMPTY').length
  };

  const eventStats = {
    auto: mappingRows.filter(r => r.status === 'AUTO').reduce((sum, r) => sum + r.eventCount, 0),
    partial: mappingRows.filter(r => r.status === 'PARTIAL').reduce((sum, r) => sum + r.eventCount, 0),
    manual: mappingRows.filter(r => r.status === 'MANUAL').reduce((sum, r) => sum + r.eventCount, 0),
    empty: mappingRows.filter(r => r.status === 'EMPTY').reduce((sum, r) => sum + r.eventCount, 0)
  };

  console.log('SUMMARY:');
  console.log(`  AUTO (ready):     ${stats.auto} strings (${eventStats.auto} events)`);
  console.log(`  PARTIAL:          ${stats.partial} strings (${eventStats.partial} events)`);
  console.log(`  MANUAL (review):  ${stats.manual} strings (${eventStats.manual} events)`);
  console.log(`  EMPTY:            ${stats.empty} strings (${eventStats.empty} events)`);
  console.log('');
  console.log('FILES CREATED:');
  console.log(`  Mapping file: ${mappingPath}`);
  console.log(`  Reference:    ${refPath}`);
  console.log('');
  console.log('NEXT STEPS:');
  console.log('  1. Open location-mapping CSV in Excel');
  console.log('  2. For MANUAL/PARTIAL rows, fill in finalLocationIds');
  console.log('     - Use locations-reference CSV to look up IDs');
  console.log('     - Separate multiple IDs with semicolons');
  console.log('  3. Save and run: node apply-location-mapping.js');

  await client.close();
}

exportMapping().catch(console.error);
