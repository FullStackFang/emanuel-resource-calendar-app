// src/hooks/useClergyUsers.js
import { useState, useEffect } from 'react';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';

// Module-level cache to avoid repeat fetches across components (same pattern as useRoleTypes.js)
let cachedData = null;
let cachePromise = null;

async function fetchClergyUsers(apiToken) {
  const headers = {};
  if (apiToken) {
    headers.Authorization = `Bearer ${apiToken}`;
  }
  const response = await fetch(`${APP_CONFIG.API_BASE_URL}/users/clergy`, { headers });
  if (!response.ok) {
    throw new Error(`Failed to load clergy users: ${response.status}`);
  }
  return response.json();
}

export default function useClergyUsers(apiToken) {
  const [data, setData] = useState(cachedData || { rabbis: [], cantors: [] });
  const [loading, setLoading] = useState(!cachedData);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (cachedData) {
      setData(cachedData);
      setLoading(false);
      return;
    }

    if (!apiToken) {
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        setLoading(true);
        // Deduplicate concurrent fetches
        if (!cachePromise) {
          cachePromise = fetchClergyUsers(apiToken);
        }
        const result = await cachePromise;
        cachedData = result;
        setData(result);
      } catch (err) {
        logger.error('Error loading clergy users:', err);
        setError(err.message);
      } finally {
        setLoading(false);
        cachePromise = null;
      }
    };

    load();
  }, [apiToken]);

  return { rabbis: data.rabbis, cantors: data.cantors, loading, error };
}
