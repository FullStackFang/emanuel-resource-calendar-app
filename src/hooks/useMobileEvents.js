// src/hooks/useMobileEvents.js
/**
 * The mobile calendar tab's event window.
 *
 * Lifted verbatim out of `MobileAgenda` so the agenda and the 3-day grid share
 * one in-memory window: a manual rolling range over POST /events/load, extended
 * (never re-fetched) as the user navigates or scrolls outside it. Deliberately
 * NOT a TanStack query — migrating it would drag in the query-key/caching
 * conventions; that is a separate change.
 *
 * There are two ways the range grows, and they are shaped differently on
 * purpose:
 *
 *   selectedDate  declarative. Navigation is stated intent, so the consumer
 *                 renders the new days immediately and events fill in behind.
 *   ensureRange   imperative. Scrolling is not a request to go anywhere, so the
 *                 consumer awaits this and only then commits the new days —
 *                 otherwise the reader is shown days confidently labelled
 *                 "No events" that may well have events.
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
 * No longer the rendered day list — the consumer owns that separately, which is
 * what lets the list outgrow a single window.
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
 *   outside the loaded range loads the missing days.
 */
export function useMobileEvents(selectedDate) {
  const { apiToken: token } = useAuth();

  const [events, setEvents] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const loadedRangeRef = useRef(null);
  const fetchingRef = useRef(false);

  /** One request for one span. Throws on failure; owns no loading flags. */
  const fetchSpan = useCallback(async (rangeStart, rangeEnd, { append }) => {
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
  }, [token]);

  /**
   * Load whatever part of `target` is not already held.
   *
   * Fetching only the gaps is what makes an unbounded range affordable: without
   * it, every extension re-requests the whole accumulated span. It also removes
   * an existing inefficiency — stepping across a Sunday used to refetch all 14
   * days of the new window to gain 7 new ones.
   *
   * @param {{start: Date, end: Date}} target
   * @param {'initial'|'jump'|'extend'|'refresh'} mode
   * @returns {Promise<'covered'|'suppressed'|'error'>}
   */
  const coverRange = useCallback(async (target, mode) => {
    if (!token) return 'suppressed';
    // Single-flight. Lives here rather than in fetchSpan so that a target
    // straddling both ends can fetch its two gaps in sequence.
    if (fetchingRef.current) return 'suppressed';

    const loaded = loadedRangeRef.current;
    const spans = [];
    // A disjoint target is a jump. Re-anchoring rather than min/max-widening
    // the loaded range is what stops it from claiming to cover the skipped gap
    // — without this, navigating back into that gap fetches nothing.
    //
    // Exact adjacency is NOT disjoint: ranges are whole-day aligned, so a
    // target starting 1ms after the loaded end skips no days. This is reachable
    // — two windows anchored two Sundays apart abut exactly — and treating it
    // as a jump would discard a range that is genuinely contiguous.
    const disjoint = !!loaded && (
      target.end.getTime() < loaded.start.getTime() - 1 ||
      target.start.getTime() > loaded.end.getTime() + 1
    );
    const anchorToTarget = !loaded || disjoint || mode === 'refresh';

    if (anchorToTarget) {
      spans.push({ start: target.start, end: target.end });
    } else {
      if (target.start < loaded.start) {
        spans.push({ start: target.start, end: new Date(loaded.start.getTime() - 1) });
      }
      if (target.end > loaded.end) {
        spans.push({ start: new Date(loaded.end.getTime() + 1), end: target.end });
      }
    }

    if (spans.length === 0) return 'covered';

    fetchingRef.current = true;
    // An extension failure must not reach the full-screen error panel, which
    // would replace a list the reader already has.
    if (mode === 'refresh') setRefreshing(true);
    if (mode !== 'extend') setError(null);

    try {
      // Only a reload discards what is held. A disjoint jump keeps its events
      // in memory (they are grouped by date, so unrendered days cost nothing).
      let append = mode === 'jump' || mode === 'extend';
      for (const span of spans) {
        await fetchSpan(span.start, span.end, { append });
        append = true;
      }

      loadedRangeRef.current = anchorToTarget
        ? { start: new Date(target.start), end: new Date(target.end) }
        : {
            start: new Date(Math.min(loaded.start.getTime(), target.start.getTime())),
            end: new Date(Math.max(loaded.end.getTime(), target.end.getTime())),
          };
      return 'covered';
    } catch (err) {
      logger.error('useMobileEvents: Error loading events:', err);
      if (mode !== 'extend') setError('Unable to load events. Pull down to retry.');
      return 'error';
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
      fetchingRef.current = false;
    }
  }, [token, fetchSpan]);

  useEffect(() => {
    coverRange(getWeekRange(new Date()), 'initial');
  }, [coverRange]);

  useEffect(() => {
    // The mount effect owns the first load.
    if (!loadedRangeRef.current) return;
    coverRange(getWeekRange(selectedDate), 'jump');
  }, [selectedDate, coverRange]);

  /**
   * Load a range and report whether it is now held. The agenda awaits this
   * before rendering the days, so `suppressed` and `error` both mean "do not
   * grow the list" — the difference is only whether to offer a retry.
   */
  const ensureRange = useCallback(
    (start, end) => coverRange({ start, end }, 'extend'),
    [coverRange]
  );

  const groupedEvents = useMemo(() => events.reduce((groups, event) => {
    const key = event.startDate || null;
    if (!key) return groups;
    if (!groups[key]) groups[key] = [];
    groups[key].push(event);
    return groups;
  }, {}), [events]);

  const eventDates = useMemo(() => new Set(Object.keys(groupedEvents)), [groupedEvents]);

  /**
   * The span a reload should cover: everything held, however far the reader has
   * scrolled. Refreshing only the selected week would leave the rest of a grown
   * list showing pre-refresh data.
   */
  const rangeToReload = useCallback(() => {
    const loaded = loadedRangeRef.current;
    return loaded
      ? { start: new Date(loaded.start), end: new Date(loaded.end) }
      : getWeekRange(selectedDate);
  }, [selectedDate]);

  /** Pull-to-refresh: discard the loaded events and re-fetch the whole range. */
  const refresh = useCallback(() => {
    if (fetchingRef.current) return;
    coverRange(rangeToReload(), 'refresh');
  }, [coverRange, rangeToReload]);

  /** Error-state retry: same reload, but shows the skeleton rather than the spinner. */
  const retry = useCallback(() => {
    // Checked before mutating: a suppressed retry that had already cleared the
    // loaded range would strand the skeleton with nothing in flight to end it.
    if (fetchingRef.current) return;
    const target = rangeToReload();
    loadedRangeRef.current = null;
    setInitialLoading(true);
    coverRange(target, 'initial');
  }, [coverRange, rangeToReload]);

  return {
    events,
    groupedEvents,
    eventDates,
    initialLoading,
    refreshing,
    error,
    refresh,
    retry,
    ensureRange,
  };
}

export default useMobileEvents;
