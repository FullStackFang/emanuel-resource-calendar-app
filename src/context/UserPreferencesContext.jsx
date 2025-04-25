// src/context/UserPreferencesContext.jsx
import React, { createContext, useState, useEffect, useContext } from 'react';
import { useMsal } from '@azure/msal-react';
import { loadUserPreferences } from '../services/userPreferencesService';

// Create context
const UserPreferencesContext = createContext();

// Create provider component
export function UserPreferencesProvider({ children, accessToken }) {
  const { instance } = useMsal();
  const [preferences, setPreferences] = useState({
    canReadEvents: true,
    canWriteEvents: true, 
    canDeleteEvents: true,
    canManageCategories: true,
    canManageLocations: true,
    defaultView: 'week',
    defaultGroupBy: 'categories'
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadPreferences = async () => {
      if (accessToken) {
        try {
          // Get the active account
          const activeAccount = instance.getActiveAccount();
          if (!activeAccount) {
            console.error("No active account found");
            setIsLoading(false);
            return;
          }
          
          const userId = activeAccount.homeAccountId || activeAccount.localAccountId;
          const savedPreferences = await loadUserPreferences(userId);
          
          if (savedPreferences) {
            setPreferences(savedPreferences);
          }
        } catch (error) {
          console.error("Failed to load preferences:", error);
        } finally {
          setIsLoading(false);
        }
      }
    };

    loadPreferences();
  }, [accessToken, instance]);

  return (
    <UserPreferencesContext.Provider value={{ preferences, isLoading }}>
      {children}
    </UserPreferencesContext.Provider>
  );
}

// Create custom hook for using the context
export function useUserPreferences() {
  const context = useContext(UserPreferencesContext);
  if (context === undefined) {
    throw new Error('useUserPreferences must be used within a UserPreferencesProvider');
  }
  return context;
}