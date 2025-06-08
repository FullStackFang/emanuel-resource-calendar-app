// src/services/calendarDataService.js

class CalendarDataService {
    constructor() {
      this.isDemoMode = false;
      this.demoData = null;
      this.graphToken = null;
      this.apiToken = null;
      this.selectedCalendarId = null;
      this.schemaExtensions = [];
    }
  
    // Initialize the service with tokens and settings
    initialize(graphToken, apiToken, selectedCalendarId, schemaExtensions = []) {
      this.graphToken = graphToken;
      this.apiToken = apiToken;
      this.selectedCalendarId = selectedCalendarId;
      this.schemaExtensions = schemaExtensions;
    }
  
    // Switch to demo mode with uploaded data
    setDemoMode(demoData) {
      this.isDemoMode = true;
      this.demoData = demoData;
      console.log(`Demo mode enabled with ${demoData?.events?.length || 0} events`);
    }
  
    // Switch back to API mode
    setApiMode() {
      this.isDemoMode = false;
      this.demoData = null;
      console.log('API mode enabled');
    }
  
    // Check if we're in demo mode
    isInDemoMode() {
      return this.isDemoMode;
    }
  
    // Get events for a date range
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
  
    // DEMO MODE METHODS
    _getDemoEvents(dateRange) {
      console.log('_getDemoEvents called with:', { 
        dateRange, 
        hasDemoData: !!this.demoData,
        eventCount: this.demoData?.events?.length 
      });
      
      if (!this.demoData?.events) {
        console.warn('No demo data or events available');
        return [];
      }
    
      const { start, end } = this._formatDateRangeForAPI(dateRange.start, dateRange.end);
      console.log('Filtering events between:', { start, end });
      
      // Log a sample of your events for debugging
      console.log('Sample demo events:', this.demoData.events.slice(0, 3).map(e => ({
        subject: e.subject,
        startDateTime: e.startDateTime,
        endDateTime: e.endDateTime,
        location: e.location
      })));
      
      // Filter events by date range
      const filteredEvents = this.demoData.events.filter(event => {
        try {
          // Your JSON uses direct startDateTime field
          const eventStartTime = event.startDateTime;
          
          if (!eventStartTime) {
            console.warn('Event missing startDateTime:', event.subject);
            return false;
          }
          
          const eventStart = new Date(eventStartTime);
          const rangeStart = new Date(start);
          const rangeEnd = new Date(end);
          
          if (isNaN(eventStart.getTime())) {
            console.warn('Invalid event start time:', eventStartTime, event.subject);
            return false;
          }
          
          const isInRange = eventStart >= rangeStart && eventStart <= rangeEnd;
                    
          return isInRange;
        } catch (error) {
          console.error('Error filtering event:', error, event.subject);
          return false;
        }
      });
    
      console.log(`Filtered ${filteredEvents.length} events from ${this.demoData.events.length} total`);
    
      // Convert to the format your Calendar component expects
      const convertedEvents = filteredEvents.map(event => {
        try {
          return this._convertDemoEventToCalendarFormat(event);
        } catch (error) {
          console.error('Error converting event:', error, event.subject);
          return null;
        }
      }).filter(event => event !== null);
      
      console.log('Final converted events:', convertedEvents);
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
  
    // API MODE METHODS (your existing logic)
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
  
        // Build API URL
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
            throw new Error(`API request failed: ${response.status}`);
          }
  
          const data = await response.json();
          allEvents = allEvents.concat(data.value || []);
          nextLink = data['@odata.nextLink'] || null;
        }
  
        // Convert to calendar format
        return allEvents.map(event => this._convertApiEventToCalendarFormat(event));
  
      } catch (error) {
        console.error('Error fetching API events:', error);
        throw error;
      }
    }
  
    async _createApiEvent(eventData) {
      // Your existing API create logic
      return this._performApiEventOperation('POST', null, eventData);
    }
  
    async _updateApiEvent(eventData) {
      // Your existing API update logic
      return this._performApiEventOperation('PATCH', eventData.id, eventData);
    }
  
    async _deleteApiEvent(eventId) {
      // Your existing API delete logic
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
        throw new Error(`Event operation failed: ${result.responses[0].body?.error?.message || 'Unknown error'}`);
      }
  
      return { success: true };
    }
  
    // CONVERSION METHODS
    _convertDemoEventToCalendarFormat(demoEvent) {
      try {        
        // Your JSON structure has direct fields, not nested objects
        const startDateTime = demoEvent.startDateTime;
        const endDateTime = demoEvent.endDateTime;
        
        if (!startDateTime || !endDateTime) {
          throw new Error(`Missing date fields for event: ${demoEvent.subject || demoEvent.id}`);
        }
        
        // Ensure dates are in ISO format with Z
        const formatDate = (dateStr) => {
          const date = new Date(dateStr);
          if (isNaN(date.getTime())) {
            throw new Error(`Invalid date: ${dateStr}`);
          }
          return date.toISOString();
        };
        
        const converted = {
          id: demoEvent.id || `demo_${Date.now()}_${Math.random()}`,
          subject: demoEvent.subject || 'Untitled Event',
          start: { dateTime: formatDate(startDateTime) },
          end: { dateTime: formatDate(endDateTime) },
          // Your location is a simple string, not an object
          location: { displayName: demoEvent.location || '' },
          // Your categories is an array
          category: demoEvent.categories?.length > 0 ? demoEvent.categories[0] : 'Uncategorized',
          categories: demoEvent.categories || [],
          extensions: [],
          calendarId: this.selectedCalendarId,
          calendarName: 'Demo Calendar',
          // Include other fields from your JSON structure
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
        console.error('Error in _convertDemoEventToCalendarFormat:', error, demoEvent);
        throw error;
      }
    }
  
    _convertCalendarEventToDemoFormat(calendarEvent) {
      return {
        id: calendarEvent.id,
        subject: calendarEvent.subject,
        // Convert back to your format (direct fields, not nested)
        startDateTime: calendarEvent.start?.dateTime || calendarEvent.start,
        endDateTime: calendarEvent.end?.dateTime || calendarEvent.end,
        // Your format uses simple string for location
        location: calendarEvent.location?.displayName || calendarEvent.location || '',
        // Your format uses array for categories
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
        start: { dateTime: apiEvent.start.dateTime.endsWith('Z') ? 
                apiEvent.start.dateTime : `${apiEvent.start.dateTime}Z` },
        end: { dateTime: apiEvent.end.dateTime.endsWith('Z') ? 
              apiEvent.end.dateTime : `${apiEvent.end.dateTime}Z` },
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
  
    // UTILITY METHODS
    _formatDateRangeForAPI(startDate, endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      
      const end = new Date(endDate);
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
        exportDate: this.demoData.exportDate
      };
    }
  }
  
  // Create and export a singleton instance
  const calendarDataService = new CalendarDataService();
  export default calendarDataService;