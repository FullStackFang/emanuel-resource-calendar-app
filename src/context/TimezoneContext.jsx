// src/contexts/TimezoneContext.jsx
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { DEFAULT_TIMEZONE, getSafeTimezone } from '../utils/timezoneUtils';
import { logger } from '../utils/logger';

// Create the context
const TimezoneContext = createContext();

// Custom hook to use the timezone context
/* eslint-disable react-refresh/only-export-components */
export const useTimezone = () => {
  const context = useContext(TimezoneContext);
  if (!context) {
    throw new Error('useTimezone must be used within a TimezoneProvider');
  }
  return context;
};

// TimezoneProvider component
export const TimezoneProvider = ({ 
  children, 
  apiToken = null,
  apiBaseUrl = null,
  initialTimezone = DEFAULT_TIMEZONE 
}) => {
  const [userTimezone, setUserTimezone] = useState(() => {
    // Initialize with safe timezone
    return getSafeTimezone(initialTimezone);
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Update timezone preference via API
   * @param {string} newTimezone - New timezone to save
   * @returns {Promise<boolean>} Success indicator
   */
  const updateTimezonePreference = useCallback(async (newTimezone) => {
    // Validate timezone first
    const safeTimezone = getSafeTimezone(newTimezone);
    
    // Always update local state immediately for responsive UI
    setUserTimezone(safeTimezone);
    
    // Only attempt API call if we have the necessary tokens
    if (!apiToken || !apiBaseUrl) {
      logger.debug('No API configuration available - timezone saved locally only');
      return true;
    }
    
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch(`${apiBaseUrl}/users/current/preferences`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          preferredTimeZone: safeTimezone
        })
      });
      
      if (!response.ok) {
        // Don't revert local state - user preference is still valid locally
        logger.warn(`Failed to save timezone preference to API: ${response.status}`);
        
        if (response.status === 401) {
          setError('Authentication expired - timezone saved locally');
        } else {
          setError('Failed to save timezone preference to server');
        }
        
        return false;
      }
      
      logger.debug(`Timezone preference saved to API: ${safeTimezone}`);
      return true;
      
    } catch (error) {
      logger.error('Error updating timezone preference:', error);
      setError('Network error - timezone saved locally');
      return false;
    } finally {
      setIsLoading(false);
      // Clear error after a delay
      setTimeout(() => setError(null), 5000);
    }
  }, [apiToken, apiBaseUrl]);

  /**
   * Load user timezone from API on mount
   */
  const loadUserTimezone = useCallback(async () => {
    // Skip API call if no configuration
    if (!apiToken || !apiBaseUrl) {
      logger.debug('No API configuration - using default timezone');
      return;
    }
    
    try {
      setIsLoading(true);
      
      const response = await fetch(`${apiBaseUrl}/users/current`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });
      
      if (response.ok) {
        const userData = await response.json();
        const savedTimezone = userData.preferences?.preferredTimeZone;
        
        if (savedTimezone) {
          const safeTimezone = getSafeTimezone(savedTimezone);
          setUserTimezone(safeTimezone);
          logger.debug(`Loaded user timezone from API: ${safeTimezone}`);
        } else {
          logger.debug('No saved timezone preference found - using default');
        }
      } else if (response.status === 404) {
        logger.debug('User profile not found - using default timezone');
      } else if (response.status === 401) {
        logger.debug('Authentication expired - using default timezone');
        setError('Authentication expired');
      } else {
        logger.warn(`Failed to load user profile: ${response.status}`);
      }
    } catch (error) {
      logger.error('Error loading user timezone:', error);
      setError('Failed to load timezone preference');
    } finally {
      setIsLoading(false);
      // Clear error after a delay
      setTimeout(() => setError(null), 3000);
    }
  }, [apiToken, apiBaseUrl]);

  /**
   * Handle timezone change with API persistence
   * @param {string} newTimezone - New timezone value
   */
  const handleTimezoneChange = useCallback(async (newTimezone) => {
    await updateTimezonePreference(newTimezone);
  }, [updateTimezonePreference]);

  // Load user timezone on mount when API tokens become available
  useEffect(() => {
    if (apiToken && apiBaseUrl) {
      loadUserTimezone();
    }
  }, [apiToken, apiBaseUrl, loadUserTimezone]);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo(() => ({
    // State
    userTimezone,
    isLoading,
    error,

    // Actions
    setUserTimezone: handleTimezoneChange,
    updateTimezonePreference,

    // Utilities
    getSafeTimezone: (tz) => getSafeTimezone(tz || userTimezone),

    // API status
    hasApiAccess: Boolean(apiToken && apiBaseUrl)
  }), [userTimezone, isLoading, error, handleTimezoneChange, updateTimezonePreference, apiToken, apiBaseUrl]);

  return (
    <TimezoneContext.Provider value={contextValue}>
      {children}
    </TimezoneContext.Provider>
  );
};

// Optional: Higher-order component for class components
export const withTimezone = (WrappedComponent) => {
  return function WithTimezoneComponent(props) {
    const timezoneContext = useTimezone();
    return <WrappedComponent {...props} timezone={timezoneContext} />;
  };
};

export default TimezoneContext;