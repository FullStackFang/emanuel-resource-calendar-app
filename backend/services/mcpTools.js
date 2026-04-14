// backend/services/mcpTools.js
// MCP Tool Layer - Wraps existing API functionality for AI assistant
// These tools can be used by Claude and later exposed via MCP protocol for Claude Desktop

const logger = require('../utils/logger');
const { ObjectId } = require('mongodb');

// Load calendar config for default calendar assignment
const calendarConfig = require('../calendar-config.json');
const DEFAULT_CALENDAR_OWNER = 'TempleEventsSandbox@emanuelnyc.org';
const DEFAULT_CALENDAR_ID = calendarConfig[DEFAULT_CALENDAR_OWNER] || null;

// Escape regex special characters to prevent ReDoS from user/AI-supplied strings
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build a MongoDB category filter clause (shared by searchEvents and exportCalendarPdf)
function buildCategoryFilter(categories) {
  const categoryRegexes = categories.map(c => new RegExp(escapeRegex(c), 'i'));
  return {
    $or: [
      { categories: { $in: categoryRegexes } },
      { 'calendarData.categories': { $in: categoryRegexes } }
    ]
  };
}

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
    description: 'Search for events on the calendar. Use this when the user asks about upcoming events, what\'s scheduled, or wants to find specific events. Supports filtering by categories, status, location, time of day, and service type. Returns description, attendeeCount, and recurring event info when available.',
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
        },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by category names (e.g., ["Worship", "Education"]). Use list_categories to see available options.'
        },
        status: {
          type: 'string',
          enum: ['published', 'pending', 'draft', 'rejected', 'all'],
          description: 'Filter by event status. Default: shows published and pending. Use "pending" for awaiting-approval requests. "draft" shows only your own drafts. "all" requires approver/admin role.'
        },
        serviceFilter: {
          type: 'string',
          description: 'Filter events by service type. Examples: "catering", "AV", "security", "beverages". Matches against enabled services.'
        },
        afterTime: {
          type: 'string',
          description: 'Only return events starting at or after this time. HH:MM 24-hour format (e.g., "14:00" for 2pm). Use for "afternoon", "after 3pm", etc.'
        },
        beforeTime: {
          type: 'string',
          description: 'Only return events starting before this time. HH:MM 24-hour format (e.g., "12:00" for before noon). Use for "morning", "before 2pm", etc.'
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
    name: 'export_calendar_pdf',
    description: 'Generate a PDF calendar report for a date range. REQUIRES startDate and endDate. Optionally filter by categories and/or locations. The PDF downloads in the user\'s browser.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD (REQUIRED)' },
        endDate: { type: 'string', description: 'End date YYYY-MM-DD (REQUIRED)' },
        categories: { type: 'array', items: { type: 'string' }, description: 'Category names to filter by (optional)' },
        locations: { type: 'array', items: { type: 'string' }, description: 'Location display names to filter by (optional)' },
        sortBy: { type: 'string', enum: ['date', 'category', 'location'], description: 'Sort/group order (default: date)' },
        showMaintenanceTimes: { type: 'boolean', description: 'Include setup/teardown times (default: false)' },
        showSecurityTimes: { type: 'boolean', description: 'Include door open/close times (default: false)' },
        afterTime: { type: 'string', description: 'Only include events starting at or after this time (HH:MM, 24-hour). Use for morning/afternoon/evening filtering.' },
        beforeTime: { type: 'string', description: 'Only include events starting before this time (HH:MM, 24-hour). Use for morning/afternoon/evening filtering.' }
      },
      required: ['startDate', 'endDate']
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
          description: 'Setup start time in HH:MM format (optional). Recommend 30-60 min before event.'
        },
        doorOpenTime: {
          type: 'string',
          description: 'Door open time in HH:MM format (optional). When attendees can start arriving.'
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
        },
        reservationStartTime: {
          type: 'string',
          description: 'Reservation start time in HH:MM format (optional, when room reservation begins)'
        },
        reservationEndTime: {
          type: 'string',
          description: 'Reservation end time in HH:MM format (optional, when room reservation ends)'
        }
      },
      required: ['eventTitle', 'category', 'date', 'eventStartTime', 'eventEndTime', 'locationId']
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
          return await this.searchEvents(input, userContext);
        case 'check_availability':
          return await this.checkAvailability(input);
        case 'export_calendar_pdf':
          return await this.exportCalendarPdf(input);
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
  async searchEvents(input, userContext) {
    let { startDate, endDate, searchText, locationId, categories, status, serviceFilter, afterTime, beforeTime } = input || {};

    logger.info(`[MCP] searchEvents called with:`, { startDate, endDate, searchText, locationId, categories, status, serviceFilter, afterTime, beforeTime });

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
    // Use local date getters (not toISOString which returns UTC and shifts dates near midnight)
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const startDateStr = startDate || todayStr;

    let endDateStr;
    if (endDate) {
      endDateStr = endDate;
    } else {
      const defaultEnd = new Date(today);
      defaultEnd.setDate(defaultEnd.getDate() + 7);
      endDateStr = `${defaultEnd.getFullYear()}-${pad(defaultEnd.getMonth() + 1)}-${pad(defaultEnd.getDate())}`;
    }

    // Build datetime range strings for comparison (local time, NO UTC conversion)
    // Use next-day T00:00:00 with $lt for precise end-of-day boundary
    const startDateTimeStr = `${startDateStr}T00:00:00`;
    const nextDay = new Date(`${endDateStr}T00:00:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    const endNextDayStr = `${nextDay.getFullYear()}-${pad(nextDay.getMonth() + 1)}-${pad(nextDay.getDate())}`;
    const endDateTimeStr = `${endNextDayStr}T00:00:00`;

    // Query using overlap detection: event.start < queryEnd AND event.end > queryStart
    // Check multiple field paths (calendarData.*, top-level, Graph API nested)
    const dateQuery = {
      $and: [
        // Event starts before query window ends
        { $or: [
          { 'calendarData.startDateTime': { $lt: endDateTimeStr } },
          { startDateTime: { $lt: endDateTimeStr } },
          { 'start.dateTime': { $lt: endDateTimeStr } },
          { startDate: { $lte: endDateStr } }
        ]},
        // Event ends after query window starts
        { $or: [
          { 'calendarData.endDateTime': { $gt: startDateTimeStr } },
          { endDateTime: { $gt: startDateTimeStr } },
          { 'end.dateTime': { $gt: startDateTimeStr } },
          { endDate: { $gte: startDateStr } }
        ]}
      ]
    };

    // Build status filter (role-aware)
    let statusFilter;
    let statusNote;
    if (status === 'all') {
      const userRole = userContext?.role || 'viewer';
      if (userRole === 'admin' || userRole === 'approver') {
        statusFilter = { $nin: ['deleted'] };
      } else {
        // Non-privileged users can't see all statuses — fall back to default
        statusFilter = { $nin: ['rejected', 'deleted', 'draft'] };
        statusNote = 'Your role does not have access to all statuses. Showing published and pending only.';
      }
    } else if (status === 'draft') {
      if (!userContext?.email) {
        return { count: 0, events: [], error: 'Cannot search drafts without user context' };
      }
      statusFilter = 'draft';
    } else if (status) {
      statusFilter = status;
    } else {
      // Default: exclude rejected, deleted, and other users' drafts
      statusFilter = { $nin: ['rejected', 'deleted', 'draft'] };
    }

    const query = {
      ...dateQuery,
      isDeleted: { $ne: true },
      status: statusFilter
    };

    // Scope draft searches to the requesting user's own drafts
    if (status === 'draft') {
      query.$and = query.$and || [];
      query.$and.push({
        'roomReservationData.requestedBy.email': userContext.email.toLowerCase()
      });
    }

    if (searchText) {
      // Ensure $and exists (dateQuery already uses $and)
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { subject: { $regex: searchText, $options: 'i' } },
          { eventTitle: { $regex: searchText, $options: 'i' } },
          { 'calendarData.eventTitle': { $regex: searchText, $options: 'i' } }
        ]
      });
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
          { 'calendarData.locationDisplayNames': { $regex: matchedLocation, $options: 'i' } },
          { 'locationDisplayName': { $regex: matchedLocation, $options: 'i' } },
          { 'location': { $regex: matchedLocation, $options: 'i' } },
          { 'graphData.location.displayName': { $regex: matchedLocation, $options: 'i' } }
        ]
      };
      query.$and = query.$and || [];
      query.$and.push(locationMatch);
    }

    // Category filtering (shared helper with exportCalendarPdf)
    if (categories && categories.length > 0) {
      query.$and = query.$and || [];
      query.$and.push(buildCategoryFilter(categories));
    }

    // Time-of-day filtering on the startTime field (stored as zero-padded "HH:MM")
    if (afterTime || beforeTime) {
      const timeFilter = {};
      if (afterTime)  timeFilter.$gte = afterTime;
      if (beforeTime) timeFilter.$lt  = beforeTime;
      query.$and = query.$and || [];
      query.$and.push({ 'calendarData.startTime': timeFilter });
    }

    logger.info(`[MCP] searchEvents query:`, JSON.stringify(query, null, 2));

    let events = await this.eventsCollection
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
        syncStatus: 1,
        calendarData: 1,
        services: 1,
        categories: 1,
        setupTime: 1,
        teardownTime: 1,
        doorOpenTime: 1,
        doorCloseTime: 1,
        eventDescription: 1,
        attendeeCount: 1,
        eventType: 1
      })
      .limit((serviceFilter || afterTime || beforeTime) ? 200 : 50)
      .toArray();

    // Post-query time filter for events missing top-level startTime field
    if (afterTime || beforeTime) {
      events = events.filter(e => {
        const t = e.calendarData?.startTime
          || e.startTime
          || e.calendarData?.startDateTime?.substring(11, 16)
          || e.startDateTime?.substring(11, 16)
          || e.start?.dateTime?.substring(11, 16);
        if (!t) return true; // fail open — keep events with no time data
        return (!afterTime || t >= afterTime) && (!beforeTime || t < beforeTime);
      });
    }

    // Post-query service filter (services field has dynamic keys, easier to filter in memory)
    if (serviceFilter) {
      const normalizedFilter = serviceFilter.toLowerCase();
      events = events.filter(e => {
        const services = e.services || e.calendarData?.services || {};
        return Object.entries(services).some(([key, v]) =>
          v && v.enabled && key.toLowerCase().includes(normalizedFilter)
        );
      });
    }

    logger.info(`[MCP] searchEvents found ${events.length} events`);
    if (events.length > 0) {
      logger.info(`[MCP] First event:`, events[0]);
    }

    // Sort by start time (check calendarData fields too)
    events.sort((a, b) => {
      const aTime = a.calendarData?.startDateTime || a.startDateTime || a.start?.dateTime || '';
      const bTime = b.calendarData?.startDateTime || b.startDateTime || b.start?.dateTime || '';
      return aTime.localeCompare(bTime);
    });

    // Return only first 20 after sorting
    const limitedEvents = events.slice(0, 20);

    const result = {
      count: limitedEvents.length,
      dateRange: { start: startDateStr, end: endDateStr },
      ...(afterTime || beforeTime ? { timeFilter: { afterTime, beforeTime } } : {}),
      ...(categories?.length ? { categoryFilter: categories } : {}),
      ...(status ? { statusFilter: status } : {}),
      ...(statusNote ? { statusNote } : {}),
      ...(serviceFilter ? { serviceFilter } : {}),
      events: limitedEvents.map(e => {
        // Build services summary: only include enabled services
        const services = e.services || e.calendarData?.services || {};
        const enabledServices = Object.entries(services)
          .filter(([, v]) => v && v.enabled)
          .map(([key, v]) => ({ key, notes: v.notes || undefined, cost: v.cost || undefined }));

        return {
          id: e._id.toString(),
          title: e.eventTitle || e.calendarData?.eventTitle || e.subject || 'Untitled',
          start: e.startTime || e.calendarData?.startTime || e.startDateTime?.split('T')[1]?.substring(0, 5) || e.calendarData?.startDateTime?.split('T')[1]?.substring(0, 5) || e.start?.dateTime?.split('T')[1]?.substring(0, 5),
          end: e.endTime || e.calendarData?.endTime || e.endDateTime?.split('T')[1]?.substring(0, 5) || e.calendarData?.endDateTime?.split('T')[1]?.substring(0, 5) || e.end?.dateTime?.split('T')[1]?.substring(0, 5),
          date: e.startDate || e.calendarData?.startDate || e.startDateTime?.split('T')[0] || e.calendarData?.startDateTime?.split('T')[0] || e.start?.dateTime?.split('T')[0],
          location: e.locationDisplayNames || e.calendarData?.locationDisplayNames || e.locationDisplayName || e.location?.displayName || e.location,
          categories: e.categories || e.calendarData?.categories || [],
          services: enabledServices.length > 0 ? enabledServices : undefined,
          setupTime: e.setupTime || e.calendarData?.setupTime || undefined,
          teardownTime: e.teardownTime || e.calendarData?.teardownTime || undefined,
          reservationStartTime: e.reservationStartTime || e.calendarData?.reservationStartTime || undefined,
          reservationEndTime: e.reservationEndTime || e.calendarData?.reservationEndTime || undefined,
          doorOpenTime: e.doorOpenTime || e.calendarData?.doorOpenTime || undefined,
          doorCloseTime: e.doorCloseTime || e.calendarData?.doorCloseTime || undefined,
          status: e.status,
          syncStatus: e.syncStatus,
          ...((e.eventDescription || e.calendarData?.eventDescription) ? {
            description: (e.eventDescription || e.calendarData?.eventDescription || '').substring(0, 200)
          } : {}),
          ...((e.attendeeCount || e.calendarData?.attendeeCount) > 0 ? {
            attendeeCount: e.attendeeCount || e.calendarData?.attendeeCount
          } : {}),
          ...((e.eventType && e.eventType !== 'singleInstance') ? {
            eventType: e.eventType,
            isRecurring: true
          } : {})
        };
      })
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
        { 'calendarData.locationDisplayNames': { $regex: matchedLocation, $options: 'i' } },
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
            { 'calendarData.startDateTime': { $lt: endDateTimeStr } },
            { startDateTime: { $lt: endDateTimeStr } },
            { 'start.dateTime': { $lt: endDateTimeStr } },
            { startDate: { $lte: date } }  // Date-only fallback
          ]
        },
        // Event must end after query start (check multiple field paths)
        {
          $or: [
            { 'calendarData.endDateTime': { $gt: startDateTimeStr } },
            { endDateTime: { $gt: startDateTimeStr } },
            { 'end.dateTime': { $gt: startDateTimeStr } },
            { endDate: { $gte: date } }  // Date-only fallback
          ]
        }
      ],
      isDeleted: { $ne: true },
      status: { $nin: ['rejected', 'deleted', 'draft'] }
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
        title: c.eventTitle || c.calendarData?.eventTitle || c.graphData?.subject || 'Untitled Event',
        start: c.startTime || c.calendarData?.startTime || c.startDateTime?.split('T')[1]?.substring(0, 5) || c.calendarData?.startDateTime?.split('T')[1]?.substring(0, 5),
        end: c.endTime || c.calendarData?.endTime || c.endDateTime?.split('T')[1]?.substring(0, 5) || c.calendarData?.endDateTime?.split('T')[1]?.substring(0, 5),
        date: c.startDate || c.calendarData?.startDate || c.startDateTime?.split('T')[0] || c.calendarData?.startDateTime?.split('T')[0]
      })),
      message: `Found ${conflicts.length} conflicting event(s) at ${matchedLocation || 'this location'}`
    };
    if (locationInfo) {
      result.locationSearch = locationInfo;
    }
    return result;
  }

  /**
   * Export calendar events as PDF
   * Fetches events directly from DB (same pattern as searchEvents) and returns them
   * for client-side PDF generation
   */
  async exportCalendarPdf(input) {
    const { startDate, endDate, categories, locations, sortBy = 'date', showMaintenanceTimes = false, showSecurityTimes = false, afterTime, beforeTime } = input;

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return { error: 'Dates must be in YYYY-MM-DD format' };
    }
    if (startDate > endDate) {
      return { error: 'startDate must be before or equal to endDate' };
    }

    // Validate categories if provided
    if (categories && categories.length > 0) {
      const validCategories = await this.categoriesCollection
        .find({ name: { $in: categories.map(c => new RegExp(`^${c}$`, 'i')) } })
        .project({ name: 1 })
        .toArray();
      const validNames = validCategories.map(c => c.name);
      const invalid = categories.filter(c => !validNames.some(v => v.toLowerCase() === c.toLowerCase()));
      if (invalid.length > 0) {
        const allCats = await this.categoriesCollection.find({}).project({ name: 1 }).toArray();
        return {
          error: `Unknown categories: ${invalid.join(', ')}. Available: ${allCats.map(c => c.name).join(', ')}`
        };
      }
    }

    // Validate locations if provided
    if (locations && locations.length > 0) {
      const validLocations = await this.locationsCollection
        .find({ displayName: { $in: locations.map(l => new RegExp(`^${l}$`, 'i')) } })
        .project({ displayName: 1 })
        .toArray();
      const validNames = validLocations.map(l => l.displayName);
      const invalid = locations.filter(l => !validNames.some(v => v.toLowerCase() === l.toLowerCase()));
      if (invalid.length > 0) {
        const allLocs = await this.locationsCollection.find({ isReservable: true }).project({ displayName: 1 }).toArray();
        return {
          error: `Unknown locations: ${invalid.join(', ')}. Available: ${allLocs.map(l => l.displayName).join(', ')}`
        };
      }
    }

    // Build date range query (same pattern as searchEvents)
    const pad = (n) => String(n).padStart(2, '0');
    const startDateTimeStr = `${startDate}T00:00:00`;
    const nextDay = new Date(`${endDate}T00:00:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    const endNextDayStr = `${nextDay.getFullYear()}-${pad(nextDay.getMonth() + 1)}-${pad(nextDay.getDate())}`;
    const endDateTimeStr = `${endNextDayStr}T00:00:00`;

    const query = {
      $and: [
        { $or: [
          { 'calendarData.startDateTime': { $lt: endDateTimeStr } },
          { startDateTime: { $lt: endDateTimeStr } },
          { 'start.dateTime': { $lt: endDateTimeStr } },
          { startDate: { $lte: endDate } }
        ]},
        { $or: [
          { 'calendarData.endDateTime': { $gt: startDateTimeStr } },
          { endDateTime: { $gt: startDateTimeStr } },
          { 'end.dateTime': { $gt: startDateTimeStr } },
          { endDate: { $gte: startDate } }
        ]}
      ],
      isDeleted: { $ne: true },
      status: { $nin: ['rejected', 'deleted', 'draft'] }
    };

    // Add category filter
    if (categories && categories.length > 0) {
      query.$and.push(buildCategoryFilter(categories));
    }

    // Add location filter
    if (locations && locations.length > 0) {
      const locationConditions = [];
      for (const loc of locations) {
        locationConditions.push(
          { locationDisplayNames: { $regex: loc, $options: 'i' } },
          { 'calendarData.locationDisplayNames': { $regex: loc, $options: 'i' } },
          { locationDisplayName: { $regex: loc, $options: 'i' } },
          { location: { $regex: loc, $options: 'i' } }
        );
      }
      query.$and.push({ $or: locationConditions });
    }

    // Add time-of-day filter (morning/afternoon/evening)
    if (afterTime || beforeTime) {
      const timeFilter = {};
      if (afterTime)  timeFilter.$gte = afterTime;
      if (beforeTime) timeFilter.$lt  = beforeTime;
      query.$and.push({ 'calendarData.startTime': timeFilter });
    }

    logger.info(`[MCP] exportCalendarPdf query for ${startDate} to ${endDate}`);

    let events = await this.eventsCollection
      .find(query)
      .project({
        eventId: 1, subject: 1, eventTitle: 1,
        startDateTime: 1, endDateTime: 1,
        start: 1, end: 1,
        location: 1, locationDisplayNames: 1, locationDisplayName: 1,
        categories: 1,
        eventDescription: 1,
        calendarData: 1,
        graphData: 1,
        setupTime: 1, teardownTime: 1,
        doorOpenTime: 1, doorCloseTime: 1,
        setupNotes: 1, doorNotes: 1,
        roomReservationData: 1,
        isAllDayEvent: 1, lastSyncedAt: 1
      })
      .limit(2000)
      .toArray();

    // Post-query time-of-day filter (safety net for events missing calendarData.startTime)
    if (afterTime || beforeTime) {
      events = events.filter(e => {
        const t = e.calendarData?.startTime
          || e.startTime
          || e.calendarData?.startDateTime?.substring(11, 16)
          || e.startDateTime?.substring(11, 16)
          || e.start?.dateTime?.substring(11, 16);
        if (!t) return true;
        return (!afterTime || t >= afterTime) && (!beforeTime || t < beforeTime);
      });
    }

    logger.info(`[MCP] exportCalendarPdf found ${events.length} events`);

    if (events.length === 0) {
      return {
        success: true,
        generatePdf: false,
        events: [],
        message: `No events found between ${startDate} and ${endDate}${categories ? ' for categories: ' + categories.join(', ') : ''}${locations ? ' at locations: ' + locations.join(', ') : ''}.`
      };
    }

    // Transform to the flat format expected by the PDF generator
    const transformedEvents = events.map(event => ({
      id: event.eventId,
      subject: event.calendarData?.eventTitle || event.eventTitle || event.subject || event.graphData?.subject || 'Untitled',
      start: {
        dateTime: event.calendarData?.startDateTime || event.startDateTime || event.graphData?.start?.dateTime
      },
      end: {
        dateTime: event.calendarData?.endDateTime || event.endDateTime || event.graphData?.end?.dateTime
      },
      location: {
        displayName: event.calendarData?.locationDisplayNames || event.locationDisplayNames || event.locationDisplayName || event.location || event.graphData?.location?.displayName || ''
      },
      categories: event.calendarData?.categories || event.categories || event.graphData?.categories || [],
      bodyPreview: event.calendarData?.eventDescription || event.eventDescription || event.graphData?.bodyPreview || '',
      setupTime: event.calendarData?.setupTime || event.setupTime || '',
      teardownTime: event.calendarData?.teardownTime || event.teardownTime || '',
      doorOpenTime: event.calendarData?.doorOpenTime || event.doorOpenTime || '',
      doorCloseTime: event.calendarData?.doorCloseTime || event.doorCloseTime || '',
      setupNotes: event.calendarData?.setupNotes || event.roomReservationData?.internalNotes?.setupNotes || event.setupNotes || '',
      doorNotes: event.calendarData?.doorNotes || event.roomReservationData?.internalNotes?.doorNotes || event.doorNotes || ''
    }));

    // Sort by start time
    transformedEvents.sort((a, b) => {
      const aTime = a.start?.dateTime || '';
      const bTime = b.start?.dateTime || '';
      return aTime.localeCompare(bTime);
    });

    return {
      success: true,
      generatePdf: true,
      events: transformedEvents,
      pdfFilters: {
        sortBy,
        showMaintenanceTimes,
        showSecurityTimes,
        categories: categories || [],
        locations: locations || [],
        dateRange: { start: startDate, end: endDate },
        afterTime,
        beforeTime
      },
      message: `Generating PDF with ${transformedEvents.length} events from ${startDate} to ${endDate}.`
    };
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
      attendeeCount,
      reservationStartTime,
      reservationEndTime
    } = input;

    // Validate required fields
    if (!eventTitle || !category || !date || !eventStartTime || !eventEndTime || !locationId) {
      return {
        error: 'Missing required fields: eventTitle, category, date, eventStartTime, eventEndTime, and locationId are all required'
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
      startTime: setupTime || eventStartTime, // Check from setup time, or event start if no setup
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
        attendeeCount: attendeeCount || null,
        reservationStartTime: reservationStartTime || '',
        reservationEndTime: reservationEndTime || ''
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
      attendeeCount,
      reservationStartTime,
      reservationEndTime
    } = input;

    // Validate required fields
    if (!eventTitle || !category || !date || !eventStartTime || !eventEndTime || !locationId) {
      return {
        error: 'Missing required fields: eventTitle, category, date, eventStartTime, eventEndTime, and locationId are all required'
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
      startTime: setupTime || eventStartTime, // Check from setup time, or event start if no setup
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

      // Enrichment data (stored in calendarData)
      // calendarData is built separately below

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
      reservationStartTime: reservationStartTime || '',
      reservationEndTime: reservationEndTime || '',
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
      attendeeCount: attendeeCount || null,
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
