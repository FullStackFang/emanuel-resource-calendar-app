// src/context/LocationContext.jsx
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';

const LocationContext = createContext();

// Custom hook to use location context
export const useLocations = () => {
  const context = useContext(LocationContext);
  if (!context) {
    throw new Error('useLocations must be used within a LocationProvider');
  }
  return context;
};

// Location Provider component
export const LocationProvider = ({ children, apiToken }) => {
  const [locations, setLocations] = useState([]);
  const [generalLocations, setGeneralLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastLoaded, setLastLoaded] = useState(null);
  const [lastLoadedGeneral, setLastLoadedGeneral] = useState(null);

  // Load locations from API
  const loadLocations = useCallback(async (force = false) => {
    // Skip if recently loaded and not forcing
    if (!force && lastLoaded && Date.now() - lastLoaded < 5 * 60 * 1000) { // 5 minutes cache
      return;
    }

    try {
      setError(null);
      if (locations.length === 0) {
        setLoading(true); // Only show loading on first load
      }
      
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/rooms`, {
        headers: apiToken ? {
          'Authorization': `Bearer ${apiToken}`
        } : {}
      });
      
      if (!response.ok) {
        throw new Error(`Failed to load locations: ${response.status}`);
      }
      
      const locationData = await response.json();
      setLocations(Array.isArray(locationData) ? locationData : []);
      setLastLoaded(Date.now());
      
      logger.debug('Locations loaded successfully:', {
        count: Array.isArray(locationData) ? locationData.length : 0,
        timestamp: new Date().toISOString()
      });
      
    } catch (err) {
      logger.error('Error loading locations:', err);
      setError(err.message);
      // Don't clear existing locations on error, keep cached data
    } finally {
      setLoading(false);
    }
  }, [apiToken, locations.length, lastLoaded]);

  // Load general locations from templeEvents__Locations collection
  const loadGeneralLocations = useCallback(async (force = false) => {
    // Skip if recently loaded and not forcing
    if (!force && lastLoadedGeneral && Date.now() - lastLoadedGeneral < 5 * 60 * 1000) { // 5 minutes cache
      return;
    }

    try {
      setError(null);
      if (generalLocations.length === 0) {
        setLoading(true); // Only show loading on first load
      }
      
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/locations`, {
        headers: apiToken ? {
          'Authorization': `Bearer ${apiToken}`
        } : {}
      });
      
      if (!response.ok) {
        throw new Error(`Failed to load general locations: ${response.status}`);
      }
      
      const locationData = await response.json();
      setGeneralLocations(Array.isArray(locationData) ? locationData : []);
      setLastLoadedGeneral(Date.now());
      
      logger.debug('General locations loaded successfully:', {
        count: Array.isArray(locationData) ? locationData.length : 0,
        timestamp: new Date().toISOString()
      });
      
    } catch (err) {
      logger.error('Error loading general locations:', err);
      setError(err.message);
      // Don't clear existing locations on error, keep cached data
    } finally {
      setLoading(false);
    }
  }, [apiToken, generalLocations.length, lastLoadedGeneral]);

  // Load locations on mount and when apiToken changes
  useEffect(() => {
    if (apiToken) {
      loadLocations();
      loadGeneralLocations();
    }
  }, [apiToken, loadLocations, loadGeneralLocations]);

  // Get location by ID with fallback (supports legacy room terminology)
  const getLocationById = useCallback((locationId) => {
    if (!locationId) return null;
    
    // Handle both string IDs and ObjectId formats
    const location = locations.find(l => 
      l._id === locationId || 
      l.id === locationId || 
      l._id?.toString() === locationId ||
      l.id?.toString() === locationId
    );
    
    return location || null;
  }, [locations]);

  // Get location name with fallback to ID (supports legacy room terminology)
  const getLocationName = useCallback((locationId) => {
    if (!locationId) return 'Unknown Location';
    
    const location = getLocationById(locationId);
    return location?.name || locationId;
  }, [getLocationById]);

  // Get multiple location names (supports legacy room terminology)
  const getLocationNames = useCallback((locationIds) => {
    if (!Array.isArray(locationIds)) return [];
    
    return locationIds.map(locationId => ({
      id: locationId,
      name: getLocationName(locationId),
      location: getLocationById(locationId)
    }));
  }, [getLocationName, getLocationById]);

  // Get location details with name, capacity, location, etc.
  const getLocationDetails = useCallback((locationId) => {
    const location = getLocationById(locationId);
    if (!location) {
      return {
        id: locationId,
        name: locationId,
        capacity: null,
        location: null,
        features: [],
        description: null
      };
    }

    return {
      id: location._id || location.id,
      name: location.name,
      capacity: location.capacity,
      location: location.location || `${location.building || ''} ${location.floor || ''}`.trim() || null,
      features: location.features || [],
      description: location.description || null,
      building: location.building,
      floor: location.floor
    };
  }, [getLocationById]);

  // Filter locations by criteria
  const filterLocations = useCallback((criteria = {}) => {
    return locations.filter(location => {
      // Capacity filter
      if (criteria.minCapacity && location.capacity < criteria.minCapacity) {
        return false;
      }

      // Features filter
      if (criteria.requiredFeatures && criteria.requiredFeatures.length > 0) {
        const locationFeatures = location.features || [];
        const hasAllFeatures = criteria.requiredFeatures.every(feature => 
          locationFeatures.includes(feature)
        );
        if (!hasAllFeatures) {
          return false;
        }
      }

      // Building filter
      if (criteria.building && location.building !== criteria.building) {
        return false;
      }

      // Name search filter
      if (criteria.searchTerm) {
        const searchLower = criteria.searchTerm.toLowerCase();
        const matchesName = location.name?.toLowerCase().includes(searchLower);
        const matchesDescription = location.description?.toLowerCase().includes(searchLower);
        const matchesLocationText = location.location?.toLowerCase().includes(searchLower);
        
        if (!matchesName && !matchesDescription && !matchesLocationText) {
          return false;
        }
      }

      return true;
    });
  }, [locations]);

  // Refresh locations data
  const refreshLocations = useCallback(() => {
    return loadLocations(true);
  }, [loadLocations]);

  // Backward compatibility aliases
  const getRoomById = getLocationById;
  const getRoomName = getLocationName;
  const getRoomNames = getLocationNames;
  const getRoomDetails = getLocationDetails;
  const filterRooms = filterLocations;
  const refreshRooms = refreshLocations;
  const loadRooms = loadLocations;

  // Context value with both new location API and legacy room API for compatibility
  const contextValue = {
    // Data (both new and legacy names)
    locations,
    generalLocations, // locations from templeEvents__Locations collection
    rooms: locations, // legacy compatibility
    loading,
    error,
    lastLoaded,
    lastLoadedGeneral,
    
    // New location functions
    getLocationById,
    getLocationName,
    getLocationNames,
    getLocationDetails,
    filterLocations,
    refreshLocations,
    loadLocations,
    loadGeneralLocations,
    
    // Legacy room functions (for backward compatibility)
    getRoomById,
    getRoomName,
    getRoomNames,
    getRoomDetails,
    filterRooms,
    refreshRooms,
    loadRooms
  };

  return (
    <LocationContext.Provider value={contextValue}>
      {children}
    </LocationContext.Provider>
  );
};

// Higher-order component for easier usage (both new and legacy)
export const withLocations = (Component) => {
  return function WrappedComponent(props) {
    return (
      <LocationProvider apiToken={props.apiToken}>
        <Component {...props} />
      </LocationProvider>
    );
  };
};

// Legacy compatibility
export const withRooms = withLocations;
export const RoomProvider = LocationProvider;
export const useRooms = useLocations;

export default LocationContext;

// Legacy export for backward compatibility
export const RoomContext = LocationContext;