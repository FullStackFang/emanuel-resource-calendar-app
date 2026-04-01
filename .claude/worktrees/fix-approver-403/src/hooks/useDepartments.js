// src/hooks/useDepartments.js
import { useState, useEffect } from 'react';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';

// Hardcoded fallback matching the seed data — ensures forms never render empty
const FALLBACK_DEPARTMENTS = [
  { key: '', name: 'None', description: 'No department-specific edit access' },
  { key: 'security', name: 'Security', description: 'Can edit door times on events' },
  { key: 'maintenance', name: 'Maintenance', description: 'Can edit setup/teardown times' },
  { key: 'it', name: 'IT', description: 'Information Technology' },
  { key: 'clergy', name: 'Clergy', description: 'Clergy staff' },
  { key: 'membership', name: 'Membership', description: 'Membership department' },
  { key: 'communications', name: 'Communications', description: 'Communications department' },
  { key: 'streicker', name: 'Streicker', description: 'Streicker Center' },
];

// Module-level cache to avoid repeat fetches across components
let cachedDepartments = null;
let cachePromise = null;

async function fetchDepartments() {
  const response = await fetch(`${APP_CONFIG.API_BASE_URL}/departments`);
  if (!response.ok) {
    throw new Error(`Failed to load departments: ${response.status}`);
  }
  return response.json();
}

export default function useDepartments() {
  const [departments, setDepartments] = useState(cachedDepartments || FALLBACK_DEPARTMENTS);
  const [loading, setLoading] = useState(!cachedDepartments);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (cachedDepartments) {
      setDepartments(cachedDepartments);
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        setLoading(true);
        // Deduplicate concurrent fetches
        if (!cachePromise) {
          cachePromise = fetchDepartments();
        }
        const data = await cachePromise;
        cachedDepartments = data;
        setDepartments(data);
      } catch (err) {
        logger.error('Error loading departments:', err);
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
      cachedDepartments = null;
      cachePromise = null;
      const data = await fetchDepartments();
      cachedDepartments = data;
      setDepartments(data);
    } catch (err) {
      logger.error('Error reloading departments:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return { departments, loading, error, reload };
}
