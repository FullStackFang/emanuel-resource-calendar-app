import React, { useEffect, useCallback, useRef } from 'react';
import { formatDateKey } from './MobileWeekStrip';
import MobileEventCard from './MobileEventCard';
import { DAY_NAMES, MONTH_NAMES_SHORT } from './mobileConstants';
import './MobileAgenda.css';

/**
 * The agenda list — presentational.
 *
 * The selected date, the event window, the week strip, and the detail sheet all
 * live in `MobileCalendarTab` so the 3-day grid can share them. What stays here
 * is the list itself, its day headers, and pull-to-refresh (which is
 * agenda-only: the gesture fights vertical panning in a time grid).
 *
 * @param {Date} selectedDate      Drives the scroll-into-view on date change.
 * @param {Date[]} datesToShow     The day sections to render, in order.
 * @param {Object} groupedEvents   'YYYY-MM-DD' -> events for that day.
 */
function MobileAgenda({
  selectedDate,
  datesToShow,
  groupedEvents,
  loading,
  refreshing,
  error,
  onEventTap,
  onRefresh,
  onRetry,
}) {
  const listRef = useRef(null);
  const dateRefs = useRef({});

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

  // Scroll the picked day into view. Skips the first run: on mount the list
  // should open at the top of its window, exactly as it did when this component
  // owned the date and only scrolled from inside its own onDateSelect handler.
  const didMountRef = useRef(false);
  const selectedKey = formatDateKey(selectedDate);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    requestAnimationFrame(() => {
      const el = dateRefs.current[selectedKey];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }, [selectedKey]);

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
      if (pullDistance > 80) {
        onRefresh?.();
      }
      pullStartY.current = null;
    }
  }, [onRefresh]);

  // Clean up stale dateRefs when date range changes
  useEffect(() => {
    const activeKeys = new Set(datesToShow.map(formatDateKey));
    Object.keys(dateRefs.current).forEach(key => {
      if (!activeKeys.has(key)) delete dateRefs.current[key];
    });
  }, [datesToShow]);

  return (
    <div className="mobile-agenda">
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
        {loading ? (
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
            <button className="mobile-agenda-retry" onClick={onRetry}>
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
                        onTap={onEventTap}
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
    </div>
  );
}

export default MobileAgenda;
