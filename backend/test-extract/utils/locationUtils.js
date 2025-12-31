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
 * If a location has a parent, uses the parent's displayName for calendar grouping
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

    // Collect parent IDs to fetch in one query
    const parentIds = locations
      .filter(loc => loc.parentLocationId)
      .map(loc => loc.parentLocationId);

    // Fetch parent location documents if any exist
    let parentMap = new Map();
    if (parentIds.length > 0) {
      const parents = await db.collection('templeEvents__Locations')
        .find({ _id: { $in: parentIds } })
        .toArray();
      parentMap = new Map(
        parents.map(parent => [parent._id.toString(), parent])
      );
    }

    // Build display names in the same order as input IDs
    // Use parent's displayName if location has a parent
    const displayNames = objectIds
      .map(id => {
        const location = locationMap.get(id.toString());
        if (!location) return null;

        // If location has a parent, use parent's displayName for grouping
        if (location.parentLocationId) {
          const parent = parentMap.get(location.parentLocationId.toString());
          if (parent) {
            return parent.displayName || parent.name;
          }
        }

        // Otherwise use location's own displayName
        return location.displayName || location.name;
      })
      .filter(name => name !== null);

    return displayNames.join('; ');
  } catch (error) {
    console.error('Error calculating location display names:', error);
    return '';
  }
}

/**
 * Calculate location codes (rsKey values) from an array of location IDs
 * Returns an array of rsKey strings for grouping/filtering
 * @param {ObjectId[]|string[]} locationIds - Array of location ObjectIds
 * @param {object} db - MongoDB database instance
 * @returns {Promise<string[]>} Array of rsKey values
 */
async function calculateLocationCodes(locationIds, db) {
  if (!locationIds || locationIds.length === 0) {
    return [];
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

    // Extract rsKey values, filtering out null/undefined
    const codes = locations
      .map(loc => loc.rsKey)
      .filter(code => code != null && code !== '');

    return codes;
  } catch (error) {
    console.error('Error calculating location codes:', error);
    return [];
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

/**
 * Detect if a location string is a URL (virtual meeting)
 * Checks for common URL patterns and virtual meeting platforms
 * @param {string} locationString - Location string to check
 * @returns {boolean} True if the location is a URL
 */
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

/**
 * Extract virtual meeting platform name from a URL
 * Returns a user-friendly platform name or generic "Virtual Meeting"
 * @param {string} locationString - Location URL string
 * @returns {string|null} Platform name or null if not a virtual location
 */
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

module.exports = {
  normalizeLocationString,
  parseLocationString,
  calculateLocationDisplayNames,
  calculateLocationCodes,
  syncLocationDisplayToGraph,
  extractLocationStrings,
  initializeLocationFields,
  isVirtualLocation,
  getVirtualPlatform
};
