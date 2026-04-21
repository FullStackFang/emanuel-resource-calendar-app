// src/hooks/useRoleTypes.js
import { useState, useEffect } from 'react';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';

// Hardcoded fallback matching the seed data — ensures forms never render empty
const FALLBACK_ROLE_TYPES = [
  { key: '', name: 'None', description: 'No organizational role' },
  { key: 'rabbi', name: 'Rabbi', description: 'Rabbinical staff' },
  { key: 'cantor', name: 'Cantor', description: 'Cantorial staff' },
  { key: 'clergy', name: 'Clergy', description: 'Other clergy members' },
  { key: 'staff', name: 'Staff', description: 'Temple staff' },
  { key: 'lay-leader', name: 'Lay Leader', description: 'Lay leadership' },
  { key: 'external', name: 'External', description: 'External user' },
];

// Module-level cache to avoid repeat fetches across components
let cachedRoleTypes = null;
let cachePromise = null;

async function fetchRoleTypes() {
  const response = await fetch(`${APP_CONFIG.API_BASE_URL}/role-types`);
  if (!response.ok) {
    throw new Error(`Failed to load role types: ${response.status}`);
  }
  return response.json();
}

export default function useRoleTypes() {
  const [roleTypes, setRoleTypes] = useState(cachedRoleTypes || FALLBACK_ROLE_TYPES);
  const [loading, setLoading] = useState(!cachedRoleTypes);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (cachedRoleTypes) {
      setRoleTypes(cachedRoleTypes);
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        setLoading(true);
        // Deduplicate concurrent fetches
        if (!cachePromise) {
          cachePromise = fetchRoleTypes();
        }
        const data = await cachePromise;
        cachedRoleTypes = data;
        setRoleTypes(data);
      } catch (err) {
        logger.error('Error loading role types:', err);
        setError(err.message);
        // Keep fallback data on error
      } finally {
        setLoading(false);
        cachePromise = null;
      }
    };

    load();
  }, []);

  const reload = async () => {
    try {
      setLoading(true);
      setError(null);
      cachedRoleTypes = null;
      cachePromise = null;
      const data = await fetchRoleTypes();
      cachedRoleTypes = data;
      setRoleTypes(data);
    } catch (err) {
      logger.error('Error reloading role types:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return { roleTypes, loading, error, reload };
}
