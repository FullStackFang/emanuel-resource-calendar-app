/**
 * Location Utilities
 * Helper functions for parsing, matching, and managing location data
 */

const { ObjectId } = require('mongodb');

/**
 * Normalize a location string for consistent matching
 * Removes special characters, converts to lowercase, normalizes whitespace
 * @param {string} str - Location string to normalize
 * @returns {string} Normalized string
 */
function normalizeLocationString(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }

  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')  // remove special chars
    .trim()
    .replace(/\s+/g, ' ');         // normalize whitespace
}

/**
 * Parse a semicolon-delimited location string into an array of location strings
 * @param {string} locationString - Semicolon-delimited location string (e.g., "Temple; Chapel; Room 402")
 * @returns {string[]} Array of trimmed location strings
 */
function parseLocationString(locationString) {
  if (!locationString || typeof locationString !== 'string') {
    return [];
  }

  return locationString
    .split(';')
    .map(loc => loc.trim())
    .filter(loc => loc.length > 0);
}

/**
 * Calculate the display name string from an array of location IDs
 * Fetches location documents and joins their displayName fields
 * @param {ObjectId[]|string[]} locationIds - Array of location ObjectIds
 * @param {object} db - MongoDB database instance
 * @returns {Promise<string>} Semicolon-delimited location display names
 */
async function calculateLocationDisplayNames(locationIds, db) {
  if (!locationIds || locationIds.length === 0) {
    return '';
  }

  try {
    // Convert string IDs to ObjectIds if necessary
    const objectIds = locationIds.map(id =>
      typeof id === 'string' ? new ObjectId(id) : id
    );

    // Fetch location documents
    const locations = await db.collection('templeEvents__Locations')
      .find({ _id: { $in: objectIds } })
      .toArray();

    // Create a map for preserving order
    const locationMap = new Map(
      locations.map(loc => [loc._id.toString(), loc])
    );

    // Build display names in the same order as input IDs
    const displayNames = objectIds
      .map(id => {
        const location = locationMap.get(id.toString());
        return location ? (location.displayName || location.name) : null;
      })
      .filter(name => name !== null);

    return displayNames.join('; ');
  } catch (error) {
    console.error('Error calculating location display names:', error);
    return '';
  }
}

/**
 * Update an event's graphData.location.displayName with the calculated locationDisplayNames
 * Prepares event for syncing to Microsoft Graph API
 * @param {object} event - Event document with locations array
 * @param {object} db - MongoDB database instance
 * @returns {Promise<object>} Updated event object
 */
async function syncLocationDisplayToGraph(event, db) {
  if (!event) {
    return event;
  }

  // If event has locationDisplayNames, use it for graphData
  if (event.locationDisplayNames) {
    if (!event.graphData) {
      event.graphData = {};
    }
    if (!event.graphData.location) {
      event.graphData.location = {};
    }
    event.graphData.location.displayName = event.locationDisplayNames;
  }
  // If event has locations array but no displayNames, calculate it
  else if (event.locations && event.locations.length > 0) {
    const displayNames = await calculateLocationDisplayNames(event.locations, db);
    event.locationDisplayNames = displayNames;
    if (!event.graphData) {
      event.graphData = {};
    }
    if (!event.graphData.location) {
      event.graphData.location = {};
    }
    event.graphData.location.displayName = displayNames;
  }

  return event;
}

/**
 * Extract location strings from an event for matching/parsing
 * Handles both new structure (locationDisplayNames) and legacy (graphData.location.displayName)
 * @param {object} event - Event document
 * @returns {string[]} Array of location strings
 */
function extractLocationStrings(event) {
  let locationString = '';

  // Try new structure first
  if (event.locationDisplayNames) {
    locationString = event.locationDisplayNames;
  }
  // Fallback to graphData
  else if (event.graphData?.location?.displayName) {
    locationString = event.graphData.location.displayName;
  }
  // Legacy direct location field
  else if (event.location?.displayName) {
    locationString = event.location.displayName;
  }

  return parseLocationString(locationString);
}

/**
 * Initialize location fields on a new or imported event
 * Sets up the structure for future location assignment
 * @param {object} event - Event document (may be from Graph API or manual creation)
 * @returns {object} Event with initialized location fields
 */
function initializeLocationFields(event) {
  // Initialize locations array if not present
  if (!event.locations) {
    event.locations = [];
  }

  // Calculate locationDisplayNames from existing location data
  if (!event.locationDisplayNames) {
    if (event.graphData?.location?.displayName) {
      event.locationDisplayNames = event.graphData.location.displayName;
    } else if (event.location?.displayName) {
      event.locationDisplayNames = event.location.displayName;
    } else {
      event.locationDisplayNames = '';
    }
  }

  return event;
}

module.exports = {
  normalizeLocationString,
  parseLocationString,
  calculateLocationDisplayNames,
  syncLocationDisplayToGraph,
  extractLocationStrings,
  initializeLocationFields
};
