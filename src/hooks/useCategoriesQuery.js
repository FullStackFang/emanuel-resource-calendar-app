// src/hooks/useCategoriesQuery.js
/**
 * TanStack Query hooks for fetching categories
 * Provides automatic caching, background refetching, and error handling
 */

import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import APP_CONFIG from '../config/config';
import { keys } from '../queries/keys';

/**
 * Query keys for categories - used for cache invalidation.
 * Re-exported from the central factory in `src/queries/keys.js` so existing
 * importers (notably Calendar.jsx for `OUTLOOK_CATEGORIES_QUERY_KEY`) keep
 * working unchanged. New callers should import `keys` directly.
 */
export const BASE_CATEGORIES_QUERY_KEY = keys.baseCategories.all();
export const OUTLOOK_CATEGORIES_QUERY_KEY = keys.outlookCategories.all();

/**
 * Fetch base categories from the API
 * @param {string} apiToken - API token for authentication
 */
const fetchBaseCategories = async (apiToken) => {
  const headers = {};
  if (apiToken) {
    headers.Authorization = `Bearer ${apiToken}`;
  }

  const response = await fetch(`${APP_CONFIG.API_BASE_URL}/categories`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch categories: ${response.status}`);
  }

  return response.json();
};

/**
 * Fetch Outlook categories via backend proxy (app-only authentication)
 * @param {string} apiToken - API token for authentication
 * @param {string} userId - User ID or email to fetch categories for
 */
const fetchOutlookCategories = async (apiToken, userId) => {
  if (!apiToken || !userId) {
    return [];
  }

  try {
    const params = new URLSearchParams({ userId });
    const response = await fetch(
      `${APP_CONFIG.API_BASE_URL}/graph/categories?${params}`,
      {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
      }
    );

    if (!response.ok) {
      // Graceful fallback - return empty array if API fails
      return [];
    }

    const data = await response.json();
    return data.value || [];
  } catch (error) {
    // Graceful fallback on network errors
    return [];
  }
};

/**
 * Hook for fetching base categories with TanStack Query
 * @param {string} apiToken - API token for authentication
 * @returns {object} Query result with data, isLoading, isError, refetch, etc.
 */
export const useBaseCategoriesQuery = (apiToken) => {
  // Use ref so queryFn always reads the latest token on background refetches
  const tokenRef = useRef(apiToken);
  tokenRef.current = apiToken;

  return useQuery({
    queryKey: BASE_CATEGORIES_QUERY_KEY,
    queryFn: () => fetchBaseCategories(tokenRef.current),
    staleTime: 30 * 60 * 1000, // 30 minutes - categories rarely change
    enabled: !!apiToken, // Only fetch when token is available
  });
};

/**
 * Fetch the distinct category strings actually present on events.
 * Backend unions calendarData.categories, top-level categories, and
 * graphData.categories — the same three the search filter matches — so the
 * dropdown can offer every category in use, not just registered ones.
 * @param {string} apiToken - API token for authentication
 */
const fetchDistinctEventCategories = async (apiToken) => {
  const headers = {};
  if (apiToken) {
    headers.Authorization = `Bearer ${apiToken}`;
  }

  const response = await fetch(`${APP_CONFIG.API_BASE_URL}/internal-events/mec-categories`, {
    headers,
  });

  if (!response.ok) {
    // Graceful fallback — the dropdown still works off registered categories.
    return [];
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
};

/**
 * Hook for fetching distinct in-use event categories with TanStack Query.
 * @param {string} apiToken - API token for authentication
 */
export const useDistinctEventCategoriesQuery = (apiToken) => {
  const tokenRef = useRef(apiToken);
  tokenRef.current = apiToken;

  return useQuery({
    queryKey: keys.distinctEventCategories.all(),
    queryFn: () => fetchDistinctEventCategories(tokenRef.current),
    staleTime: 30 * 60 * 1000, // 30 minutes - categories rarely change
    enabled: !!apiToken,
  });
};

/**
 * Hook for fetching Outlook categories with TanStack Query
 * Uses backend proxy with app-only authentication
 * @param {string} apiToken - API token for authentication
 * @param {string} userId - User ID or email to fetch categories for (e.g., 'temple@emanuelnyc.org')
 * @returns {object} Query result with data, isLoading, isError, refetch, etc.
 */
export const useOutlookCategoriesQuery = (apiToken, userId) => {
  // Use ref so queryFn always reads the latest token on background refetches
  const tokenRef = useRef(apiToken);
  tokenRef.current = apiToken;

  return useQuery({
    queryKey: keys.outlookCategories.byUser(userId),
    queryFn: () => fetchOutlookCategories(tokenRef.current, userId),
    staleTime: 30 * 60 * 1000, // 30 minutes - Outlook categories rarely change
    enabled: !!apiToken && !!userId, // Only fetch when both token and userId are available
  });
};

export default { useBaseCategoriesQuery, useOutlookCategoriesQuery, useDistinctEventCategoriesQuery };
