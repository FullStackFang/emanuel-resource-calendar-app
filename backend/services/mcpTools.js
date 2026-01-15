// backend/services/mcpTools.js
// MCP Tool Layer - Wraps existing API functionality for AI assistant
// These tools can be used by Claude and later exposed via MCP protocol for Claude Desktop

const logger = require('../utils/logger');
const { ObjectId } = require('mongodb');

// Load calendar config for default calendar assignment
const calendarConfig = require('../calendar-config.json');
const DEFAULT_CALENDAR_OWNER = 'TempleEventsSandbox@emanuelnyc.org';
const DEFAULT_CALENDAR_ID = calendarConfig[DEFAULT_CALENDAR_OWNER] || null;

// Helper to safely convert string to ObjectId
function toObjectId(str) {
  try {
    return ObjectId.isValid(str) ? new ObjectId(str) : null;
  } catch {
    return null;
  }
}

/**
 * Tool definitions for Claude
 * These describe what tools are available and their parameters
 */
const toolDefinitions = [
  {
    name: 'list_locations',
    description: 'Get a list of available rooms/locations at Temple Emanuel. Use this when the user asks about available spaces, rooms, or venues.',
    input_schema: {
      type: 'object',
      properties: {
        reservableOnly: {
          type: 'boolean',
          description: 'Only show reservable rooms (default: true)'
        },
        minCapacity: {
          type: 'number',
          description: 'Minimum capacity required'
        }
      }
    }
  },
  {
    name: 'list_categories',
    description: 'Get the list of available event categories. Use this when you need to know what categories are available for creating an event.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'search_events',
    description: 'Search for events on the calendar. Use this when the user asks about upcoming events, what\'s scheduled, or wants to find specific events.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format. Defaults to today.'
        },
        endDate: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format. Defaults to 7 days from start.'
        },
        searchText: {
          type: 'string',
          description: 'Text to search for in event titles'
        },
        locationId: {
          type: 'string',
          description: 'Filter by specific location/room ID'
        }
      }
    }
  },
  {
    name: 'check_availability',
    description: 'Check if a specific room is available at a given date and time. Use this before creating an event to verify the space is free.',
    input_schema: {
      type: 'object',
      properties: {
        locationId: {
          type: 'string',
          description: 'The room/location ID to check'
        },
        date: {
          type: 'string',
          description: 'Date to check in YYYY-MM-DD format'
        },
        startTime: {
          type: 'string',
          description: 'Start time in HH:MM format (24-hour)'
        },
        endTime: {
          type: 'string',
          description: 'End time in HH:MM format (24-hour)'
        }
      },
      required: ['date', 'startTime', 'endTime']
    }
  },
  {
    name: 'prepare_event_request',
    description: 'Prepare an event/room reservation request for user review. This validates the inputs and returns data to open a pre-populated reservation form. The user will review and submit the form themselves. Use this when the user wants to book/reserve a room or space. IMPORTANT: You MUST use list_locations first to get a valid location ID.',
    input_schema: {
      type: 'object',
      properties: {
        eventTitle: {
          type: 'string',
          description: 'Title/name of the event (required)'
        },
        eventDescription: {
          type: 'string',
          description: 'Description of the event'
        },
        category: {
          type: 'string',
          description: 'Event category (required) - use list_categories to see available options. Use the exact category name from the list.'
        },
        date: {
          type: 'string',
          description: 'Date of the event in YYYY-MM-DD format (required)'
        },
        eventStartTime: {
          type: 'string',
          description: 'Event start time in HH:MM format 24-hour (required)'
        },
        eventEndTime: {
          type: 'string',
          description: 'Event end time in HH:MM format 24-hour (required)'
        },
        setupTime: {
          type: 'string',
          description: 'Setup start time in HH:MM format (required). Recommend 30-60 min before event.'
        },
        doorOpenTime: {
          type: 'string',
          description: 'Door open time in HH:MM format (required). When attendees can start arriving.'
        },
        doorCloseTime: {
          type: 'string',
          description: 'Door close time in HH:MM format (optional). Usually same as event end.'
        },
        teardownTime: {
          type: 'string',
          description: 'Teardown end time in HH:MM format (optional). Typically 1 hour after event end.'
        },
        locationId: {
          type: 'string',
          description: 'The room/location ID to reserve (REQUIRED) - MUST be an exact ID from list_locations results.'
        },
        attendeeCount: {
          type: 'number',
          description: 'Expected number of attendees'
        }
      },
      required: ['eventTitle', 'category', 'date', 'eventStartTime', 'eventEndTime', 'setupTime', 'doorOpenTime', 'locationId']
    }
  }
];

/**
 * MCP Tool Executor
 * Executes tools by calling existing API/database logic
 */
class MCPToolExecutor {
  constructor(db) {
    this.db = db;
    this.locationsCollection = db.collection('templeEvents__Locations');
    this.eventsCollection = db.collection('templeEvents__Events');
    this.categoriesCollection = db.collection('templeEvents__Categories');
  }

  /**
   * Execute a tool by name
   */
  async execute(toolName, input, userContext) {
    logger.debug(`[MCP] Executing tool: ${toolName}`, { input });

    try {
      switch (toolName) {
        case 'list_locations':
          return await this.listLocations(input);
        case 'list_categories':
          return await this.listCategories();
        case 'search_events':
          return await this.searchEvents(input);
        case 'check_availability':
          return await this.checkAvailability(input);
        case 'prepare_event_request':
          return await this.prepareEventRequest(input, userContext);
        default:
          return { error: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      logger.error(`[MCP] Tool error (${toolName}):`, error.message);
      return { error: error.message };
    }
  }

  /**
   * Normalize a location string for comparison
   * Handles variations like "bluementhal_hall" → "blumenthal hall"
   */
  normalizeLocationString(str) {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/[-_]/g, ' ')        // hyphens and underscores to spaces
      .replace(/[^a-z0-9\s]/g, '')  // remove other special chars
      .replace(/\s+/g, ' ')         // collapse whitespace
      .trim();
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
    }
    return dp[m][n];
  }

  /**
   * Calculate similarity score between two strings (0-1)
   * Uses multiple strategies: exact, contains, word overlap, and fuzzy matching
   */
  calculateSimilarity(searchTerm, locationName) {
    const s1 = this.normalizeLocationString(searchTerm);
    const s2 = this.normalizeLocationString(locationName);

    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1.0;

    let maxScore = 0;

    // Strategy 1: One contains the other (e.g., "blumenthal" in "blumenthal hall")
    if (s2.includes(s1)) {
      // Search term is contained in location name
      maxScore = Math.max(maxScore, 0.85 + (s1.length / s2.length) * 0.1);
    }
    if (s1.includes(s2)) {
      // Location name is contained in search term (rare but possible)
      maxScore = Math.max(maxScore, 0.8);
    }

    // Strategy 2: Word-level matching
    const words1 = s1.split(' ').filter(w => w.length >= 2);
    const words2 = s2.split(' ').filter(w => w.length >= 2);

    for (const w1 of words1) {
      for (const w2 of words2) {
        // Exact word match
        if (w1 === w2) {
          maxScore = Math.max(maxScore, 0.75);
        }
        // Word contains (e.g., "blumen" matches "blumenthal")
        else if (w2.includes(w1) && w1.length >= 3) {
          maxScore = Math.max(maxScore, 0.6 + (w1.length / w2.length) * 0.2);
        }
        else if (w1.includes(w2) && w2.length >= 3) {
          maxScore = Math.max(maxScore, 0.6 + (w2.length / w1.length) * 0.2);
        }
        // Fuzzy word match using Levenshtein
        else if (w1.length >= 4 && w2.length >= 4) {
          const distance = this.levenshteinDistance(w1, w2);
          const maxLen = Math.max(w1.length, w2.length);
          const similarity = 1 - (distance / maxLen);
          if (similarity >= 0.7) {  // Allow ~30% character difference
            maxScore = Math.max(maxScore, similarity * 0.7);
          }
        }
      }
    }

    // Strategy 3: Overall string similarity using Levenshtein
    const distance = this.levenshteinDistance(s1, s2);
    const maxLen = Math.max(s1.length, s2.length);
    const overallSimilarity = 1 - (distance / maxLen);
    if (overallSimilarity > 0.6) {
      maxScore = Math.max(maxScore, overallSimilarity * 0.8);
    }

    return maxScore;
  }

  /**
   * Find the best matching location name from known locations
   * Always returns a result with confidence info
   */
  async findBestLocationMatch(searchTerm) {
    if (!searchTerm) return { match: null, confidence: 0, allMatches: [] };

    // Check if searchTerm looks like an ObjectId - if so, look it up directly
    if (ObjectId.isValid(searchTerm) && searchTerm.length === 24) {
      try {
        const location = await this.locationsCollection.findOne(
          { _id: new ObjectId(searchTerm) },
          { projection: { displayName: 1 } }
        );
        if (location && location.displayName) {
          logger.info(`[MCP] Found location by ObjectId: "${location.displayName}"`);
          return { match: location.displayName, confidence: 1.0, allMatches: [{ name: location.displayName, score: 1.0 }] };
        }
      } catch (e) {
        // Not a valid ObjectId, continue with fuzzy matching
      }
    }

    const normalized = this.normalizeLocationString(searchTerm);
    logger.info(`[MCP] Finding location match for: "${searchTerm}" (normalized: "${normalized}")`);

    // Get all unique location names from locations collection
    const locations = await this.locationsCollection
      .find({})
      .project({ displayName: 1 })
      .toArray();

    const locationNames = locations
      .map(l => l.displayName)
      .filter(Boolean);

    // Also get unique locationDisplayNames from events
    const eventLocations = await this.eventsCollection.distinct('locationDisplayName');
    const eventLocations2 = await this.eventsCollection.distinct('locationDisplayNames');

    const allNames = [...new Set([...locationNames, ...eventLocations, ...eventLocations2].filter(Boolean))];

    logger.info(`[MCP] Comparing against ${allNames.length} known locations`);

    // Score all locations
    const scored = allNames.map(name => ({
      name,
      score: this.calculateSimilarity(searchTerm, name)
    })).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

    // Get top matches
    const topMatches = scored.slice(0, 5);

    if (topMatches.length > 0) {
      logger.info(`[MCP] Top matches:`, topMatches.map(m => `${m.name} (${m.score.toFixed(2)})`).join(', '));
    } else {
      logger.info(`[MCP] No matches found for "${searchTerm}"`);
    }

    const bestMatch = topMatches[0] || null;

    return {
      match: bestMatch?.name || normalized,
      confidence: bestMatch?.score || 0,
      allMatches: topMatches
    };
  }

  /**
   * List available locations/rooms
   */
  async listLocations(input) {
    const { reservableOnly = true, minCapacity } = input || {};

    const query = {};
    if (reservableOnly) {
      query.isReservable = true;
    }
    // Note: We don't filter by minCapacity in the query because many rooms have capacity: 0
    // (meaning unknown). Instead, we'll return all rooms and note which ones have known capacity.

    const locations = await this.locationsCollection
      .find(query)
      .project({ _id: 1, displayName: 1, capacity: 1, features: 1, building: 1 })
      .toArray();

    // Sort in memory (Cosmos DB may not have index on displayName)
    locations.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));

    // If minCapacity specified, sort to show rooms with sufficient capacity first,
    // but still include rooms with unknown capacity (0)
    let sortedLocations = locations;
    if (minCapacity) {
      sortedLocations = locations.sort((a, b) => {
        const aCapOk = a.capacity >= minCapacity;
        const bCapOk = b.capacity >= minCapacity;
        const aUnknown = a.capacity === 0 || a.capacity === null;
        const bUnknown = b.capacity === 0 || b.capacity === null;

        // Priority: sufficient capacity > unknown capacity > insufficient capacity
        if (aCapOk && !bCapOk) return -1;
        if (!aCapOk && bCapOk) return 1;
        if (aUnknown && !bUnknown && !bCapOk) return -1;
        if (!aUnknown && bUnknown && !aCapOk) return 1;
        return (a.displayName || '').localeCompare(b.displayName || '');
      });
    }

    return {
      count: sortedLocations.length,
      locations: sortedLocations.map(l => ({
        id: l._id.toString(),
        name: l.displayName,
        capacity: l.capacity || 'unknown',
        features: l.features || [],
        building: l.building
      }))
    };
  }

  /**
   * List available categories
   */
  async listCategories() {
    const categories = await this.categoriesCollection
      .find({})
      .project({ _id: 1, name: 1, subcategories: 1 })
      .toArray();

    // Sort in memory (Cosmos DB may not have index on name)
    categories.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return {
      count: categories.length,
      categories: categories.map(c => ({
        id: c._id.toString(),
        name: c.name,
        subcategories: c.subcategories || []
      }))
    };
  }

  /**
   * Search for events
   */
  async searchEvents(input) {
    let { startDate, endDate, searchText, locationId } = input || {};

    logger.info(`[MCP] searchEvents called with:`, { startDate, endDate, searchText, locationId });

    // Smart detection: if searchText looks like a location, treat it as locationId
    if (searchText && !locationId) {
      const locationCheck = await this.findBestLocationMatch(searchText);
      if (locationCheck.confidence >= 0.7) {
        logger.info(`[MCP] Auto-detected "${searchText}" as location (confidence: ${locationCheck.confidence.toFixed(2)}), switching to location filter`);
        locationId = searchText;
        searchText = undefined;  // Clear searchText since it's actually a location
      }
    }

    // Default date range: today + 7 days
    const today = new Date();
    const startDateStr = startDate || today.toISOString().split('T')[0];

    let endDateStr;
    if (endDate) {
      endDateStr = endDate;
    } else {
      const defaultEnd = new Date(today);
      defaultEnd.setDate(defaultEnd.getDate() + 7);
      endDateStr = defaultEnd.toISOString().split('T')[0];
    }

    // Build datetime range strings for comparison (local time, NO UTC conversion)
    const startDateTimeStr = `${startDateStr}T00:00:00`;
    const endDateTimeStr = `${endDateStr}T23:59:59`;

    // Query using multiple field paths (events may use different structures)
    const dateQuery = {
      $or: [
        // Top-level startDateTime (normalized events)
        {
          startDateTime: { $gte: startDateTimeStr, $lte: endDateTimeStr }
        },
        // Nested start.dateTime (Graph API structure)
        {
          'start.dateTime': { $gte: startDateTimeStr, $lte: endDateTimeStr }
        },
        // Date-only field (fallback)
        {
          startDate: { $gte: startDateStr, $lte: endDateStr }
        }
      ]
    };

    const query = { ...dateQuery, isDeleted: { $ne: true } };

    if (searchText) {
      query.$and = [
        { $or: [
          { subject: { $regex: searchText, $options: 'i' } },
          { eventTitle: { $regex: searchText, $options: 'i' } }
        ]}
      ];
    }

    // Track location matching info for response
    let locationMatchInfo = null;

    if (locationId) {
      // Use fuzzy matching to find the best location name
      const matchResult = await this.findBestLocationMatch(locationId);
      locationMatchInfo = matchResult;
      const matchedLocation = matchResult.match;
      logger.info(`[MCP] Using location match: "${matchedLocation}" (confidence: ${matchResult.confidence.toFixed(2)}) for search`);

      const locationMatch = {
        $or: [
          { 'locationDisplayNames': { $regex: matchedLocation, $options: 'i' } },
          { 'locationDisplayName': { $regex: matchedLocation, $options: 'i' } },
          { 'location': { $regex: matchedLocation, $options: 'i' } },
          { 'graphData.location.displayName': { $regex: matchedLocation, $options: 'i' } }
        ]
      };
      query.$and = query.$and || [];
      query.$and.push(locationMatch);
    }

    logger.info(`[MCP] searchEvents query:`, JSON.stringify(query, null, 2));

    const events = await this.eventsCollection
      .find(query)
      .project({
        _id: 1,
        subject: 1,
        eventTitle: 1,
        start: 1,
        end: 1,
        startDateTime: 1,
        endDateTime: 1,
        startDate: 1,
        startTime: 1,
        endTime: 1,
        location: 1,
        locationDisplayNames: 1,
        organizer: 1,
        status: 1,
        syncStatus: 1
      })
      .limit(50)
      .toArray();

    logger.info(`[MCP] searchEvents found ${events.length} events`);
    if (events.length > 0) {
      logger.info(`[MCP] First event:`, events[0]);
    }

    // Sort by start time
    events.sort((a, b) => {
      const aTime = a.startDateTime || a.start?.dateTime || '';
      const bTime = b.startDateTime || b.start?.dateTime || '';
      return aTime.localeCompare(bTime);
    });

    // Return only first 20 after sorting
    const limitedEvents = events.slice(0, 20);

    const result = {
      count: limitedEvents.length,
      dateRange: { start: startDateStr, end: endDateStr },
      events: limitedEvents.map(e => ({
        id: e._id.toString(),
        title: e.eventTitle || e.subject || 'Untitled',
        start: e.startTime || e.startDateTime?.split('T')[1]?.substring(0, 5) || e.start?.dateTime?.split('T')[1]?.substring(0, 5),
        end: e.endTime || e.endDateTime?.split('T')[1]?.substring(0, 5) || e.end?.dateTime?.split('T')[1]?.substring(0, 5),
        date: e.startDate || e.startDateTime?.split('T')[0] || e.start?.dateTime?.split('T')[0],
        location: e.locationDisplayNames || e.locationDisplayName || e.location?.displayName || e.location,
        status: e.status,
        syncStatus: e.syncStatus
      }))
    };

    // Include location matching info if a location search was performed
    if (locationMatchInfo) {
      result.locationSearch = {
        searchedFor: locationId,
        matchedTo: locationMatchInfo.match,
        confidence: locationMatchInfo.confidence,
        otherMatches: locationMatchInfo.allMatches.slice(1, 4).map(m => m.name)
      };
      // Add helpful message if confidence is low
      if (locationMatchInfo.confidence < 0.5 && limitedEvents.length === 0) {
        result.locationSuggestion = `Could not find exact match for "${locationId}". Did you mean: ${locationMatchInfo.allMatches.slice(0, 3).map(m => m.name).join(', ')}?`;
      }
    }

    return result;
  }

  /**
   * Check room availability
   */
  async checkAvailability(input) {
    const { locationId, date, startTime, endTime } = input;

    logger.info(`[MCP] checkAvailability called with:`, { locationId, date, startTime, endTime });

    if (!date || !startTime || !endTime) {
      return { error: 'date, startTime, and endTime are required' };
    }

    // Build local datetime strings (matching database format - NO 'Z' suffix, NO UTC conversion)
    // Database stores times in America/New_York local time
    const startDateTimeStr = `${date}T${startTime}:00`;
    const endDateTimeStr = `${date}T${endTime}:00`;
    logger.info(`[MCP] checkAvailability date range:`, { startDateTimeStr, endDateTimeStr });

    // Use fuzzy matching to find the best location name
    let matchedLocation = locationId;
    let locationMatchInfo = null;
    if (locationId) {
      const matchResult = await this.findBestLocationMatch(locationId);
      locationMatchInfo = matchResult;
      matchedLocation = matchResult.match;
      logger.info(`[MCP] Using location match: "${matchedLocation}" (confidence: ${matchResult.confidence.toFixed(2)}) for availability check`);
    }

    // Build location query - check multiple location fields for flexible matching
    const locationQuery = matchedLocation ? {
      $or: [
        { 'locationDisplayNames': { $regex: matchedLocation, $options: 'i' } },
        { 'locationDisplayName': { $regex: matchedLocation, $options: 'i' } },
        { 'location': { $regex: matchedLocation, $options: 'i' } },
        { 'locations': { $regex: matchedLocation, $options: 'i' } },
        { 'graphData.location.displayName': { $regex: matchedLocation, $options: 'i' } },
        { 'graphData.locations.displayName': { $regex: matchedLocation, $options: 'i' } }
      ]
    } : {};

    // Query for overlapping events using string comparison
    // Event overlaps if: event.start < queryEnd AND event.end > queryStart
    // Check multiple field paths since events may use different structures
    const conflicts = await this.eventsCollection.find({
      ...locationQuery,
      $and: [
        // Event must start before query end (check multiple field paths)
        {
          $or: [
            { startDateTime: { $lt: endDateTimeStr } },
            { 'start.dateTime': { $lt: endDateTimeStr } },
            { startDate: { $lte: date } }  // Date-only fallback
          ]
        },
        // Event must end after query start (check multiple field paths)
        {
          $or: [
            { endDateTime: { $gt: startDateTimeStr } },
            { 'end.dateTime': { $gt: startDateTimeStr } },
            { endDate: { $gte: date } }  // Date-only fallback
          ]
        }
      ],
      isDeleted: { $ne: true },
      status: { $ne: 'rejected' }
    }).toArray();

    logger.info(`[MCP] checkAvailability found ${conflicts.length} conflicts`);
    if (conflicts.length > 0) {
      logger.info(`[MCP] First conflict:`, conflicts[0]);
    }

    // Build location info for response
    const locationInfo = locationMatchInfo ? {
      searchedFor: locationId,
      matchedTo: locationMatchInfo.match,
      confidence: locationMatchInfo.confidence,
      otherMatches: locationMatchInfo.allMatches.slice(1, 4).map(m => m.name)
    } : null;

    if (conflicts.length === 0) {
      const result = {
        available: true,
        message: `${matchedLocation || 'The space'} is available on ${date} from ${startTime} to ${endTime}`
      };
      if (locationInfo) {
        result.locationSearch = locationInfo;
        if (locationMatchInfo.confidence < 0.5) {
          result.locationNote = `Note: Low confidence match for "${locationId}". Other options: ${locationMatchInfo.allMatches.slice(0, 3).map(m => m.name).join(', ')}`;
        }
      }
      return result;
    }

    const result = {
      available: false,
      conflictCount: conflicts.length,
      conflicts: conflicts.slice(0, 5).map(c => ({
        title: c.eventTitle || c.graphData?.subject || 'Untitled Event',
        start: c.startTime || c.startDateTime?.split('T')[1]?.substring(0, 5),
        end: c.endTime || c.endDateTime?.split('T')[1]?.substring(0, 5),
        date: c.startDate || c.startDateTime?.split('T')[0]
      })),
      message: `Found ${conflicts.length} conflicting event(s) at ${matchedLocation || 'this location'}`
    };
    if (locationInfo) {
      result.locationSearch = locationInfo;
    }
    return result;
  }

  /**
   * Prepare an event request for user review (returns form data, does NOT create event)
   */
  async prepareEventRequest(input, userContext) {
    const {
      eventTitle,
      eventDescription,
      category,
      date,
      eventStartTime,
      eventEndTime,
      setupTime,
      doorOpenTime,
      doorCloseTime,
      teardownTime,
      locationId,
      attendeeCount
    } = input;

    // Validate required fields
    if (!eventTitle || !category || !date || !eventStartTime || !eventEndTime || !setupTime || !doorOpenTime || !locationId) {
      return {
        error: 'Missing required fields: eventTitle, category, date, eventStartTime, eventEndTime, setupTime, doorOpenTime, and locationId are all required'
      };
    }

    if (!userContext?.userId || !userContext?.email) {
      return { error: 'User context required' };
    }

    // Get location details - try ObjectId first, then string match
    const locationObjectId = toObjectId(locationId);
    logger.debug(`[MCP] Looking up location: ${locationId}, ObjectId: ${locationObjectId}`);
    const locationQuery = locationObjectId
      ? { $or: [{ _id: locationObjectId }, { displayName: { $regex: `^${locationId}$`, $options: 'i' } }] }
      : { displayName: { $regex: `^${locationId}$`, $options: 'i' } };
    const location = await this.locationsCollection.findOne(locationQuery);
    logger.debug(`[MCP] Location found: ${location ? location.displayName : 'NOT FOUND'}`);

    // Require a valid location to be found
    if (!location) {
      logger.warn(`[MCP] Location not found: ${locationId}`);
      return {
        error: `Location "${locationId}" not found. Use list_locations to see available rooms and use the exact ID or name from that list.`
      };
    }
    const locationName = location.displayName;

    // Verify category exists - try name match first, then ObjectId
    const categoryObjectId = toObjectId(category);
    logger.debug(`[MCP] Looking up category: ${category}`);
    const categoryQuery = categoryObjectId
      ? { $or: [{ name: { $regex: `^${category}$`, $options: 'i' } }, { _id: categoryObjectId }] }
      : { name: { $regex: `^${category}$`, $options: 'i' } };
    const categoryDoc = await this.categoriesCollection.findOne(categoryQuery);
    logger.debug(`[MCP] Category found: ${categoryDoc ? categoryDoc.name : 'NOT FOUND'}`);
    if (!categoryDoc) {
      logger.warn(`[MCP] Category not found: ${category}`);
      return { error: `Category "${category}" not found. Use list_categories to see available options.` };
    }

    // Check availability first
    logger.debug(`[MCP] Checking availability for ${locationName} on ${date} from ${setupTime} to ${teardownTime || eventEndTime}`);
    const availability = await this.checkAvailability({
      locationId: locationName,
      date,
      startTime: setupTime, // Check from setup time
      endTime: teardownTime || eventEndTime // To teardown time
    });
    logger.debug(`[MCP] Availability result: ${availability.available ? 'AVAILABLE' : 'NOT AVAILABLE'}`);

    if (!availability.available) {
      logger.warn(`[MCP] Time slot not available, conflicts: ${JSON.stringify(availability.conflicts)}`);
      return {
        success: false,
        error: 'Time slot not available',
        conflicts: availability.conflicts,
        message: `The ${locationName} is not available on ${date} from ${setupTime} to ${teardownTime || eventEndTime}. Please choose a different time or location.`
      };
    }

    // All validations passed! Return the form data for the frontend to display
    return {
      success: true,
      openReservationForm: true,  // Signal frontend to open form with this data
      message: `Ready to submit! Please review and confirm the details.`,
      formData: {
        eventTitle,
        eventDescription: eventDescription || '',
        category: categoryDoc.name,
        categoryId: categoryDoc._id.toString(),
        date,
        startDate: date,
        endDate: date,
        eventStartTime,
        eventEndTime,
        setupTime,
        doorOpenTime,
        doorCloseTime: doorCloseTime || eventEndTime,
        teardownTime: teardownTime || '',
        locationId: location._id.toString(),
        locationName,
        attendeeCount: attendeeCount || 0
      },
      summary: {
        title: eventTitle,
        location: locationName,
        date,
        time: `${eventStartTime} - ${eventEndTime}`,
        setup: setupTime,
        doors: doorOpenTime,
        teardown: teardownTime || 'Not specified',
        category: categoryDoc.name,
        attendees: attendeeCount || 'Not specified'
      }
    };
  }

  /**
   * Create an event request in templeEvents__Events (kept for potential future use)
   */
  async createEventRequest(input, userContext) {
    const {
      eventTitle,
      eventDescription,
      category,
      date,
      eventStartTime,
      eventEndTime,
      setupTime,
      doorOpenTime,
      doorCloseTime,
      teardownTime,
      locationId,
      attendeeCount
    } = input;

    // Validate required fields
    if (!eventTitle || !category || !date || !eventStartTime || !eventEndTime || !setupTime || !doorOpenTime || !locationId) {
      return {
        error: 'Missing required fields: eventTitle, category, date, eventStartTime, eventEndTime, setupTime, doorOpenTime, and locationId are all required'
      };
    }

    if (!userContext?.userId || !userContext?.email) {
      return { error: 'User context required to create event' };
    }

    // Get location details - try ObjectId first, then string match
    const locationObjectId = toObjectId(locationId);
    logger.debug(`[MCP] Looking up location: ${locationId}, ObjectId: ${locationObjectId}`);
    const locationQuery = locationObjectId
      ? { $or: [{ _id: locationObjectId }, { displayName: { $regex: `^${locationId}$`, $options: 'i' } }] }
      : { displayName: { $regex: `^${locationId}$`, $options: 'i' } };
    const location = await this.locationsCollection.findOne(locationQuery);
    logger.debug(`[MCP] Location found: ${location ? location.displayName : 'NOT FOUND'}`);

    // Require a valid location to be found
    if (!location) {
      logger.warn(`[MCP] Location not found: ${locationId}`);
      return {
        error: `Location "${locationId}" not found. Use list_locations to see available rooms and use the exact ID or name.`
      };
    }
    const locationName = location.displayName;

    // Verify category exists - try name match first, then ObjectId
    const categoryObjectId = toObjectId(category);
    logger.debug(`[MCP] Looking up category: ${category}`);
    const categoryQuery = categoryObjectId
      ? { $or: [{ name: { $regex: `^${category}$`, $options: 'i' } }, { _id: categoryObjectId }] }
      : { name: { $regex: `^${category}$`, $options: 'i' } };
    const categoryDoc = await this.categoriesCollection.findOne(categoryQuery);
    logger.debug(`[MCP] Category found: ${categoryDoc ? categoryDoc.name : 'NOT FOUND'}`);
    if (!categoryDoc) {
      logger.warn(`[MCP] Category not found: ${category}`);
      return { error: `Category "${category}" not found. Use list_categories to see available options.` };
    }

    // Build datetime strings
    const startDateTime = `${date}T${eventStartTime}:00`;
    const endDateTime = `${date}T${eventEndTime}:00`;

    // Check availability first
    logger.debug(`[MCP] Checking availability for ${locationName} on ${date} from ${setupTime} to ${teardownTime || eventEndTime}`);
    const availability = await this.checkAvailability({
      locationId: locationName,
      date,
      startTime: setupTime, // Check from setup time
      endTime: teardownTime || eventEndTime // To teardown time
    });
    logger.debug(`[MCP] Availability result: ${availability.available ? 'AVAILABLE' : 'NOT AVAILABLE'}`);
    if (!availability.available) {
      logger.warn(`[MCP] Time slot not available, conflicts: ${JSON.stringify(availability.conflicts)}`);
      return {
        success: false,
        error: 'Time slot not available',
        conflicts: availability.conflicts
      };
    }

    // Generate event ID
    const eventId = `evt-request-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();

    // Get the actual ObjectId for the location (guaranteed to exist since we validated above)
    const locationObjectIdForStorage = location._id;

    // Create the event document matching the EXACT working schema
    // ALL event details go at TOP LEVEL, roomReservationData only has request metadata
    const eventDoc = {
      // Core identifiers
      eventId,
      userId: userContext.userId,
      source: 'AI Chat Assistant',
      status: 'pending',
      isDeleted: false,

      // Graph data structure (for Graph API compatibility)
      graphData: {
        subject: eventTitle,
        start: { dateTime: startDateTime, timeZone: 'America/New_York' },
        end: { dateTime: endDateTime, timeZone: 'America/New_York' },
        location: { displayName: locationName },
        bodyPreview: eventDescription || '',
        categories: [categoryDoc.name],
        isAllDay: false,
        importance: 'normal',
        showAs: 'busy',
        sensitivity: 'normal',
        attendees: [],
        organizer: {
          emailAddress: {
            name: userContext.name || userContext.email,
            address: userContext.email
          }
        }
      },

      // Internal data (for internal tracking)
      internalData: {
        mecCategories: [],
        setupMinutes: 0,
        teardownMinutes: 0,
        registrationNotes: '',
        assignedTo: '',
        staffAssignments: [],
        internalNotes: '',
        setupStatus: 'pending',
        estimatedCost: null,
        actualCost: null,
        customFields: {}
      },

      // Room reservation metadata ONLY (not event details!)
      roomReservationData: {
        requestedBy: {
          userId: userContext.userId,
          name: userContext.name || userContext.email,
          email: userContext.email,
          department: '',
          phone: ''
        },
        contactPerson: null,
        submittedAt: now,
        changeKey: Math.random().toString(36).substring(2, 18),
        currentRevision: 1,
        reviewingBy: null,
        reviewedBy: null,
        reviewNotes: '',
        createdGraphEventIds: [],
        calendarMode: null,
        communicationHistory: []
      },

      // ALL EVENT DETAILS AT TOP LEVEL (this is the key fix!)
      eventTitle,
      eventDescription: eventDescription || '',
      startDateTime,
      endDateTime,
      startDate: date,
      startTime: eventStartTime,
      endDate: date,
      endTime: eventEndTime,
      setupTime,
      teardownTime: teardownTime || '',
      doorOpenTime,
      doorCloseTime: doorCloseTime || eventEndTime,
      setupTimeMinutes: 0,
      teardownTimeMinutes: 0,
      setupNotes: '',
      doorNotes: '',
      eventNotes: '',
      location: locationName,
      locationDisplayNames: locationName,
      locations: [locationObjectIdForStorage],  // ObjectId, not string
      attendeeCount: attendeeCount || 0,
      specialRequirements: '',
      isAllDayEvent: false,
      virtualMeetingUrl: null,
      virtualPlatform: null,
      isOffsite: false,
      offsiteName: '',
      offsiteAddress: '',
      offsiteLat: null,
      offsiteLon: null,
      categories: [categoryDoc.name],
      assignedTo: '',
      services: {},

      // Tracking fields
      createdAt: now,
      createdBy: userContext.userId,
      createdByEmail: userContext.email,
      createdByName: userContext.name || userContext.email,
      createdSource: 'ai-chat',
      createdFromChat: true,
      lastModifiedDateTime: now,
      lastSyncedAt: now,

      // Calendar info
      calendarId: DEFAULT_CALENDAR_ID,
      calendarOwner: DEFAULT_CALENDAR_OWNER.toLowerCase(),
      sourceCalendars: [DEFAULT_CALENDAR_ID],
      sourceMetadata: {},

      // Status fields
      syncStatus: 'pending',
      reviewStatus: 'pending'
    };

    logger.debug(`[MCP] Inserting event: ${eventTitle}`);
    const result = await this.eventsCollection.insertOne(eventDoc);
    logger.info(`[MCP] Event created successfully: ${result.insertedId}`);

    return {
      success: true,
      eventId: result.insertedId.toString(),
      status: 'pending',
      syncStatus: 'pending',
      reviewStatus: 'pending',
      refreshCalendar: true,  // Signal frontend to refresh calendar
      message: `Event request created for "${eventTitle}" at ${locationName} on ${date} from ${eventStartTime} to ${eventEndTime}. Status: PENDING review and approval.`,
      details: {
        eventTitle,
        category: categoryDoc.name,
        location: locationName,
        date,
        setupTime,
        doorOpenTime,
        eventStartTime,
        eventEndTime,
        doorCloseTime: doorCloseTime || eventEndTime,
        teardownTime: teardownTime || 'not set',
        attendeeCount
      }
    };
  }
}

module.exports = {
  toolDefinitions,
  MCPToolExecutor
};
