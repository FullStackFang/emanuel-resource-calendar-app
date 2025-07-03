// src/services/eventCacheService.js
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';

const API_BASE_URL = APP_CONFIG.API_BASE_URL;

class EventCacheService {
  constructor() {
    this.apiToken = null;
    this.graphToken = null;
  }

  // Set the API token for authenticated requests
  setApiToken(token) {
    this.apiToken = token;
  }

  // Set the Graph token for Graph API fallback
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
    
    // Add Graph token if available for cache miss fallback
    if (this.graphToken) {
      headers['X-Graph-Token'] = this.graphToken;
    }
    
    return headers;
  }

  /**
   * Load events using cache-first approach
   * @param {Object} params - Query parameters
   * @param {string} params.calendarId - Calendar ID to load events from
   * @param {string} params.startTime - Start time for date range (ISO string)
   * @param {string} params.endTime - End time for date range (ISO string)
   * @param {boolean} params.forceRefresh - Force refresh from Graph API
   * @returns {Object} Events with cache metadata
   */
  async loadEvents({ calendarId, startTime, endTime, forceRefresh = false }) {
    try {
      logger.debug('EventCacheService: Loading events', { calendarId, startTime, endTime, forceRefresh });

      const queryParams = new URLSearchParams({
        calendarId: calendarId,
        startTime: startTime,
        endTime: endTime,
        forceRefresh: forceRefresh.toString()
      });

      const response = await fetch(`${API_BASE_URL}/events/cached?${queryParams}`, {
        method: 'GET',
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('EventCacheService: Cache loading HTTP error', { 
          status: response.status, 
          statusText: response.statusText,
          errorText: errorText
        });
        throw new Error(`Cache loading failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      logger.debug('EventCacheService: Received response', { 
        source: data.source, 
        count: data.count || data.events?.length || 0,
        needsGraphApi: data.needsGraphApi,
        message: data.message
      });

      return data;
    } catch (error) {
      logger.error('EventCacheService: Error loading cached events:', error);
      throw error;
    }
  }

  /**
   * Cache events from Graph API response
   * @param {Array} events - Events to cache
   * @param {string} calendarId - Calendar ID
   * @returns {Object} Cache operation result
   */
  async cacheEvents(events, calendarId) {
    try {
      logger.debug('EventCacheService: Caching events', { 
        count: events.length, 
        calendarId,
        firstEvent: events[0] ? { id: events[0].id, subject: events[0].subject, calendarId: events[0].calendarId } : null
      });

      const response = await fetch(`${API_BASE_URL}/events/cache`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ events, calendarId })
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('EventCacheService: Cache POST failed', { 
          status: response.status, 
          statusText: response.statusText,
          errorText: errorText
        });
        throw new Error(`Caching failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      logger.debug('EventCacheService: Cached events successfully', {
        cachedCount: result.cachedCount,
        errorCount: result.errorCount,
        errors: result.errors
      });

      return result;
    } catch (error) {
      logger.error('EventCacheService: Error caching events:', error);
      throw error;
    }
  }

  /**
   * Cache a single event (for individual updates)
   * @param {Object} eventData - Event data to cache
   * @param {string} calendarId - Calendar ID
   * @returns {Object} Cache operation result
   */
  async cacheSingleEvent(eventData, calendarId) {
    try {
      logger.debug('EventCacheService: Caching single event', { eventId: eventData.id, calendarId });

      const response = await fetch(`${API_BASE_URL}/events/cache`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ events: [eventData], calendarId })
      });

      if (!response.ok) {
        throw new Error(`Single event caching failed: ${response.status}`);
      }

      const result = await response.json();
      logger.debug('EventCacheService: Single event cached successfully', result);

      return result;
    } catch (error) {
      logger.error('EventCacheService: Error caching single event:', error);
      throw error;
    }
  }

  /**
   * Invalidate cache for specific calendar or events
   * @param {Object} params - Invalidation parameters
   * @param {string} params.calendarId - Calendar ID to invalidate
   * @param {Array} params.eventIds - Specific event IDs to invalidate
   * @param {boolean} params.all - Invalidate all cache for user
   * @returns {Object} Invalidation result
   */
  async invalidateCache({ calendarId, eventIds, all = false }) {
    try {
      logger.debug('EventCacheService: Invalidating cache', { calendarId, eventIds, all });

      const response = await fetch(`${API_BASE_URL}/events/cache-invalidate`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ calendarId, eventIds, all })
      });

      if (!response.ok) {
        throw new Error(`Cache invalidation failed: ${response.status}`);
      }

      const result = await response.json();
      logger.debug('EventCacheService: Cache invalidated successfully', result);

      return result;
    } catch (error) {
      logger.error('EventCacheService: Error invalidating cache:', error);
      throw error;
    }
  }

  /**
   * Check which events are missing from cache
   * @param {Array} eventIds - Array of event IDs to check
   * @param {string} calendarId - Calendar ID
   * @returns {Object} Missing cache information
   */
  async checkMissingFromCache(eventIds, calendarId) {
    try {
      logger.debug('EventCacheService: Checking missing from cache', { eventIds: eventIds.length, calendarId });

      const response = await fetch(`${API_BASE_URL}/events/cache-missing`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ eventIds, calendarId })
      });

      if (!response.ok) {
        throw new Error(`Missing cache check failed: ${response.status}`);
      }

      const result = await response.json();
      logger.debug('EventCacheService: Missing cache check completed', result);

      return result;
    } catch (error) {
      logger.error('EventCacheService: Error checking missing cache:', error);
      throw error;
    }
  }

  /**
   * Cache only events that are missing from cache
   * @param {Array} events - All events to potentially cache
   * @param {string} calendarId - Calendar ID
   * @returns {Object} Selective cache result
   */
  async cacheUncachedEvents(events, calendarId) {
    try {
      if (!events || events.length === 0) {
        return { message: 'No events to check', cachedCount: 0 };
      }

      logger.debug('EventCacheService: Checking for uncached events', { 
        totalEvents: events.length, 
        calendarId,
        hasCalendarId: !!calendarId
      });
      logger.debug('EventCacheService: First few events:', events.slice(0, 3).map(e => ({
        id: e.id, 
        subject: e.subject,
        calendarId: e.calendarId
      })));

      // Check which events are missing from cache
      const eventIds = events.map(e => e.id);
      const missingInfo = await this.checkMissingFromCache(eventIds, calendarId);

      logger.debug('EventCacheService: Missing cache check result', {
        totalEvents: eventIds.length,
        cachedCount: missingInfo.cachedCount || 0,
        missingCount: missingInfo.missingCount || 0,
        missingEventIds: missingInfo.missingEventIds?.length || 0
      });

      if (missingInfo.missingCount === 0) {
        logger.debug('EventCacheService: All events already cached');
        return { 
          message: 'All events already cached', 
          cachedCount: 0,
          alreadyCachedCount: missingInfo.cachedCount 
        };
      }

      // Filter to only events that need caching
      const eventsToCache = events.filter(event => 
        missingInfo.missingEventIds.includes(event.id)
      );

      logger.debug(`EventCacheService: Caching ${eventsToCache.length} missing events for calendar ${calendarId}`);

      // Cache the missing events
      const result = await this.cacheEvents(eventsToCache, calendarId);
      
      logger.debug('EventCacheService: Cache result', {
        cachedCount: result.cachedCount || 0,
        errorCount: result.errorCount || 0,
        message: result.message
      });
      
      return {
        ...result,
        message: `Selectively cached ${eventsToCache.length} missing events`,
        alreadyCachedCount: missingInfo.cachedCount,
        totalChecked: events.length
      };

    } catch (error) {
      logger.error('EventCacheService: Error in selective caching:', error);
      throw error;
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  async getCacheStats() {
    try {
      const response = await fetch(`${API_BASE_URL}/events/cache-stats`, {
        method: 'GET',
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`Cache stats failed: ${response.status}`);
      }

      const stats = await response.json();
      logger.debug('EventCacheService: Cache stats retrieved', stats);

      return stats;
    } catch (error) {
      logger.error('EventCacheService: Error getting cache stats:', error);
      throw error;
    }
  }

  /**
   * Load events with fallback to Graph API
   * This method orchestrates cache-first loading with Graph API fallback
   * @param {Object} params - Load parameters
   * @param {Function} graphApiLoader - Function to load from Graph API
   * @returns {Object} Events and metadata
   */
  async loadEventsWithFallback(params, graphApiLoader) {
    try {
      // First try cache
      const cacheResult = await this.loadEvents(params);
      
      if (cacheResult.source === 'cache' && cacheResult.events.length > 0) {
        logger.debug('EventCacheService: Using cached events');
        return {
          events: cacheResult.events,
          source: 'cache',
          cached: true,
          cachedAt: cacheResult.cachedAt
        };
      }

      // Cache miss or force refresh - use Graph API
      logger.debug('EventCacheService: Cache miss or force refresh, loading from Graph API');
      
      const graphEvents = await graphApiLoader(params);
      
      // Cache the fresh events (fire and forget - don't wait)
      if (graphEvents && graphEvents.length > 0) {
        this.cacheEvents(graphEvents, params.calendarId).catch(error => {
          logger.warn('EventCacheService: Failed to cache events after Graph API load', error);
        });
      }

      return {
        events: graphEvents || [],
        source: 'graph_api',
        cached: false,
        freshLoad: true
      };

    } catch (cacheError) {
      logger.warn('EventCacheService: Cache loading failed, falling back to Graph API', cacheError);
      
      // Fallback to Graph API if cache fails
      try {
        const graphEvents = await graphApiLoader(params);
        return {
          events: graphEvents || [],
          source: 'graph_api_fallback',
          cached: false,
          fallback: true
        };
      } catch (graphError) {
        logger.error('EventCacheService: Both cache and Graph API failed', graphError);
        throw graphError;
      }
    }
  }
}

// Export singleton instance
const eventCacheService = new EventCacheService();
export default eventCacheService;