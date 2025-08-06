// src/context/RoomContext.jsx
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';

const RoomContext = createContext();

// Custom hook to use room context
export const useRooms = () => {
  const context = useContext(RoomContext);
  if (!context) {
    throw new Error('useRooms must be used within a RoomProvider');
  }
  return context;
};

// Room Provider component
export const RoomProvider = ({ children, apiToken }) => {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastLoaded, setLastLoaded] = useState(null);

  // Load rooms from API
  const loadRooms = useCallback(async (force = false) => {
    // Skip if recently loaded and not forcing
    if (!force && lastLoaded && Date.now() - lastLoaded < 5 * 60 * 1000) { // 5 minutes cache
      return;
    }

    try {
      setError(null);
      if (rooms.length === 0) {
        setLoading(true); // Only show loading on first load
      }
      
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/rooms`, {
        headers: apiToken ? {
          'Authorization': `Bearer ${apiToken}`
        } : {}
      });
      
      if (!response.ok) {
        throw new Error(`Failed to load rooms: ${response.status}`);
      }
      
      const roomData = await response.json();
      setRooms(Array.isArray(roomData) ? roomData : []);
      setLastLoaded(Date.now());
      
      logger.debug('Rooms loaded successfully:', {
        count: Array.isArray(roomData) ? roomData.length : 0,
        timestamp: new Date().toISOString()
      });
      
    } catch (err) {
      logger.error('Error loading rooms:', err);
      setError(err.message);
      // Don't clear existing rooms on error, keep cached data
    } finally {
      setLoading(false);
    }
  }, [apiToken, rooms.length, lastLoaded]);

  // Load rooms on mount and when apiToken changes
  useEffect(() => {
    if (apiToken) {
      loadRooms();
    }
  }, [apiToken, loadRooms]);

  // Get room by ID with fallback
  const getRoomById = useCallback((roomId) => {
    if (!roomId) return null;
    
    // Handle both string IDs and ObjectId formats
    const room = rooms.find(r => 
      r._id === roomId || 
      r.id === roomId || 
      r._id?.toString() === roomId ||
      r.id?.toString() === roomId
    );
    
    return room || null;
  }, [rooms]);

  // Get room name with fallback to ID
  const getRoomName = useCallback((roomId) => {
    if (!roomId) return 'Unknown Room';
    
    const room = getRoomById(roomId);
    return room?.name || roomId;
  }, [getRoomById]);

  // Get multiple room names
  const getRoomNames = useCallback((roomIds) => {
    if (!Array.isArray(roomIds)) return [];
    
    return roomIds.map(roomId => ({
      id: roomId,
      name: getRoomName(roomId),
      room: getRoomById(roomId)
    }));
  }, [getRoomName, getRoomById]);

  // Get room details with name, capacity, location, etc.
  const getRoomDetails = useCallback((roomId) => {
    const room = getRoomById(roomId);
    if (!room) {
      return {
        id: roomId,
        name: roomId,
        capacity: null,
        location: null,
        features: [],
        description: null
      };
    }

    return {
      id: room._id || room.id,
      name: room.name,
      capacity: room.capacity,
      location: room.location || `${room.building || ''} ${room.floor || ''}`.trim() || null,
      features: room.features || [],
      description: room.description || null,
      building: room.building,
      floor: room.floor
    };
  }, [getRoomById]);

  // Filter rooms by criteria
  const filterRooms = useCallback((criteria = {}) => {
    return rooms.filter(room => {
      // Capacity filter
      if (criteria.minCapacity && room.capacity < criteria.minCapacity) {
        return false;
      }

      // Features filter
      if (criteria.requiredFeatures && criteria.requiredFeatures.length > 0) {
        const roomFeatures = room.features || [];
        const hasAllFeatures = criteria.requiredFeatures.every(feature => 
          roomFeatures.includes(feature)
        );
        if (!hasAllFeatures) {
          return false;
        }
      }

      // Building filter
      if (criteria.building && room.building !== criteria.building) {
        return false;
      }

      // Name search filter
      if (criteria.searchTerm) {
        const searchLower = criteria.searchTerm.toLowerCase();
        const matchesName = room.name?.toLowerCase().includes(searchLower);
        const matchesDescription = room.description?.toLowerCase().includes(searchLower);
        const matchesLocation = room.location?.toLowerCase().includes(searchLower);
        
        if (!matchesName && !matchesDescription && !matchesLocation) {
          return false;
        }
      }

      return true;
    });
  }, [rooms]);

  // Refresh rooms data
  const refreshRooms = useCallback(() => {
    return loadRooms(true);
  }, [loadRooms]);

  // Context value
  const contextValue = {
    // Data
    rooms,
    loading,
    error,
    lastLoaded,
    
    // Room lookup functions
    getRoomById,
    getRoomName,
    getRoomNames,
    getRoomDetails,
    
    // Utility functions
    filterRooms,
    refreshRooms,
    
    // Loading function (for components that need manual control)
    loadRooms
  };

  return (
    <RoomContext.Provider value={contextValue}>
      {children}
    </RoomContext.Provider>
  );
};

// Higher-order component for easier usage
export const withRooms = (Component) => {
  return function WrappedComponent(props) {
    return (
      <RoomProvider apiToken={props.apiToken}>
        <Component {...props} />
      </RoomProvider>
    );
  };
};

export default RoomContext;