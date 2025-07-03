// src/services/unifiedEventService.js
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';

const API_BASE_URL = APP_CONFIG.API_BASE_URL;

class UnifiedEventService {
  constructor() {
    this.apiToken = null;
    this.graphToken = null;
  }

  // Set the API token for authenticated requests
  setApiToken(token) {
    this.apiToken = token;
  }

  // Set the Graph token for Graph API calls
  setGraphToken(token) {
    this.graphToken = token;
  }

  // Get authorization headers
  getAuthHeaders() {
    if (!this.apiToken) {
      throw new Error('API token not set');
    }
    const headers = {
      'Authorization': `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json'
    };
    
    // Add Graph token if available for delta sync
    if (this.graphToken) {
      headers['X-Graph-Token'] = this.graphToken;
    }
    
    return headers;
  }

  /**
   * Sync events using delta query - only fetches changed events
   * @param {Object} params - Sync parameters
   * @param {Array} params.calendarIds - Array of calendar IDs to sync
   * @param {string} params.startTime - Start time for date range (ISO string)
   * @param {string} params.endTime - End time for date range (ISO string)
   * @param {boolean} params.forceFullSync - Force full sync instead of delta
   * @returns {Object} Sync results and events
   */
  async syncEvents({ calendarIds, startTime, endTime, forceFullSync = false }) {
    try {
      // Enhanced debug logging
      logger.debug('UnifiedEventService: Starting delta sync', { 
        calendarIds, 
        startTime, 
        endTime, 
        forceFullSync,
        calendarIdsType: typeof calendarIds,
        calendarIdsLength: Array.isArray(calendarIds) ? calendarIds.length : 'not array',
        hasApiToken: !!this.apiToken,
        hasGraphToken: !!this.graphToken
      });

      // Validate input parameters
      if (!calendarIds || !Array.isArray(calendarIds) || calendarIds.length === 0) {
        logger.error('UnifiedEventService: Invalid calendarIds', { 
          calendarIds, 
          type: typeof calendarIds,
          isArray: Array.isArray(calendarIds)
        });
        throw new Error('Invalid calendarIds: must be non-empty array');
      }

      // Log individual calendar IDs
      calendarIds.forEach((id, index) => {
        logger.debug(`UnifiedEventService: Calendar ID ${index}:`, {
          id,
          type: typeof id,
          length: id?.length,
          isEmpty: !id || id.trim() === ''
        });
      });

      const requestBody = {
        calendarIds: calendarIds,
        startTime: startTime,
        endTime: endTime,
        forceFullSync: forceFullSync
      };

      const headers = this.getAuthHeaders();
      
      logger.debug('UnifiedEventService: Making request to delta sync', {
        url: `${API_BASE_URL}/events/sync-delta`,
        method: 'POST',
        headers: {
          'Authorization': headers.Authorization ? 'Bearer [PRESENT]' : 'MISSING',
          'Content-Type': headers['Content-Type'],
          'X-Graph-Token': headers['X-Graph-Token'] ? '[PRESENT]' : 'MISSING'
        },
        bodyPreview: {
          calendarIdsCount: requestBody.calendarIds.length,
          startTime: requestBody.startTime,
          endTime: requestBody.endTime,
          forceFullSync: requestBody.forceFullSync
        }
      });

      const response = await fetch(`${API_BASE_URL}/events/sync-delta`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
      });

      logger.debug('UnifiedEventService: Received response', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries())
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('UnifiedEventService: Delta sync HTTP error', { 
          status: response.status, 
          statusText: response.statusText,
          errorText: errorText,
          url: `${API_BASE_URL}/events/sync-delta`,
          requestSentAt: new Date().toISOString()
        });
        throw new Error(`Delta sync failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      logger.debug('UnifiedEventService: Delta sync response', { 
        source: data.source, 
        eventCount: data.count,
        syncResults: data.syncResults
      });

      return data;
    } catch (error) {
      logger.error('UnifiedEventService: Error in delta sync:', error);
      throw error;
    }
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
      logger.debug('UnifiedEventService: Getting events from storage', { 
        calendarId, 
        startTime, 
        endTime 
      });

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
      logger.debug('UnifiedEventService: Get events response', { 
        source: data.source, 
        count: data.count
      });

      return data;
    } catch (error) {
      logger.error('UnifiedEventService: Error getting events:', error);
      throw error;
    }
  }

  /**
   * Force full sync by resetting delta tokens
   * @param {Array} calendarIds - Array of calendar IDs to reset
   * @returns {Object} Reset result
   */
  async forceFullSync(calendarIds) {
    try {
      logger.debug('UnifiedEventService: Forcing full sync', { calendarIds });

      const response = await fetch(`${API_BASE_URL}/events/force-sync`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ calendarIds: calendarIds })
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('UnifiedEventService: Force sync HTTP error', { 
          status: response.status, 
          statusText: response.statusText,
          errorText: errorText
        });
        throw new Error(`Force sync failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      logger.debug('UnifiedEventService: Force sync response', data);

      return data;
    } catch (error) {
      logger.error('UnifiedEventService: Error in force sync:', error);
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
      logger.debug('UnifiedEventService: Updating event internal data', { 
        eventId, 
        internalData 
      });

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
      logger.debug('UnifiedEventService: Update internal data response', data);

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