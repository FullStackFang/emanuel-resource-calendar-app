import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import APP_CONFIG from '../../config/config';
import { useMobileEvents, getWeekRange } from '../../hooks/useMobileEvents';
import { useOutlookCategoriesQuery } from '../../hooks/useCategoriesQuery';
import { buildCategoryColorResolver } from '../../utils/categoryColors';
import MobileWeekStrip from './MobileWeekStrip';
import MobileViewSwitcher from './MobileViewSwitcher';
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
 */
function MobileCalendarTab() {
  const { apiToken } = useAuth();

  const [selectedDate, setSelectedDate] = useState(() => new Date());
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

  const handleEventTap = useCallback((event) => setSelectedEvent(event), []);
  const handleDetailClose = useCallback(() => setSelectedEvent(null), []);

  return (
    <div className="mobile-calendar-tab">
      <MobileWeekStrip
        selectedDate={selectedDate}
        onDateSelect={setSelectedDate}
        eventDates={eventDates}
      />

      <MobileViewSwitcher activeView={activeView} onChange={setActiveView} />

      {activeView === 'threeDay' ? (
        <MobileThreeDay
          selectedDate={selectedDate}
          groupedEvents={groupedEvents}
          resolveCategoryColor={resolveCategoryColor}
          loading={initialLoading}
          error={error}
          onEventTap={handleEventTap}
          onRetry={retry}
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
        />
      )}

      <MobileEventDetail
        event={selectedEvent}
        onClose={handleDetailClose}
      />
    </div>
  );
}

export default MobileCalendarTab;
