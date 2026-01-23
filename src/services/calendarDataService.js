// Updated calendarDataService.js with timezone fixes
import { logger } from '../utils/logger';

class CalendarDataService {
  constructor() {
    this.isDemoMode = false;
    this.demoData = null;
    this.graphToken = null;
    this.apiToken = null;
    this.selectedCalendarId = null;
    this.schemaExtensions = [];
    this.userTimeZone = 'America/New_York'; // Default timezone
  }

  // Initialize the service with tokens and settings
  initialize(graphToken, apiToken, selectedCalendarId, schemaExtensions = [], userTimeZone = 'America/New_York') {
    this.graphToken = graphToken;
    this.apiToken = apiToken;
    this.selectedCalendarId = selectedCalendarId;
    this.schemaExtensions = schemaExtensions;
    this.userTimeZone = userTimeZone;
  }

  // Set user timezone
  setUserTimeZone(userTimeZone) {
    this.userTimeZone = userTimeZone;
  }

  // Switch to demo mode with uploaded data
  setDemoMode(demoData) {
    this.isDemoMode = true;
    this.demoData = demoData;
    logger.debug(`Demo mode enabled with ${demoData?.events?.length || 0} events`);
  }

  // Switch back to API mode
  setApiMode() {
    this.isDemoMode = false;
    this.demoData = null;
    logger.debug('API mode enabled');
  }

  // Check if we're in demo mode
  isInDemoMode() {
    return this.isDemoMode;
  }

  // Get events for a date range with proper timezone handling
  async getEvents(dateRange) {
    if (this.isDemoMode) {
      return this._getDemoEvents(dateRange);
    } else {
      return this._getApiEvents(dateRange);
    }
  }

  // Create a new event
  async createEvent(eventData) {
    if (this.isDemoMode) {
      return this._createDemoEvent(eventData);
    } else {
      return this._createApiEvent(eventData);
    }
  }

  // Update an existing event
  async updateEvent(eventData) {
    if (this.isDemoMode) {
      return this._updateDemoEvent(eventData);
    } else {
      return this._updateApiEvent(eventData);
    }
  }

  // Delete an event
  async deleteEvent(eventId) {
    if (this.isDemoMode) {
      return this._deleteDemoEvent(eventId);
    } else {
      return this._deleteApiEvent(eventId);
    }
  }

  // DEMO MODE METHODS WITH TIMEZONE FIXES
  _getDemoEvents(dateRange) {
    if (!this.demoData?.events) {
      logger.warn('No demo data or events available');
      return [];
    }

    // Use extended date range to account for timezone boundaries
    const { start, end } = this._formatDateRangeForAPI(dateRange.start, dateRange.end);

    // Filter events with timezone-aware date comparison
    const filteredEvents = this.demoData.events.filter(event => {
      try {
        const eventStartTime = event.startDateTime;

        if (!eventStartTime) {
          logger.warn('Event missing startDateTime:', event.subject);
          return false;
        }

        // Parse the UTC event time
        const eventStartUTC = new Date(eventStartTime);

        if (isNaN(eventStartUTC.getTime())) {
          logger.warn('Invalid event start time:', eventStartTime, event.subject);
          return false;
        }

        // Convert event time to user timezone for comparison
        const eventStartInUserTZ = new Date(eventStartUTC.toLocaleString('en-US', {
          timeZone: this.userTimeZone
        }));

        // For demo events, we want to check if the event's date (in user timezone)
        // falls within the view range (also in user timezone)
        const eventDateInUserTZ = new Date(eventStartInUserTZ);
        eventDateInUserTZ.setHours(0, 0, 0, 0);

        const viewStartInUserTZ = new Date(dateRange.start);
        viewStartInUserTZ.setHours(0, 0, 0, 0);

        const viewEndInUserTZ = new Date(dateRange.end);
        viewEndInUserTZ.setHours(23, 59, 59, 999);

        return eventDateInUserTZ >= viewStartInUserTZ && eventDateInUserTZ <= viewEndInUserTZ;
      } catch (error) {
        logger.error('Error filtering event:', error, event.subject);
        return false;
      }
    });

    // Convert to the format your Calendar component expects
    const convertedEvents = filteredEvents.map(event => {
      try {
        return this._convertDemoEventToCalendarFormat(event);
      } catch (error) {
        logger.error('Error converting event:', error, event.subject);
        return null;
      }
    }).filter(event => event !== null);

    return convertedEvents;
  }

  _createDemoEvent(eventData) {
    if (!this.demoData?.events) {
      throw new Error('Demo data not available');
    }

    // Generate a new ID for demo events
    const newId = `demo_event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Convert from calendar format to demo format
    const demoEvent = this._convertCalendarEventToDemoFormat({
      ...eventData,
      id: newId
    });

    // Add to demo data
    this.demoData.events.push(demoEvent);
    this.demoData.totalEvents = this.demoData.events.length;

    // Return in calendar format
    return this._convertDemoEventToCalendarFormat(demoEvent);
  }

  _updateDemoEvent(eventData) {
    if (!this.demoData?.events) {
      throw new Error('Demo data not available');
    }

    // Find the event to update
    const eventIndex = this.demoData.events.findIndex(event => event.id === eventData.id);
    
    if (eventIndex === -1) {
      throw new Error(`Event with ID ${eventData.id} not found in demo data`);
    }

    // Convert from calendar format to demo format
    const updatedDemoEvent = this._convertCalendarEventToDemoFormat(eventData);
    
    // Update the event in demo data
    this.demoData.events[eventIndex] = updatedDemoEvent;

    // Return in calendar format
    return this._convertDemoEventToCalendarFormat(updatedDemoEvent);
  }

  _deleteDemoEvent(eventId) {
    if (!this.demoData?.events) {
      throw new Error('Demo data not available');
    }

    // Find and remove the event
    const eventIndex = this.demoData.events.findIndex(event => event.id === eventId);
    
    if (eventIndex === -1) {
      throw new Error(`Event with ID ${eventId} not found in demo data`);
    }

    this.demoData.events.splice(eventIndex, 1);
    this.demoData.totalEvents = this.demoData.events.length;

    return { success: true };
  }

  // API MODE METHODS (updated with timezone handling)
  async _getApiEvents(dateRange) {
    if (!this.graphToken) {
      throw new Error('Graph token not available');
    }

    try {
      const { start, end } = this._formatDateRangeForAPI(dateRange.start, dateRange.end);

      const calendarPath = this.selectedCalendarId ? 
        `/me/calendars/${this.selectedCalendarId}/events` : 
        '/me/events';
      
      // Build extension filter
      const extIds = this.schemaExtensions.map(e => e.id);
      const extFilter = extIds
        .map(id => `id eq '${id}'`)
        .join(" or ");

      // Build API URL with extended date range for timezone safety
      let url = `https://graph.microsoft.com/v1.0${calendarPath}?$top=250&$orderby=start/dateTime desc&$filter=start/dateTime ge '${start}' and start/dateTime le '${end}'`;
      
      if (extFilter) {
        url += `&$expand=extensions($filter=${encodeURIComponent(extFilter)})`;
      }

      // Fetch all pages
      let allEvents = [];
      let nextLink = url;

      while (nextLink) {
        const response = await fetch(nextLink, {
          headers: { Authorization: `Bearer ${this.graphToken}` }
        });

        if (!response.ok) {
          // Handle specific error cases for shared calendars
          if (response.status === 403) {
            logger.error('Access denied to calendar. This may be a shared calendar with limited permissions.');
            throw new Error('You do not have permission to access events in this calendar');
          } else if (response.status === 404) {
            throw new Error('Calendar not found');
          }
          throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        allEvents = allEvents.concat(data.value || []);
        nextLink = data['@odata.nextLink'] || null;
      }

      // Convert to calendar format and filter by actual view range in user timezone
      const convertedEvents = allEvents.map(event => this._convertApiEventToCalendarFormat(event));
      
      // Additional filtering based on user timezone view range
      const filteredEvents = convertedEvents.filter(event => {
        try {
          const eventStartUTC = new Date(event.start.dateTime);
          const eventStartInUserTZ = new Date(eventStartUTC.toLocaleString('en-US', {
            timeZone: this.userTimeZone
          }));
          
          const eventDateInUserTZ = new Date(eventStartInUserTZ);
          eventDateInUserTZ.setHours(0, 0, 0, 0);
          
          const viewStartInUserTZ = new Date(dateRange.start);
          viewStartInUserTZ.setHours(0, 0, 0, 0);
          
          const viewEndInUserTZ = new Date(dateRange.end);
          viewEndInUserTZ.setHours(23, 59, 59, 999);
          
          return eventDateInUserTZ >= viewStartInUserTZ && eventDateInUserTZ <= viewEndInUserTZ;
        } catch (error) {
          logger.error('Error filtering API event by timezone:', error);
          return true; // Include event if there's an error to be safe
        }
      });

      return filteredEvents;

    } catch (error) {
      logger.error('Error fetching API events:', error);
      throw error;
    }
  }

  async _createApiEvent(eventData) {
    return this._performApiEventOperation('POST', null, eventData);
  }

  async _updateApiEvent(eventData) {
    return this._performApiEventOperation('PATCH', eventData.id, eventData);
  }

  async _deleteApiEvent(eventId) {
    const apiUrl = this.selectedCalendarId
      ? `https://graph.microsoft.com/v1.0/me/calendars/${this.selectedCalendarId}/events/${eventId}`
      : `https://graph.microsoft.com/v1.0/me/events/${eventId}`;

    const response = await fetch(apiUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.graphToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to delete event: ${response.status}`);
    }

    return { success: true };
  }

  // Helper method for API operations
  async _performApiEventOperation(method, eventId, eventData) {
    // Build core and extension payloads
    const core = {
      subject: eventData.subject,
      start: eventData.start,
      end: eventData.end,
      location: eventData.location,
      locations: eventData.locations, // Array of separate location objects for Graph API
      categories: eventData.categories
    };
    
    const ext = {};
    this.schemaExtensions.forEach(extDef => {
      const props = {};
      extDef.properties.forEach(p => {
        const v = eventData[extDef.id]?.[p.name];
        if (v !== undefined) props[p.name] = v;
      });
      if (Object.keys(props).length) ext[extDef.id] = props;
    });

    // Perform batch update
    const batchBody = this._makeBatchBody(eventId, core, ext);
    
    const response = await fetch('https://graph.microsoft.com/v1.0/$batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.graphToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(batchBody)
    });

    if (!response.ok) {
      throw new Error(`Batch operation failed: ${response.status}`);
    }

    const result = await response.json();
    
    // Handle batch response
    if (result.responses && result.responses[0] && result.responses[0].status >= 400) {
      const errorStatus = result.responses[0].status;
      const errorMessage = result.responses[0].body?.error?.message || 'Unknown error';

      // Handle specific error cases for shared calendars
      if (errorStatus === 403) {
        throw new Error('You do not have permission to modify events in this calendar. This may be a read-only shared calendar.');
      } else if (errorStatus === 404) {
        throw new Error('Calendar or event not found');
      }

      throw new Error(`Event operation failed: ${errorMessage}`);
    }

    return { success: true };
  }

  // CONVERSION METHODS (updated for timezone handling)
  _convertDemoEventToCalendarFormat(demoEvent) {
    try {        
      const startDateTime = demoEvent.startDateTime;
      const endDateTime = demoEvent.endDateTime;
      
      if (!startDateTime || !endDateTime) {
        throw new Error(`Missing date fields for event: ${demoEvent.subject || demoEvent.id}`);
      }
      
      // Ensure dates are in proper UTC ISO format with Z
      const formatDate = (dateStr) => {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) {
          throw new Error(`Invalid date: ${dateStr}`);
        }
        // Always return as UTC ISO string
        return date.toISOString();
      };
      
      const converted = {
        id: demoEvent.id || `demo_${Date.now()}_${Math.random()}`,
        subject: demoEvent.subject || 'Untitled Event',
        // Store as UTC ISO strings - the UI will convert to user timezone for display
        start: { dateTime: formatDate(startDateTime) },
        end: { dateTime: formatDate(endDateTime) },
        location: { displayName: demoEvent.location || '' },
        category: demoEvent.categories?.length > 0 ? demoEvent.categories[0] : 'Uncategorized',
        categories: demoEvent.categories || [],
        extensions: [],
        calendarId: this.selectedCalendarId,
        calendarName: 'Demo Calendar',
        attendees: demoEvent.attendees || [],
        isAllDay: demoEvent.isAllDay || false,
        importance: demoEvent.importance || 'normal',
        showAs: demoEvent.showAs || 'busy',
        recurrence: demoEvent.recurrence || null,
        organizer: demoEvent.organizer || null,
        webLink: demoEvent.webLink || '',
        body: demoEvent.body || '',
        createdDateTime: demoEvent.createdDateTime || new Date().toISOString(),
        lastModifiedDateTime: demoEvent.lastModifiedDateTime || new Date().toISOString()
      };
      
      return converted;
    } catch (error) {
      logger.error('Error in _convertDemoEventToCalendarFormat:', error);
      throw error;
    }
  }

  _convertCalendarEventToDemoFormat(calendarEvent) {
    return {
      id: calendarEvent.id,
      subject: calendarEvent.subject,
      // Store in UTC format - demo data should always be in UTC
      startDateTime: calendarEvent.start?.dateTime || calendarEvent.start,
      endDateTime: calendarEvent.end?.dateTime || calendarEvent.end,
      location: calendarEvent.location?.displayName || calendarEvent.location || '',
      categories: calendarEvent.categories || (calendarEvent.category ? [calendarEvent.category] : []),
      attendees: calendarEvent.attendees || [],
      isAllDay: calendarEvent.isAllDay || false,
      importance: calendarEvent.importance || 'normal',
      showAs: calendarEvent.showAs || 'busy',
      recurrence: calendarEvent.recurrence || null,
      organizer: calendarEvent.organizer || null,
      webLink: calendarEvent.webLink || '',
      body: calendarEvent.body || '',
      createdDateTime: calendarEvent.createdDateTime || new Date().toISOString(),
      lastModifiedDateTime: new Date().toISOString()
    };
  }

  _convertApiEventToCalendarFormat(apiEvent) {
    // Extract extension data
    const extData = {};
    if (apiEvent.extensions && apiEvent.extensions.length > 0) {
      apiEvent.extensions.forEach(x =>
        Object.entries(x).forEach(([k, v]) => {
          if (!k.startsWith("@") && k !== "id" && k !== "extensionName") {
            extData[k] = v;
          }
        })
      );
    }

    return {
      id: apiEvent.id,
      subject: apiEvent.subject,
      // Preserve timezone info from API for proper display conversion
      start: {
        dateTime: apiEvent.start.dateTime.endsWith('Z') ?
                  apiEvent.start.dateTime : `${apiEvent.start.dateTime}Z`,
        timeZone: apiEvent.start.timeZone || 'UTC'
      },
      end: {
        dateTime: apiEvent.end.dateTime.endsWith('Z') ?
                  apiEvent.end.dateTime : `${apiEvent.end.dateTime}Z`,
        timeZone: apiEvent.end.timeZone || 'UTC'
      },
      location: { displayName: apiEvent.location?.displayName || "" },
      category: apiEvent.categories?.[0] || "Uncategorized",
      categories: apiEvent.categories || [],
      extensions: apiEvent.extensions || [],
      calendarId: this.selectedCalendarId,
      calendarName: 'API Calendar',
      attendees: apiEvent.attendees || [],
      isAllDay: apiEvent.isAllDay || false,
      importance: apiEvent.importance || 'normal',
      showAs: apiEvent.showAs || 'busy',
      recurrence: apiEvent.recurrence || null,
      organizer: apiEvent.organizer || null,
      webLink: apiEvent.webLink || '',
      body: apiEvent.body?.content || '',
      createdDateTime: apiEvent.createdDateTime,
      lastModifiedDateTime: apiEvent.lastModifiedDateTime,
      ...extData
    };
  }

  // UTILITY METHODS (updated for timezone handling)
  _formatDateRangeForAPI(startDate, endDate) {
    // For API calls, extend the range to account for timezone differences
    // This ensures we don't miss events that fall on boundary dates in different timezones
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Extend the search range by one day on each side to account for timezone differences
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    
    end.setDate(end.getDate() + 1);
    end.setHours(23, 59, 59, 999);
    
    return {
      start: start.toISOString(),
      end: end.toISOString()
    };
  }

  _makeBatchBody(eventId, coreBody, extPayload) {
    const baseUrl = this.selectedCalendarId 
      ? `/me/calendars/${this.selectedCalendarId}/events` 
      : '/me/events';
    
    return {
      requests: [
        {
          id: '1', 
          method: eventId ? 'PATCH' : 'POST',
          url: eventId ? `${baseUrl}/${eventId}` : baseUrl,
          headers: { 'Content-Type': 'application/json' },
          body: coreBody
        },
        ...(
          Object.keys(extPayload).length && eventId
            ? [{ 
                id: '2', 
                method: 'PATCH', 
                url: `${baseUrl}/${eventId}`, 
                headers: { 'Content-Type': 'application/json' }, 
                body: extPayload 
              }]
            : []
        )
      ]
    };
  }

  // Get demo data statistics for UI display
  getDemoDataStats() {
    if (!this.demoData) return null;
    
    return {
      totalEvents: this.demoData.totalEvents || this.demoData.events?.length || 0,
      dateRange: this.demoData.searchCriteria?.dateRange || this.demoData.dateRange,
      year: this.demoData.metadata?.year,
      exportDate: this.demoData.exportDate,
      userTimeZone: this.userTimeZone
    };
  }

  // Utility method to convert time between timezones for debugging
  convertTimeToUserTimezone(utcTimeString) {
    try {
      const utcDate = new Date(utcTimeString);
      return utcDate.toLocaleString('en-US', {
        timeZone: this.userTimeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    } catch (error) {
      logger.error('Error converting time to user timezone:', error);
      return utcTimeString;
    }
  }
}

// Create and export a singleton instance
const calendarDataService = new CalendarDataService();
export default calendarDataService;