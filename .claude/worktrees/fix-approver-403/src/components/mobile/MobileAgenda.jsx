import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import APP_CONFIG from '../../config/config';
import { transformEventToFlatStructure } from '../../utils/eventTransformers';
import MobileWeekStrip, { formatDateKey } from './MobileWeekStrip';
import MobileEventCard from './MobileEventCard';
import MobileEventDetail from './MobileEventDetail';
import { DAY_NAMES, MONTH_NAMES_SHORT } from './mobileConstants';
import './MobileAgenda.css';

function getCalendarOwner() {
  const config = APP_CONFIG.CALENDAR_CONFIG;
  return config.DEFAULT_MODE === 'production'
    ? config.PRODUCTION_CALENDAR
    : config.SANDBOX_CALENDAR;
}

function getWeekRange(centerDate) {
  const start = new Date(centerDate);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 13);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function MobileAgenda() {
  const { apiToken: token } = useAuth();

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const listRef = useRef(null);
  const dateRefs = useRef({});
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

      const transformed = rawEvents
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
      console.error('MobileAgenda: Error loading events:', err);
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

  // Memoize date list — only recalculate when selected week changes
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

  // Precompute today/tomorrow keys for date headers
  const todayKey = formatDateKey(new Date());
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowKey = formatDateKey(tomorrowDate);

  function formatDateHeader(date) {
    const key = formatDateKey(date);
    if (key === todayKey) {
      return `Today, ${DAY_NAMES[date.getDay()].slice(0, 3)} ${MONTH_NAMES_SHORT[date.getMonth()]} ${date.getDate()}`;
    }
    if (key === tomorrowKey) {
      return `Tomorrow, ${DAY_NAMES[date.getDay()].slice(0, 3)} ${MONTH_NAMES_SHORT[date.getMonth()]} ${date.getDate()}`;
    }
    return `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES_SHORT[date.getMonth()]} ${date.getDate()}`;
  }

  const handleDateSelect = useCallback((date) => {
    setSelectedDate(date);
    requestAnimationFrame(() => {
      const key = formatDateKey(date);
      const el = dateRefs.current[key];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }, []);

  // Pull-to-refresh
  const pullStartY = useRef(null);
  const handleTouchStart = useCallback((e) => {
    if (listRef.current?.scrollTop === 0) {
      pullStartY.current = e.touches[0].clientY;
    }
  }, []);
  const handleTouchEnd = useCallback((e) => {
    if (pullStartY.current !== null) {
      const pullDistance = e.changedTouches[0].clientY - pullStartY.current;
      if (pullDistance > 80 && !fetchingRef.current) {
        setRefreshing(true);
        const { start, end } = getWeekRange(selectedDate);
        loadedRangeRef.current = null;
        fetchEvents(start, end);
      }
      pullStartY.current = null;
    }
  }, [selectedDate, fetchEvents]);

  // Clean up stale dateRefs when date range changes
  useEffect(() => {
    const activeKeys = new Set(datesToShow.map(formatDateKey));
    Object.keys(dateRefs.current).forEach(key => {
      if (!activeKeys.has(key)) delete dateRefs.current[key];
    });
  }, [datesToShow]);

  return (
    <div className="mobile-agenda">
      <MobileWeekStrip
        selectedDate={selectedDate}
        onDateSelect={handleDateSelect}
        eventDates={eventDates}
      />

      {refreshing && (
        <div className="mobile-agenda-refresh">
          <div className="mobile-agenda-refresh-spinner" />
        </div>
      )}

      <div
        className="mobile-agenda-list"
        ref={listRef}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {initialLoading ? (
          <div className="mobile-agenda-skeleton">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="mobile-agenda-skeleton-item">
                <div className="mobile-agenda-skeleton-header skeleton" />
                <div className="mobile-agenda-skeleton-card skeleton" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="mobile-agenda-error">
            <p>{error}</p>
            <button
              className="mobile-agenda-retry"
              onClick={() => {
                const { start, end } = getWeekRange(selectedDate);
                loadedRangeRef.current = null;
                setInitialLoading(true);
                fetchEvents(start, end);
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          datesToShow.map(date => {
            const key = formatDateKey(date);
            const dayEvents = groupedEvents[key] || [];

            return (
              <div
                key={key}
                className="mobile-agenda-day"
                ref={el => { dateRefs.current[key] = el; }}
              >
                <div className="mobile-agenda-day-header">
                  {formatDateHeader(date)}
                </div>
                {dayEvents.length > 0 ? (
                  <div className="mobile-agenda-day-events">
                    {dayEvents.map(event => (
                      <MobileEventCard
                        key={event.id || event._id}
                        event={event}
                        onTap={setSelectedEvent}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="mobile-agenda-day-empty">No events</div>
                )}
              </div>
            );
          })
        )}
      </div>

      <MobileEventDetail
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
      />
    </div>
  );
}

export default MobileAgenda;
