import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import APP_CONFIG from '../../config/config';
import { useMobileEvents, getWeekRange } from '../../hooks/useMobileEvents';
import { useOutlookCategoriesQuery } from '../../hooks/useCategoriesQuery';
import { useHorizontalSwipe } from '../../hooks/useHorizontalSwipe';
import { buildCategoryColorResolver } from '../../utils/categoryColors';
import MobileWeekStrip, { formatDateKey, isSameDay } from './MobileWeekStrip';
import MobileAgenda from './MobileAgenda';
import MobileThreeDay from './MobileThreeDay';
import MobileEventDetail from './MobileEventDetail';
import { logger } from '../../utils/logger';
import './MobileCalendarTab.css';

export const VIEW_STORAGE_KEY = 'mobile-calendar-view';
const VALID_VIEWS = ['agenda', 'threeDay'];

/** Days added to the rendered range per scroll extension. */
export const EXTEND_DAYS = 14;

function addDays(date, delta) {
  const next = new Date(date);
  next.setDate(next.getDate() + delta);
  return next;
}

/**
 * Whether `target` skips days the rendered range does not already reach.
 * Exact adjacency is contiguous — the ranges are whole-day aligned, so a target
 * beginning 1ms after the rendered end leaves no day unaccounted for.
 */
function isDisjoint(target, range) {
  return target.end.getTime() < range.start.getTime() - 1
    || target.start.getTime() > range.end.getTime() + 1;
}

/** Agenda for anyone who has never chosen; localStorage may be unavailable. */
function readStoredView() {
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return VALID_VIEWS.includes(stored) ? stored : 'agenda';
  } catch {
    return 'agenda';
  }
}

/**
 * The calendar tab shell.
 *
 * Owns everything the agenda and the 3-day grid share — the selected date, the
 * event window, the week strip, and the detail sheet — so switching views is
 * pure presentation: no refetch, no date reset. The child views are rendered
 * from the same in-memory window.
 *
 * Selection INTENT, scroll OBSERVATION, and rendered EXTENT are three different
 * pieces of state:
 *
 *   selectedDate   written by strip tap, date picker, Today, swipe
 *                  read by the fetch window, the 3-day columns, the agenda's
 *                  scroll-into-view, and `renderedRange`
 *   visibleDate    written by the agenda's scroll observation; forced to follow
 *                  `selectedDate` on every intent change
 *                  read by the week strip only
 *   renderedRange  written by `selectedDate` changes and by scroll extension
 *                  read by `datesToShow` only
 *
 * `MobileAgenda` scrolls to `selectedDate` whenever it changes, so a
 * scroll-driven write to that same state would drive itself. Splitting them
 * makes the loop unrepresentable rather than suppressed by a flag: nothing
 * `visibleDate` or `renderedRange` feeds can cause a scroll. `datesToShow` only
 * ever adds sections, and the scroll-into-view effect is keyed on the selected
 * day, which extension never writes.
 */
function MobileCalendarTab() {
  const { apiToken } = useAuth();

  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [visibleDate, setVisibleDate] = useState(() => new Date());
  const [renderedRange, setRenderedRange] = useState(() => getWeekRange(new Date()));
  const [activeView, setActiveView] = useState(readStoredView);
  const [selectedEvent, setSelectedEvent] = useState(null);

  const {
    groupedEvents,
    eventDates,
    initialLoading,
    refreshing,
    error,
    refresh,
    retry,
    ensureRange,
  } = useMobileEvents(selectedDate);

  // Shares Calendar.jsx's query key and 30-minute staleTime, so this is
  // normally a cache read. A Graph outage resolves [] and every block renders
  // gray rather than failing.
  const { data: outlookCategories = [] } = useOutlookCategoriesQuery(
    apiToken,
    APP_CONFIG.DEFAULT_DISPLAY_CALENDAR
  );
  const resolveCategoryColor = useMemo(
    () => buildCategoryColorResolver(outlookCategories),
    [outlookCategories]
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, activeView);
    } catch (err) {
      // A full or blocked storage quota must not break the switcher.
      logger.warn('MobileCalendarTab: could not persist view preference', err);
    }
  }, [activeView]);

  // The days the agenda lists. Two weeks to begin with, then whatever the
  // reader has scrolled into — no longer tied to a single window around the
  // selected date, which is what used to dead-end the list.
  const datesToShow = useMemo(() => {
    const dates = [];
    const cursor = new Date(renderedRange.start);
    while (cursor <= renderedRange.end) {
      dates.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }, [renderedRange]);

  // Intent wins: a tapped day highlights immediately instead of waiting for the
  // smooth scroll to land and be observed. The functional form bails out when
  // the day is already right, so the memoized strip does not re-render.
  const selectedKey = formatDateKey(selectedDate);
  useEffect(() => {
    setVisibleDate(prev => (formatDateKey(prev) === selectedKey ? prev : selectedDate));
  }, [selectedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigation grows the rendered range when it stays contiguous, and replaces
  // it when it does not. Without the replace branch, picking a date months out
  // would render every intervening day; ordinary stepping, swiping and week
  // chevrons always overlap, so only a real jump resets.
  //
  // Unlike a scroll extension (below) this renders immediately rather than
  // waiting on the fetch: the reader asked to be here, so the days appear and
  // events fill in behind them.
  useEffect(() => {
    setRenderedRange(prev => {
      const target = getWeekRange(selectedDate);
      if (isDisjoint(target, prev)) return target;
      if (target.start >= prev.start && target.end <= prev.end) return prev;
      return {
        start: target.start < prev.start ? target.start : prev.start,
        end: target.end > prev.end ? target.end : prev.end,
      };
    });
  }, [selectedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Observation only — deliberately does NOT touch `selectedDate`, so scrolling
  // never moves the fetch window or the rendered day list.
  const handleVisibleDateChange = useCallback((date) => {
    setVisibleDate(prev => (isSameDay(prev, date) ? prev : date));
  }, []);

  const stepDay = useCallback((delta) => {
    setSelectedDate(prev => {
      const next = new Date(prev);
      next.setDate(next.getDate() + delta);
      return next;
    });
  }, []);
  const handleSwipeLeft = useCallback(() => stepDay(1), [stepDay]);
  const handleSwipeRight = useCallback(() => stepDay(-1), [stepDay]);

  // Bound to the view area only — the week strip's own chevrons already do
  // weeks, so a horizontal drag there must not also step a day.
  const { handlers: swipeHandlers, axisRef } = useHorizontalSwipe({
    onSwipeLeft: handleSwipeLeft,
    onSwipeRight: handleSwipeRight,
  });

  /**
   * Grow the rendered range by two weeks at one end, but only once the data is
   * actually held. Committing optimistically would show fourteen days
   * confidently labelled "No events" that may well have events, and scrolling
   * — unlike tapping a date — is not a request to be anywhere in particular.
   *
   * @returns {Promise<'covered'|'suppressed'|'error'>} passed back so the
   *   agenda can tell "retry offered" from "try again on the next scroll".
   */
  const handleExtendRange = useCallback(async (direction) => {
    const target = direction === 'past'
      ? { start: addDays(renderedRange.start, -EXTEND_DAYS), end: renderedRange.end }
      : { start: renderedRange.start, end: addDays(renderedRange.end, EXTEND_DAYS) };

    const status = await ensureRange(target.start, target.end);
    if (status === 'covered') setRenderedRange(target);
    return status;
  }, [renderedRange, ensureRange]);

  const handleEventTap = useCallback((event) => setSelectedEvent(event), []);
  const handleDetailClose = useCallback(() => setSelectedEvent(null), []);

  return (
    <div className="mobile-calendar-tab">
      <MobileWeekStrip
        selectedDate={visibleDate}
        onDateSelect={setSelectedDate}
        eventDates={eventDates}
        activeView={activeView}
        onViewChange={setActiveView}
      />

      <div className="mobile-calendar-view" {...swipeHandlers}>
        {activeView === 'threeDay' ? (
          <MobileThreeDay
            selectedDate={selectedDate}
            groupedEvents={groupedEvents}
            resolveCategoryColor={resolveCategoryColor}
            loading={initialLoading}
            error={error}
            onEventTap={handleEventTap}
            onRetry={retry}
            axisRef={axisRef}
          />
        ) : (
          <MobileAgenda
            selectedDate={selectedDate}
            datesToShow={datesToShow}
            groupedEvents={groupedEvents}
            loading={initialLoading}
            refreshing={refreshing}
            error={error}
            onEventTap={handleEventTap}
            onRefresh={refresh}
            onRetry={retry}
            onVisibleDateChange={handleVisibleDateChange}
            onExtendRange={handleExtendRange}
            axisRef={axisRef}
          />
        )}
      </div>

      <MobileEventDetail
        event={selectedEvent}
        onClose={handleDetailClose}
      />
    </div>
  );
}

export default MobileCalendarTab;
