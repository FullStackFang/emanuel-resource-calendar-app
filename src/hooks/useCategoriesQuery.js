// src/hooks/useCategoriesQuery.js
/**
 * TanStack Query hooks for fetching categories
 * Provides automatic caching, background refetching, and error handling
 */

import { useQuery } from '@tanstack/react-query';
import APP_CONFIG from '../config/config';

/**
 * Query keys for categories - used for cache invalidation
 */
export const BASE_CATEGORIES_QUERY_KEY = ['baseCategories'];
export const OUTLOOK_CATEGORIES_QUERY_KEY = ['outlookCategories'];

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
 * Fetch Outlook categories from Microsoft Graph API
 * @param {string} graphToken - Graph API token for authentication
 */
const fetchOutlookCategories = async (graphToken) => {
  if (!graphToken) {
    return [];
  }

  try {
    const response = await fetch(
      'https://graph.microsoft.com/v1.0/me/outlook/masterCategories',
      {
        headers: {
          Authorization: `Bearer ${graphToken}`,
        },
      }
    );

    if (!response.ok) {
      // Graceful fallback - return empty array if Graph API fails
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
  return useQuery({
    queryKey: BASE_CATEGORIES_QUERY_KEY,
    queryFn: () => fetchBaseCategories(apiToken),
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!apiToken, // Only fetch when token is available
  });
};

/**
 * Hook for fetching Outlook categories with TanStack Query
 * @param {string} graphToken - Graph API token for authentication
 * @returns {object} Query result with data, isLoading, isError, refetch, etc.
 */
export const useOutlookCategoriesQuery = (graphToken) => {
  return useQuery({
    queryKey: OUTLOOK_CATEGORIES_QUERY_KEY,
    queryFn: () => fetchOutlookCategories(graphToken),
    staleTime: 10 * 60 * 1000, // 10 minutes - Outlook categories change less frequently
    enabled: !!graphToken, // Only fetch when token is available
  });
};

export default { useBaseCategoriesQuery, useOutlookCategoriesQuery };
