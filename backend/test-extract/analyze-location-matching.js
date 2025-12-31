// analyze-location-matching.js
// Analyze current state of event locations and matching potential

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';

function normalizeString(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, ' ');
}

async function analyze() {
  console.log('=== EVENT LOCATION ANALYSIS ===\n');

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  // Get all locations for validation
  const locations = await db.collection('templeEvents__Locations').find({ active: { $ne: false } }).toArray();
  const locationIds = new Set(locations.map(l => l._id.toString()));
  const locationNames = new Map(locations.map(l => [l._id.toString(), l.displayName || l.name]));

  // Build alias map for auto-matching
  const aliasMap = new Map();
  for (const loc of locations) {
    // Add name and displayName
    if (loc.name) aliasMap.set(normalizeString(loc.name), { id: loc._id.toString(), name: loc.displayName || loc.name });
    if (loc.displayName) aliasMap.set(normalizeString(loc.displayName), { id: loc._id.toString(), name: loc.displayName || loc.name });
    // Add aliases
    if (loc.aliases) {
      for (const alias of loc.aliases) {
        const normalized = normalizeString(alias);
        if (normalized) {
          aliasMap.set(normalized, { id: loc._id.toString(), name: loc.displayName || loc.name });
        }
      }
    }
  }

  // Get all events
  const events = await db.collection('templeEvents__Events').find({ isDeleted: { $ne: true } }).toArray();

  let validLocations = 0;
  let invalidLocations = 0;
  let noLocations = 0;

  const uniqueDisplayNames = new Map(); // displayName -> { count, canMatch, matched, unmatched }

  for (const event of events) {
    const currentLocs = event.locations || [];
    const graphDisplayName = event.graphData?.location?.displayName || '';

    // Check if current locations are valid
    if (currentLocs.length > 0) {
      const allValid = currentLocs.every(id => locationIds.has(id.toString()));
      if (allValid) {
        validLocations++;
        continue; // Skip - already good
      } else {
        invalidLocations++;
      }
    } else {
      noLocations++;
    }

    // Track unique display names for events needing attention
    const displayKey = graphDisplayName || '(empty)';

    if (!uniqueDisplayNames.has(displayKey)) {
      // Try to auto-match
      const parts = graphDisplayName ? graphDisplayName.split(';').map(s => s.trim()).filter(s => s) : [];
      const matched = [];
      const unmatched = [];

      for (const part of parts) {
        const normalized = normalizeString(part);
        if (aliasMap.has(normalized)) {
          const loc = aliasMap.get(normalized);
          if (!matched.find(m => m.id === loc.id)) {
            matched.push(loc);
          }
        } else {
          unmatched.push(part);
        }
      }

      uniqueDisplayNames.set(displayKey, {
        count: 1,
        canMatch: unmatched.length === 0 && matched.length > 0,
        partialMatch: matched.length > 0 && unmatched.length > 0,
        matched,
        unmatched
      });
    } else {
      uniqueDisplayNames.get(displayKey).count++;
    }
  }

  // Calculate stats
  let autoMatchable = 0;
  let partialMatch = 0;
  let needsReview = 0;
  let emptyLocation = 0;
  let autoMatchEvents = 0;
  let partialEvents = 0;
  let reviewEvents = 0;
  let emptyEvents = 0;

  for (const [name, data] of uniqueDisplayNames) {
    if (name === '(empty)') {
      emptyLocation++;
      emptyEvents += data.count;
    } else if (data.canMatch) {
      autoMatchable++;
      autoMatchEvents += data.count;
    } else if (data.partialMatch) {
      partialMatch++;
      partialEvents += data.count;
    } else {
      needsReview++;
      reviewEvents += data.count;
    }
  }

  console.log('EVENTS:');
  console.log(`  Total events: ${events.length}`);
  console.log(`  Already have valid locations: ${validLocations} (no action needed)`);
  console.log(`  Have invalid/stale location IDs: ${invalidLocations}`);
  console.log(`  No locations assigned: ${noLocations}`);
  console.log('');
  console.log('UNIQUE DISPLAY NAMES (from graphData.location.displayName):');
  console.log(`  Total unique strings needing attention: ${uniqueDisplayNames.size}`);
  console.log(`  ✓ Can auto-match: ${autoMatchable} strings (${autoMatchEvents} events)`);
  console.log(`  ~ Partial match: ${partialMatch} strings (${partialEvents} events)`);
  console.log(`  ✗ Need review: ${needsReview} strings (${reviewEvents} events)`);
  console.log(`  ○ Empty location: ${emptyLocation} strings (${emptyEvents} events)`);
  console.log('');
  console.log('LOCATIONS:');
  console.log(`  Total locations: ${locations.length}`);
  console.log(`  Alias mappings available: ${aliasMap.size}`);
  console.log('');

  // Show sample of auto-matchable
  console.log('SAMPLE AUTO-MATCHABLE (first 10):');
  let count = 0;
  for (const [name, data] of uniqueDisplayNames) {
    if (data.canMatch && count < 10) {
      console.log(`  "${name}" → ${data.matched.map(m => m.name).join('; ')} (${data.count} events)`);
      count++;
    }
  }

  console.log('');
  console.log('SAMPLE NEEDING REVIEW (first 15):');
  count = 0;
  for (const [name, data] of uniqueDisplayNames) {
    if (!data.canMatch && name !== '(empty)' && count < 15) {
      const matchInfo = data.matched.length > 0 ? ` [matched: ${data.matched.map(m => m.name).join(', ')}]` : '';
      console.log(`  "${name}" - unmatched: ${data.unmatched.join(', ')}${matchInfo} (${data.count} events)`);
      count++;
    }
  }

  await client.close();
}

analyze().catch(console.error);
