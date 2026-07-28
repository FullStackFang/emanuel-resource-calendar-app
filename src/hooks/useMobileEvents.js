// src/hooks/useMobileEvents.js
/**
 * The mobile calendar tab's event window.
 *
 * Lifted verbatim out of `MobileAgenda` so the agenda and the 3-day grid share
 * one in-memory window: a manual two-week rolling range over POST /events/load,
 * extended (never re-fetched) as the user navigates outside it. Deliberately NOT
 * a TanStack query — migrating it would drag in the query-key/caching
 * conventions; that is a separate change.
 *
 * The consumer owns `selectedDate`; this hook only reacts to it.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import APP_CONFIG from '../config/config';
import { transformEventToFlatStructure } from '../utils/eventTransformers';
import { prepareEventsForAgenda } from '../utils/agendaEventPipeline';
import { logger } from '../utils/logger';

function getCalendarOwner() {
  const config = APP_CONFIG.CALENDAR_CONFIG;
  return config.DEFAULT_MODE === 'production'
    ? config.PRODUCTION_CALENDAR
    : config.SANDBOX_CALENDAR;
}

/**
 * The fetch window around a date: the Sunday of its week through 13 days later.
 * Also drives the agenda's rendered day list, hence the export.
 */
export function getWeekRange(centerDate) {
  const start = new Date(centerDate);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 13);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * @param {Date} selectedDate The date the calendar tab is centered on. Moving it
 *   outside the loaded range appends the missing window.
 */
export function useMobileEvents(selectedDate) {
  const { apiToken: token } = useAuth();

  const [events, setEvents] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const loadedRangeRef = useRef(null);
  const fetchingRef = useRef(false);

  const fetchEvents = useCallback(async (rangeStart, rangeEnd, { append = false } = {}) => {
    if (!token || fetchingRef.current) return;
    fetchingRef.current = true;
    setError(null);

    try {
      const calendarOwner = getCalendarOwner();

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/events/load`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            calendarOwners: [calendarOwner],
            calendarIds: [],
            startTime: rangeStart.toISOString(),
            endTime: rangeEnd.toISOString(),
            forceRefresh: false
          })
        }
      );

      if (!response.ok) throw new Error('Failed to load events');

      const data = await response.json();
      const rawEvents = data.events || [];

      // Expand recurring series and dedupe customized occurrences BEFORE
      // flattening — raw docs contain seriesMaster + exception/addition
      // children, not renderable occurrence rows (see agendaEventPipeline).
      const transformed = prepareEventsForAgenda(rawEvents, rangeStart, rangeEnd)
        .map(e => transformEventToFlatStructure(e))
        .filter(e => e.status === 'published' || e.status === 'pending');

      transformed.sort((a, b) =>
        (a.startDateTime || '').localeCompare(b.startDateTime || '')
      );

      if (append) {
        setEvents(prev => {
          const existingIds = new Set(prev.map(e => e.id || e._id));
          const newEvents = transformed.filter(e => !existingIds.has(e.id || e._id));
          if (newEvents.length === 0) return prev;
          return [...prev, ...newEvents].sort((a, b) =>
            (a.startDateTime || '').localeCompare(b.startDateTime || '')
          );
        });
      } else {
        setEvents(transformed);
      }

      const prevRange = loadedRangeRef.current;
      if (prevRange && append) {
        loadedRangeRef.current = {
          start: new Date(Math.min(prevRange.start.getTime(), rangeStart.getTime())),
          end: new Date(Math.max(prevRange.end.getTime(), rangeEnd.getTime())),
        };
      } else {
        loadedRangeRef.current = { start: new Date(rangeStart), end: new Date(rangeEnd) };
      }
    } catch (err) {
      logger.error('useMobileEvents: Error loading events:', err);
      setError('Unable to load events. Pull down to retry.');
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
      fetchingRef.current = false;
    }
  }, [token]);

  useEffect(() => {
    const { start, end } = getWeekRange(new Date());
    fetchEvents(start, end);
  }, [fetchEvents]);

  useEffect(() => {
    if (!loadedRangeRef.current) return;
    const { start, end } = getWeekRange(selectedDate);
    const loaded = loadedRangeRef.current;
    if (start < loaded.start || end > loaded.end) {
      fetchEvents(start, end, { append: true });
    }
  }, [selectedDate, fetchEvents]);

  const groupedEvents = useMemo(() => events.reduce((groups, event) => {
    const key = event.startDate || null;
    if (!key) return groups;
    if (!groups[key]) groups[key] = [];
    groups[key].push(event);
    return groups;
  }, {}), [events]);

  const eventDates = useMemo(() => new Set(Object.keys(groupedEvents)), [groupedEvents]);

  /** Pull-to-refresh: discard the loaded range and re-fetch it from scratch. */
  const refresh = useCallback(() => {
    if (fetchingRef.current) return;
    setRefreshing(true);
    const { start, end } = getWeekRange(selectedDate);
    loadedRangeRef.current = null;
    fetchEvents(start, end);
  }, [selectedDate, fetchEvents]);

  /** Error-state retry: same reset, but shows the skeleton rather than the spinner. */
  const retry = useCallback(() => {
    const { start, end } = getWeekRange(selectedDate);
    loadedRangeRef.current = null;
    setInitialLoading(true);
    fetchEvents(start, end);
  }, [selectedDate, fetchEvents]);

  return {
    events,
    groupedEvents,
    eventDates,
    initialLoading,
    refreshing,
    error,
    refresh,
    retry,
  };
}

export default useMobileEvents;
