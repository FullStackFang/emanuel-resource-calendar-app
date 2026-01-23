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
  return useQuery({
    queryKey: BASE_CATEGORIES_QUERY_KEY,
    queryFn: () => fetchBaseCategories(apiToken),
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!apiToken, // Only fetch when token is available
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
  return useQuery({
    queryKey: [...OUTLOOK_CATEGORIES_QUERY_KEY, userId],
    queryFn: () => fetchOutlookCategories(apiToken, userId),
    staleTime: 10 * 60 * 1000, // 10 minutes - Outlook categories change less frequently
    enabled: !!apiToken && !!userId, // Only fetch when both token and userId are available
  });
};

export default { useBaseCategoriesQuery, useOutlookCategoriesQuery };
