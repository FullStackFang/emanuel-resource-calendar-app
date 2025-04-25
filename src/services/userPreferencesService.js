// src/services/userPreferencesService.jsx

/**
 * A simple service for persisting user preferences to
 * Office.js RoamingSettings (using window.Office).
 */

////////////////////////////////////////////////////////////////////////////////
// Helpers to ensure Office.js is ready (or bail immediately)
////////////////////////////////////////////////////////////////////////////////
const ensureOfficeReady = () =>
    new Promise((resolve) => {
      if (window.Office && typeof window.Office.onReady === 'function') {
        window.Office.onReady(resolve);
      } else {
        resolve();
      }
    });
  
  ////////////////////////////////////////////////////////////////////////////////
  // Default preferences
  ////////////////////////////////////////////////////////////////////////////////
  export const getDefaultPreferences = () => ({
    defaultView: 'week',
    defaultGroupBy: 'categories',
    preferredZoomLevel: 100,
    selectedLocations: [],
  });
  
  ////////////////////////////////////////////////////////////////////////////////
  // Load user preferences from RoamingSettings
  ////////////////////////////////////////////////////////////////////////////////
  export const loadUserPreferences = async () => {
    await ensureOfficeReady();
  
    // If the Office API or roamingSettings isn't available, just return defaults
    if (!window.Office?.context?.roamingSettings) {
      return getDefaultPreferences();
    }
  
    try {
      const settings = window.Office.context.roamingSettings;
      const defaults = getDefaultPreferences();
  
      // Merge stored values onto defaults
      return Object.keys(defaults).reduce((acc, key) => {
        const stored = settings.get(key);
        acc[key] = stored !== undefined ? stored : defaults[key];
        return acc;
      }, {});
    } catch (err) {
      console.error('Error loading RoamingSettings:', err);
      return getDefaultPreferences();
    }
  };
  
  ////////////////////////////////////////////////////////////////////////////////
  // Save user preferences to RoamingSettings
  ////////////////////////////////////////////////////////////////////////////////
  export const saveUserPreferences = async (updates) => {
    await ensureOfficeReady();
  
    // If the Office API or roamingSettings isn't available, bail
    if (!window.Office?.context?.roamingSettings) {
      console.warn('RoamingSettings unavailable, skipping save');
      return false;
    }
  
    try {
      const settings = window.Office.context.roamingSettings;
  
      // Set each updated key
      Object.entries(updates).forEach(([key, value]) => {
        settings.set(key, value);
      });
  
      // Persist them
      return new Promise((resolve, reject) => {
        settings.saveAsync((asyncResult) => {
          if (asyncResult.status === window.Office.AsyncResultStatus.Succeeded) {
            resolve(true);
          } else {
            console.error('Failed to save RoamingSettings:', asyncResult.error);
            reject(asyncResult.error);
          }
        });
      });
    } catch (err) {
      console.error('Error saving RoamingSettings:', err);
      return false;
    }
  };
  