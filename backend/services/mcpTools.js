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
    const { startDate, endDate, searchText, locationId } = input || {};

    // Default date range: today + 7 days
    const start = startDate ? new Date(startDate) : new Date();
    start.setHours(0, 0, 0, 0);

    const end = endDate ? new Date(endDate) : new Date(start);
    if (!endDate) {
      end.setDate(end.getDate() + 7);
    }
    end.setHours(23, 59, 59, 999);

    const query = {
      'start.dateTime': {
        $gte: start.toISOString(),
        $lte: end.toISOString()
      }
    };

    if (searchText) {
      query.subject = { $regex: searchText, $options: 'i' };
    }

    if (locationId) {
      query.$or = [
        { 'roomReservationData.location': { $regex: locationId, $options: 'i' } },
        { 'location.displayName': { $regex: locationId, $options: 'i' } }
      ];
    }

    const events = await this.eventsCollection
      .find(query)
      .project({
        _id: 1,
        subject: 1,
        start: 1,
        end: 1,
        location: 1,
        organizer: 1,
        status: 1,
        syncStatus: 1
      })
      .limit(50)
      .toArray();

    // Sort in memory (Cosmos DB may not have index on start.dateTime)
    events.sort((a, b) => {
      const aTime = a.start?.dateTime || '';
      const bTime = b.start?.dateTime || '';
      return aTime.localeCompare(bTime);
    });

    // Return only first 20 after sorting
    const limitedEvents = events.slice(0, 20);

    return {
      count: limitedEvents.length,
      dateRange: {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0]
      },
      events: limitedEvents.map(e => ({
        id: e._id.toString(),
        title: e.subject,
        start: e.start?.dateTime,
        end: e.end?.dateTime,
        location: e.location?.displayName,
        organizer: e.organizer?.emailAddress?.name,
        status: e.status,
        syncStatus: e.syncStatus
      }))
    };
  }

  /**
   * Check room availability
   */
  async checkAvailability(input) {
    const { locationId, date, startTime, endTime } = input;

    if (!date || !startTime || !endTime) {
      return { error: 'date, startTime, and endTime are required' };
    }

    const startDateTime = new Date(`${date}T${startTime}:00`);
    const endDateTime = new Date(`${date}T${endTime}:00`);

    // Check events collection for conflicts
    const conflicts = await this.eventsCollection.find({
      $or: [
        { 'roomReservationData.location': { $regex: locationId, $options: 'i' } },
        { 'location.displayName': { $regex: locationId, $options: 'i' } }
      ],
      'start.dateTime': { $lt: endDateTime.toISOString() },
      'end.dateTime': { $gt: startDateTime.toISOString() },
      'status': { $ne: 'rejected' }
    }).toArray();

    if (conflicts.length === 0) {
      return {
        available: true,
        message: `The space is available on ${date} from ${startTime} to ${endTime}`
      };
    }

    return {
      available: false,
      conflictCount: conflicts.length,
      conflicts: conflicts.slice(0, 3).map(c => ({
        title: c.subject || c.roomReservationData?.eventTitle,
        start: c.start?.dateTime,
        end: c.end?.dateTime
      })),
      message: `Found ${conflicts.length} conflicting event(s)`
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
