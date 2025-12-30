// src/context/LocationContext.jsx
import React, { createContext, useContext, useCallback, useMemo } from 'react';
import { useLocationsQuery } from '../hooks/useLocationsQuery';
import { logger } from '../utils/logger';

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
  // Use TanStack Query for data fetching with automatic caching
  const {
    data: locations = [],
    isLoading: loading,
    isError,
    error: queryError,
    refetch,
    dataUpdatedAt
  } = useLocationsQuery(apiToken);

  // Convert query error to string for backward compatibility
  const error = isError ? (queryError?.message || 'Failed to load locations') : null;
  const lastLoaded = dataUpdatedAt || null;

  // Legacy compatibility: loadLocations now triggers a refetch
  const loadLocations = useCallback(async (force = false) => {
    if (force) {
      await refetch();
    }
    // Non-forced calls are handled by TanStack Query's staleTime
  }, [refetch]);

  // Legacy compatibility: loadGeneralLocations now just calls loadLocations
  const loadGeneralLocations = useCallback(async (force = false) => {
    return loadLocations(force);
  }, [loadLocations]);

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

  // Computed properties
  const reservableRooms = locations.filter(loc => loc.isReservable === true);

  // Debug logging for room availability
  if (locations.length > 0 && reservableRooms.length === 0) {
    logger.warn('LocationContext: No reservable rooms found!', {
      totalLocations: locations.length,
      sample: locations.slice(0, 3).map(l => ({ name: l.name, isReservable: l.isReservable }))
    });
  } else if (reservableRooms.length > 0) {
    logger.debug('LocationContext: Reservable rooms available:', {
      total: reservableRooms.length,
      rooms: reservableRooms.map(r => r.name)
    });
  }

  // Context value with both new location API and legacy room API for compatibility
  const contextValue = {
    // Data (both new and legacy names)
    locations, // All locations from templeEvents__Locations
    generalLocations: locations, // Legacy compatibility - same as locations
    rooms: reservableRooms, // Legacy compatibility - only reservable locations
    loading,
    error,
    lastLoaded,
    lastLoadedGeneral: lastLoaded, // Legacy compatibility - same timestamp

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