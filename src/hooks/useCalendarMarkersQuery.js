// src/hooks/useCalendarMarkersQuery.js
/**
 * TanStack Query hook for fetching active calendar markers (holiday /
 * office-closed day annotations). A single shared fetch feeds the Month/Week/
 * Day ribbon and the booking-form advisory. Mutations in the admin screen
 * invalidate keys.calendarMarkers.all() so this query refetches.
 */

import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import APP_CONFIG from '../config/config';
import { keys } from '../queries/keys';

const fetchCalendarMarkers = async (apiToken) => {
  if (!apiToken) return [];
  const response = await fetch(`${APP_CONFIG.API_BASE_URL}/calendar-markers`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (!response.ok) {
    // Graceful fallback — a marker fetch failure must never blank the calendar.
    return [];
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
};

/**
 * @param {string} apiToken - API token for authentication
 * @returns {object} TanStack Query result; `data` is an array of active markers
 */
export const useCalendarMarkersQuery = (apiToken) => {
  // Ref so background refetches always read the latest token.
  const tokenRef = useRef(apiToken);
  tokenRef.current = apiToken;

  return useQuery({
    queryKey: keys.calendarMarkers.all(),
    queryFn: () => fetchCalendarMarkers(tokenRef.current),
    staleTime: 5 * 60 * 1000, // 5 minutes — markers change rarely
    enabled: !!apiToken,
  });
};

export default useCalendarMarkersQuery;
