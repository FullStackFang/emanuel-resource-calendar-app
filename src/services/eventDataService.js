// src/services/eventDataService.js
import APP_CONFIG from '../config/config';

const API_BASE_URL = APP_CONFIG.API_BASE_URL;

class EventDataService {
  constructor() {
    this.apiToken = null;
  }

  // Set the API token for authenticated requests
  setApiToken(token) {
    this.apiToken = token;
  }

  // Get authorization headers
  getAuthHeaders() {
    if (!this.apiToken) {
      throw new Error('API token not set');
    }
    return {
      'Authorization': `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Sync events from Microsoft Graph to internal database
   * @param {Array} events - Array of Graph events
   * @param {string} calendarId - Calendar ID
   * @returns {Object} Sync results
   */
  async syncEvents(events, calendarId) {
    try {
      const response = await fetch(`${API_BASE_URL}/internal-events/sync`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ events, calendarId })
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error syncing events:', error);
      throw error;
    }
  }

  /**
   * Enrich Graph events with internal data
   * @param {Array} graphEvents - Array of events from Microsoft Graph
   * @returns {Array} Events enriched with internal data
   */
  async enrichEventsWithInternalData(graphEvents) {
    if (!graphEvents || graphEvents.length === 0) {
      return graphEvents;
    }

    try {
      // Extract event IDs
      const eventIds = graphEvents.map(event => event.id);

      // Fetch internal data
      const response = await fetch(`${API_BASE_URL}/internal-events/enrich`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ eventIds })
      });

      if (!response.ok) {
        console.error('Failed to fetch internal data, using Graph events only');
        return graphEvents;
      }

      const enrichmentMap = await response.json();

      // Merge internal data with Graph events
      return graphEvents.map(event => {
        const internalData = enrichmentMap[event.id];
        
        if (internalData) {
          return {
            ...event,
            // Add internal fields at the root level
            mecCategories: internalData.mecCategories || [],
            setupStartTime: internalData.setupStartTime,
            doorStartTime: internalData.doorStartTime,
            teardownEndTime: internalData.teardownEndTime,
            staffAssignments: internalData.staffAssignments || [],
            internalNotes: internalData.internalNotes || '',
            setupStatus: internalData.setupStatus || 'pending',
            estimatedCost: internalData.estimatedCost,
            actualCost: internalData.actualCost,
            customFields: internalData.customFields || {},
            // Add metadata
            _hasInternalData: true,
            _internalId: internalData._internalId,
            _lastSyncedAt: internalData._lastSyncedAt
          };
        }
        
        // Return event without internal data
        return {
          ...event,
          _hasInternalData: false
        };
      });
    } catch (error) {
      console.error('Error enriching events:', error);
      // Return original events if enrichment fails
      return graphEvents;
    }
  }

  /**
   * Update internal fields for an event
   * @param {string} graphEventId - Microsoft Graph event ID
   * @param {Object} updates - Fields to update
   * @returns {Object} Updated event
   */
  async updateInternalFields(graphEventId, updates) {
    try {
      const response = await fetch(`${API_BASE_URL}/internal-events/${graphEventId}`, {
        method: 'PATCH',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(updates)
      });

      if (!response.ok) {
        throw new Error(`Update failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error updating internal fields:', error);
      throw error;
    }
  }

  /**
   * Get available MEC categories
   * @returns {Array} List of MEC categories
   */
  async getMecCategories() {
    try {
      const response = await fetch(`${API_BASE_URL}/internal-events/mec-categories`, {
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        return [];
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching MEC categories:', error);
      return [];
    }
  }

  /**
   * Get sync status for admin panel
   * @returns {Object} Sync status information
   */
  async getSyncStatus() {
    try {
      const response = await fetch(`${API_BASE_URL}/internal-events/sync-status`, {
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`Failed to get sync status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting sync status:', error);
      throw error;
    }
  }
}

// Export singleton instance
const eventDataService = new EventDataService();
export default eventDataService;