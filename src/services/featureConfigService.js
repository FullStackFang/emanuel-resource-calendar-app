// src/services/featureConfigService.js
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';

class FeatureConfigService {
  constructor() {
    this.cache = null;
    this.cacheTime = null;
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get complete feature configuration (categories, capabilities, services)
   */
  async getFeatureConfig(forceRefresh = false) {
    // Return cached data if valid
    if (!forceRefresh && this.cache && this.cacheTime && 
        (Date.now() - this.cacheTime < this.cacheTimeout)) {
      return this.cache;
    }

    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/feature-config`);
      if (!response.ok) {
        throw new Error(`Failed to fetch feature config: ${response.status}`);
      }

      const config = await response.json();
      
      // Cache the result
      this.cache = config;
      this.cacheTime = Date.now();
      
      logger.debug('Feature configuration loaded:', {
        categoriesCount: config.categories?.length || 0,
        capabilitiesCount: Object.keys(config.capabilities || {}).length,
        servicesCount: Object.keys(config.services || {}).length
      });

      return config;
    } catch (error) {
      logger.error('Error fetching feature configuration:', error);
      
      // Return cached data if available on error
      if (this.cache) {
        logger.debug('Returning cached feature config due to error');
        return this.cache;
      }
      
      // Return empty structure if no cache
      return {
        categories: [],
        capabilities: {},
        services: {}
      };
    }
  }

  /**
   * Get all feature categories
   */
  async getCategories() {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/feature-categories`);
      if (!response.ok) {
        throw new Error(`Failed to fetch categories: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      logger.error('Error fetching feature categories:', error);
      return [];
    }
  }

  /**
   * Get room capability types
   */
  async getRoomCapabilityTypes(category = null) {
    try {
      const url = category 
        ? `${APP_CONFIG.API_BASE_URL}/room-capability-types?category=${category}`
        : `${APP_CONFIG.API_BASE_URL}/room-capability-types`;
        
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch room capabilities: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      logger.error('Error fetching room capability types:', error);
      return [];
    }
  }

  /**
   * Get event service types
   */
  async getEventServiceTypes(category = null) {
    try {
      const url = category
        ? `${APP_CONFIG.API_BASE_URL}/event-service-types?category=${category}`
        : `${APP_CONFIG.API_BASE_URL}/event-service-types`;
        
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch event services: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      logger.error('Error fetching event service types:', error);
      return [];
    }
  }

  /**
   * Create a new feature category (Admin only)
   */
  async createCategory(categoryData, apiToken) {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/feature-categories`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify(categoryData)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Failed to create category: ${response.status}`);
      }

      // Clear cache on successful create
      this.clearCache();
      
      return await response.json();
    } catch (error) {
      logger.error('Error creating feature category:', error);
      throw error;
    }
  }

  /**
   * Create a new room capability type (Admin only)
   */
  async createRoomCapability(capabilityData, apiToken) {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/room-capability-types`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify(capabilityData)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Failed to create room capability: ${response.status}`);
      }

      // Clear cache on successful create
      this.clearCache();
      
      return await response.json();
    } catch (error) {
      logger.error('Error creating room capability:', error);
      throw error;
    }
  }

  /**
   * Create a new event service type (Admin only)
   */
  async createEventService(serviceData, apiToken) {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/event-service-types`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify(serviceData)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Failed to create event service: ${response.status}`);
      }

      // Clear cache on successful create
      this.clearCache();
      
      return await response.json();
    } catch (error) {
      logger.error('Error creating event service:', error);
      throw error;
    }
  }

  /**
   * Update a feature category (Admin only)
   */
  async updateCategory(categoryId, categoryData, apiToken) {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/feature-categories/${categoryId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify(categoryData)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Failed to update category: ${response.status}`);
      }

      // Clear cache on successful update
      this.clearCache();
      
      return await response.json();
    } catch (error) {
      logger.error('Error updating feature category:', error);
      throw error;
    }
  }

  /**
   * Delete a feature category (Admin only)
   */
  async deleteCategory(categoryId, apiToken) {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/feature-categories/${categoryId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Failed to delete category: ${response.status}`);
      }

      // Clear cache on successful delete
      this.clearCache();
      
      return await response.json();
    } catch (error) {
      logger.error('Error deleting feature category:', error);
      throw error;
    }
  }

  /**
   * Update a room capability type (Admin only)
   */
  async updateRoomCapability(capabilityId, capabilityData, apiToken) {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/room-capability-types/${capabilityId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify(capabilityData)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Failed to update room capability: ${response.status}`);
      }

      // Clear cache on successful update
      this.clearCache();
      
      return await response.json();
    } catch (error) {
      logger.error('Error updating room capability:', error);
      throw error;
    }
  }

  /**
   * Delete a room capability type (Admin only)
   */
  async deleteRoomCapability(capabilityId, apiToken) {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/room-capability-types/${capabilityId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Failed to delete room capability: ${response.status}`);
      }

      // Clear cache on successful delete
      this.clearCache();
      
      return await response.json();
    } catch (error) {
      logger.error('Error deleting room capability:', error);
      throw error;
    }
  }

  /**
   * Update an event service type (Admin only)
   */
  async updateEventService(serviceId, serviceData, apiToken) {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/event-service-types/${serviceId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify(serviceData)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Failed to update event service: ${response.status}`);
      }

      // Clear cache on successful update
      this.clearCache();
      
      return await response.json();
    } catch (error) {
      logger.error('Error updating event service:', error);
      throw error;
    }
  }

  /**
   * Delete an event service type (Admin only)
   */
  async deleteEventService(serviceId, apiToken) {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/event-service-types/${serviceId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Failed to delete event service: ${response.status}`);
      }

      // Clear cache on successful delete
      this.clearCache();
      
      return await response.json();
    } catch (error) {
      logger.error('Error deleting event service:', error);
      throw error;
    }
  }

  /**
   * Clear the configuration cache
   */
  clearCache() {
    this.cache = null;
    this.cacheTime = null;
  }

  /**
   * Convert old hardcoded features to dynamic format
   * This helps during migration from hardcoded to dynamic features
   */
  convertLegacyFeatures(legacyFeatures) {
    const featureMap = {
      // Room capabilities (infrastructure)
      'kitchen': 'hasKitchen',
      'stage': 'hasStage',
      'piano': 'hasPiano',
      'projector': 'hasProjector',
      'sound-system': 'hasSoundSystem',
      'av-equipment': 'hasProjector',
      
      // Policies
      'wheelchair-accessible': 'isWheelchairAccessible',
      'hearing-loop': 'hasHearingLoop',
      
      // These should be event services, not room features
      'microphone': 'needsMicrophones',
      'whiteboard': 'hasWhiteboard',
      'tables': 'needsTables',
      'chairs': 'needsChairs'
    };

    return legacyFeatures.map(feature => featureMap[feature] || feature);
  }

  /**
   * Get room capabilities as options for forms
   * Returns format compatible with existing MultiSelect components
   */
  async getRoomCapabilityOptions() {
    const capabilities = await this.getRoomCapabilityTypes();
    
    return capabilities.map(cap => ({
      value: cap.key,
      label: `${cap.icon} ${cap.name}`,
      description: cap.description,
      category: cap.category
    }));
  }

  /**
   * Get event service options for forms
   * Returns format compatible with existing components
   */
  async getEventServiceOptions() {
    const services = await this.getEventServiceTypes();
    
    return services.map(service => ({
      value: service.key,
      label: `${service.icon} ${service.name}`,
      description: service.description,
      category: service.category,
      hasCost: service.hasCost
    }));
  }
}

// Export singleton instance
const featureConfigService = new FeatureConfigService();
export default featureConfigService;