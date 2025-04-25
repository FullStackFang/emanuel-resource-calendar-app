// src/hooks/useUserPreferences.jsx
import { useState, useEffect } from 'react';
import {
  loadUserPreferences,
  saveUserPreferences,
  getDefaultPreferences
} from '../services/userPreferencesService';

/**
 * A React hook to load and persist user preferences using RoamingSettings.
 */
export function useUserPreferences() {
  const [prefs, setPrefs] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load preferences once when the hook mounts
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const loaded = await loadUserPreferences();
        if (isMounted) setPrefs(loaded);
      } catch {
        if (isMounted) setPrefs(getDefaultPreferences());
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  /**
   * Merge updates into existing preferences, update state, and persist changes.
   * @param {Object} updates - Partial preferences to merge
   * @returns {Promise<boolean>} - Resolves when save completes
   */
  const updatePrefs = (updates) => {
    const merged = { ...(prefs || getDefaultPreferences()), ...updates };
    setPrefs(merged);
    return saveUserPreferences(updates);
  };

  return { prefs, loading, updatePrefs };
}
