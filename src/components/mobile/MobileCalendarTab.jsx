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
 * Selection INTENT and scroll OBSERVATION are two different pieces of state:
 *
 *   selectedDate  written by strip tap, date picker, Today, swipe
 *                 read by the fetch window, `datesToShow`, the 3-day columns,
 *                 and the agenda's scroll-into-view
 *   visibleDate   written by the agenda's scroll observation; forced to follow
 *                 `selectedDate` on every intent change
 *                 read by the week strip only
 *
 * `MobileAgenda` scrolls to `selectedDate` whenever it changes, so a
 * scroll-driven write to that same state would drive itself. Splitting the two
 * makes the loop unrepresentable rather than suppressed by a flag: nothing
 * `visibleDate` feeds can cause a scroll.
 */
function MobileCalendarTab() {
  const { apiToken } = useAuth();

  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [visibleDate, setVisibleDate] = useState(() => new Date());
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

  // The 14 days the agenda lists — the same window the fetch covers.
  const datesToShow = useMemo(() => {
    const { start, end } = getWeekRange(selectedDate);
    const dates = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      dates.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }, [selectedDate.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  // Intent wins: a tapped day highlights immediately instead of waiting for the
  // smooth scroll to land and be observed. The functional form bails out when
  // the day is already right, so the memoized strip does not re-render.
  const selectedKey = formatDateKey(selectedDate);
  useEffect(() => {
    setVisibleDate(prev => (formatDateKey(prev) === selectedKey ? prev : selectedDate));
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
