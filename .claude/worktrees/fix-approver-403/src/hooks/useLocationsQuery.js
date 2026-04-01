// src/hooks/useLocationsQuery.js
/**
 * TanStack Query hook for fetching locations
 * Provides automatic caching, background refetching, and error handling
 */

import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import APP_CONFIG from '../config/config';

/**
 * Query key for locations - used for cache invalidation
 */
export const LOCATIONS_QUERY_KEY = ['locations'];

/**
 * Fetch locations from the API
 * @param {string} apiToken - Optional API token for authentication
 */
const fetchLocations = async (apiToken) => {
  const headers = {};
  if (apiToken) {
    headers.Authorization = `Bearer ${apiToken}`;
  }

  const response = await fetch(`${APP_CONFIG.API_BASE_URL}/locations`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch locations: ${response.status}`);
  }

  return response.json();
};

/**
 * Hook for fetching locations with TanStack Query
 * @param {string} apiToken - Optional API token for authentication
 * @returns {object} Query result with data, isLoading, isError, refetch, etc.
 */
export const useLocationsQuery = (apiToken) => {
  // Use ref so queryFn always reads the latest token on background refetches
  const tokenRef = useRef(apiToken);
  tokenRef.current = apiToken;

  return useQuery({
    queryKey: LOCATIONS_QUERY_KEY,
    queryFn: () => fetchLocations(tokenRef.current),
    staleTime: 30 * 60 * 1000, // 30 minutes - locations rarely change
    // No token required for locations endpoint
    enabled: true,
  });
};

export default useLocationsQuery;
