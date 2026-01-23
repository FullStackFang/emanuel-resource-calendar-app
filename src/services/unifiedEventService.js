// src/services/unifiedEventService.js
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';

const API_BASE_URL = APP_CONFIG.API_BASE_URL;

class UnifiedEventService {
  constructor() {
    this.apiToken = null;
  }

  // Set the API token for authenticated requests
  setApiToken(token) {
    this.apiToken = token;
  }

  // Deprecated: Graph token is no longer needed - backend uses app-only auth
  // Kept for backward compatibility during migration
  setGraphToken(/* token */) {
    // No-op: Backend now uses application permissions for Graph API calls
    // Users no longer need individual calendar permissions
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
   * Load events using calendarOwners (email addresses)
   * @param {Object} params - Load parameters
   * @param {Array} params.calendarOwners - Array of calendar owner emails to load from
   * @param {Array} params.calendarIds - Legacy: Array of calendar IDs (kept for Graph API calls)
   * @param {string} params.startTime - Start time for date range (ISO string)
   * @param {string} params.endTime - End time for date range (ISO string)
   * @param {boolean} params.forceRefresh - Force refresh from Graph API
   * @returns {Object} Load results and events
   */
  async loadEvents({ calendarOwners, calendarIds, startTime, endTime, forceRefresh = false }) {
    try {
      // Validate input parameters - prefer calendarOwners, fall back to calendarIds
      if ((!calendarOwners || !Array.isArray(calendarOwners) || calendarOwners.length === 0) &&
          (!calendarIds || !Array.isArray(calendarIds) || calendarIds.length === 0)) {
        logger.error('UnifiedEventService: No valid calendars provided', {
          calendarOwners,
          calendarIds
        });
        throw new Error('Either calendarOwners or calendarIds array required');
      }

      const requestBody = {
        calendarOwners: calendarOwners,
        calendarIds: calendarIds, // Keep for Graph API if needed
        startTime: startTime,
        endTime: endTime,
        forceRefresh: forceRefresh
      };

      const headers = this.getAuthHeaders();

      const response = await fetch(`${API_BASE_URL}/events/load`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('UnifiedEventService: Regular events load HTTP error', { 
          status: response.status, 
          statusText: response.statusText,
          errorText: errorText,
          url: `${API_BASE_URL}/events/load`,
          requestSentAt: new Date().toISOString()
        });
        throw new Error(`Events load failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();

      return data;
    } catch (error) {
      logger.error('UnifiedEventService: Error in regular events load:', error);
      throw error;
    }
  }

  /**
   * Backward compatibility method - delegates to loadEvents
   * @param {Object} params - Sync parameters (same as loadEvents)
   * @returns {Object} Load results and events
   */
  async syncEvents(params) {
    return await this.loadEvents(params);
  }

  /**
   * Get events from unified storage (without syncing)
   * @param {Object} params - Query parameters
   * @param {string} params.calendarId - Calendar ID to filter by (optional)
   * @param {string} params.startTime - Start time for date range (ISO string)
   * @param {string} params.endTime - End time for date range (ISO string)
   * @returns {Object} Events from unified storage
   */
  async getEvents({ calendarId, startTime, endTime }) {
    try {
      const queryParams = new URLSearchParams();
      if (calendarId) queryParams.append('calendarId', calendarId);
      if (startTime) queryParams.append('startTime', startTime);
      if (endTime) queryParams.append('endTime', endTime);

      const response = await fetch(`${API_BASE_URL}/events?${queryParams}`, {
        method: 'GET',
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('UnifiedEventService: Get events HTTP error', { 
          status: response.status, 
          statusText: response.statusText,
          errorText: errorText
        });
        throw new Error(`Get events failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      return data;
    } catch (error) {
      logger.error('UnifiedEventService: Error getting events:', error);
      throw error;
    }
  }

  /**
   * Force full refresh by loading events with forceRefresh flag
   * @param {Array} calendarIds - Array of calendar IDs to refresh
   * @param {string} startTime - Start time for date range (optional)
   * @param {string} endTime - End time for date range (optional)
   * @returns {Object} Refresh result
   */
  async forceFullSync(calendarIds, startTime = null, endTime = null) {
    try {
      // Use the regular loadEvents method with forceRefresh flag
      const result = await this.loadEvents({
        calendarIds: calendarIds,
        startTime: startTime,
        endTime: endTime,
        forceRefresh: true
      });

      return {
        message: 'Full refresh completed using regular load',
        calendarIds: calendarIds,
        eventCount: result.count,
        loadResults: result.loadResults
      };
    } catch (error) {
      logger.error('UnifiedEventService: Error in force refresh:', error);
      throw error;
    }
  }

  /**
   * Update internal fields for an event
   * @param {string} eventId - Event ID
   * @param {Object} internalData - Internal data to update
   * @returns {Object} Updated event
   */
  async updateEventInternalData(eventId, internalData) {
    try {
      // This endpoint will need to be implemented to update internal data in unified collection
      const response = await fetch(`${API_BASE_URL}/events/${eventId}/internal`, {
        method: 'PATCH',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ internalData: internalData })
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('UnifiedEventService: Update internal data HTTP error', { 
          status: response.status, 
          statusText: response.statusText,
          errorText: errorText
        });
        throw new Error(`Update internal data failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      return data;
    } catch (error) {
      logger.error('UnifiedEventService: Error updating internal data:', error);
      throw error;
    }
  }

  /**
   * Get sync statistics
   * @returns {Object} Sync statistics
   */
  async getSyncStats() {
    try {
      const response = await fetch(`${API_BASE_URL}/events/sync-stats`, {
        method: 'GET',
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`Get sync stats failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      logger.error('UnifiedEventService: Error getting sync stats:', error);
      throw error;
    }
  }
}

// Export singleton instance
const unifiedEventService = new UnifiedEventService();
export default unifiedEventService;