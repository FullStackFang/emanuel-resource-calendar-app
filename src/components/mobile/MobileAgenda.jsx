import React, { useEffect, useCallback, useRef, useMemo } from 'react';
import { formatDateKey } from './MobileWeekStrip';
import MobileEventCard from './MobileEventCard';
import { dayAtScrollTop } from '../../utils/agendaScrollSpy';
import { DAY_NAMES, MONTH_NAMES_SHORT } from './mobileConstants';
import './MobileAgenda.css';

/**
 * The agenda list — presentational.
 *
 * The selected date, the event window, the week strip, and the detail sheet all
 * live in `MobileCalendarTab` so the 3-day grid can share them. What stays here
 * is the list itself, its day headers, pull-to-refresh (agenda-only: the
 * gesture fights vertical panning in a time grid), and the scroll spy that
 * tells the shell which day the reader is actually looking at.
 *
 * @param {Date} selectedDate      Drives the scroll-into-view on date change.
 * @param {Date[]} datesToShow     The day sections to render, in order.
 * @param {Object} groupedEvents   'YYYY-MM-DD' -> events for that day.
 * @param {(date: Date) => void} onVisibleDateChange
 *        Reports the day at the top of the viewport. Observation, not intent —
 *        the shell must not feed it back into `selectedDate`.
 * @param {React.MutableRefObject<'x'|'y'|null>} axisRef
 *        The shell's swipe axis. An `x`-locked gesture never pull-to-refreshes.
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
  onVisibleDateChange,
  axisRef,
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
  // Holds the day a smooth scroll is travelling toward. `scrollIntoView` emits
  // a scroll event per intervening pixel, so without this the strip would race
  // through every day between here and the target before settling.
  const programmaticTargetRef = useRef(null);
  /** The day the shell is known to already have. Suppresses redundant reports. */
  const lastReportedRef = useRef(null);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    programmaticTargetRef.current = selectedKey;
    // The shell already believes this day is visible — it forces `visibleDate`
    // to follow intent — so landing on it is not news worth reporting back.
    lastReportedRef.current = selectedKey;
    requestAnimationFrame(() => {
      const el = dateRefs.current[selectedKey];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }, [selectedKey]);

  // Report the day at the top of the viewport. Passive and rAF-throttled: this
  // runs on every scroll frame of a list the user flicks.
  const dateByKey = useMemo(() => {
    const map = new Map();
    datesToShow.forEach(date => map.set(formatDateKey(date), date));
    return map;
  }, [datesToShow]);
  useEffect(() => {
    const listEl = listRef.current;
    if (!listEl || !onVisibleDateChange) return undefined;

    // `scheduled` is tracked separately from the frame handle: the handle is
    // only assigned after the callback returns, so a callback that runs
    // synchronously would leave a stale non-zero handle behind.
    let scheduled = false;
    let frame = 0;
    const observe = () => {
      scheduled = false;
      const el = listRef.current;
      if (!el) return;
      // Offsets are normalized against the list's own box rather than read from
      // `offsetTop`, whose origin depends on which ancestor happens to be
      // positioned.
      const listTop = el.getBoundingClientRect().top;
      const scrollTop = el.scrollTop;
      const sections = [];
      Object.entries(dateRefs.current).forEach(([key, node]) => {
        if (!node) return;
        sections.push({
          key,
          offsetTop: node.getBoundingClientRect().top - listTop + scrollTop,
        });
      });

      const key = dayAtScrollTop(sections, scrollTop);
      if (!key) return;
      if (programmaticTargetRef.current) {
        if (key !== programmaticTargetRef.current) return;
        programmaticTargetRef.current = null;
      }
      if (key === lastReportedRef.current) return;
      lastReportedRef.current = key;
      const date = dateByKey.get(key);
      if (date) onVisibleDateChange(date);
    };

    const handleScroll = () => {
      if (scheduled) return;
      scheduled = true;
      frame = requestAnimationFrame(observe);
    };
    listEl.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      listEl.removeEventListener('scroll', handleScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [onVisibleDateChange, dateByKey]);

  // Pull-to-refresh
  const pullStartY = useRef(null);
  const handleTouchStart = useCallback((e) => {
    // A touch means the user has taken the list over: any smooth scroll still
    // in flight is now theirs to interrupt, so stop ignoring observations.
    // Without this, tapping a day that needs no scroll would strand the spy.
    programmaticTargetRef.current = null;
    if (listRef.current?.scrollTop === 0) {
      pullStartY.current = e.touches[0].clientY;
    }
  }, []);
  const handleTouchEnd = useCallback((e) => {
    // The swipe's locked axis is authoritative. A firm diagonal drag from the
    // top of the list can clear the 80px pull threshold and the swipe distance
    // at once; it must do one thing, and stepping the day is what it was.
    if (axisRef?.current === 'x') {
      pullStartY.current = null;
      return;
    }
    if (pullStartY.current !== null) {
      const pullDistance = e.changedTouches[0].clientY - pullStartY.current;
      if (pullDistance > 80) {
        onRefresh?.();
      }
      pullStartY.current = null;
    }
  }, [onRefresh, axisRef]);

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
