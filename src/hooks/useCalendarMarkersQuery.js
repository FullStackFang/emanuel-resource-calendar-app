// src/hooks/useCalendarMarkersQuery.js
/**
 * TanStack Query hook for fetching active calendar markers (holiday /
 * office-closed day annotations). A single shared fetch feeds the Month/Week/
 * Day ribbon and the booking-form advisory. Mutations in the admin screen
 * invalidate keys.calendarMarkers.all() so this query refetches.
 */

import { useRef } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import APP_CONFIG from '../config/config';
import { keys } from '../queries/keys';

const fetchCalendarMarkers = async (apiToken) => {
  if (!apiToken) return [];
  const response = await fetch(`${APP_CONFIG.API_BASE_URL}/calendar-markers`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (!response.ok) {
    // Throw (do NOT return []) so the query layer treats this as a real failure:
    // it auto-retries (transient Cosmos throttling/timeout is the common cause)
    // and exposes isError. Returning [] here cached a *successful* empty result,
    // which rendered as "No markers yet" — indistinguishable from genuinely
    // having no markers. Consumers that must degrade gracefully (calendar ribbon,
    // search/export, booking advisory) default `data` to [], so a failed fetch
    // shows no ribbons rather than blanking the view.
    throw new Error(`Failed to fetch calendar markers (HTTP ${response.status})`);
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
    // Markers change a few times a year, and every CRUD write force-invalidates
    // this key — so we can keep data fresh for a long time and avoid needless
    // refetches (each of which is a chance to hit a Cosmos throttle).
    staleTime: 30 * 60 * 1000, // 30 minutes
    gcTime: 24 * 60 * 60 * 1000, // retain across in-session navigations
    // Keep the last good data on screen during any refetch so a slow/failed
    // background refresh never blanks the calendar ribbon.
    placeholderData: keepPreviousData,
    enabled: !!apiToken,
  });
};

export default useCalendarMarkersQuery;
