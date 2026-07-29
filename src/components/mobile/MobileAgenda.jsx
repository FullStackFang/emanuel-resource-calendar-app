import React, { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from 'react';
import { formatDateKey } from './MobileWeekStrip';
import MobileEventCard from './MobileEventCard';
import { dayAtScrollTop } from '../../utils/agendaScrollSpy';
import { DAY_NAMES, MONTH_NAMES_SHORT } from './mobileConstants';
import './MobileAgenda.css';

/** How close to an end the reader must scroll before the list extends. */
export const EXTEND_THRESHOLD_PX = 600;

/**
 * A node's offset inside the scrolling list. Normalized against the list's own
 * box rather than read from `offsetTop`, whose origin depends on which ancestor
 * happens to be positioned.
 */
function offsetWithinList(node, listTop, scrollTop) {
  return node.getBoundingClientRect().top - listTop + scrollTop;
}

/**
 * The agenda list — presentational.
 *
 * The selected date, the event window, the week strip, and the detail sheet all
 * live in `MobileCalendarTab` so the 3-day grid can share them. What stays here
 * is the list itself, its day headers, pull-to-refresh (agenda-only: the
 * gesture fights vertical panning in a time grid), the scroll spy that tells the
 * shell which day the reader is actually looking at, and the end-proximity
 * detection that asks the shell to extend the range.
 *
 * @param {Date} selectedDate      Drives the scroll-into-view on date change.
 * @param {Date[]} datesToShow     The day sections to render, in order.
 * @param {Object} groupedEvents   'YYYY-MM-DD' -> events for that day.
 * @param {(date: Date) => void} onVisibleDateChange
 *        Reports the day at the top of the viewport. Observation, not intent —
 *        the shell must not feed it back into `selectedDate`.
 * @param {(direction: 'past'|'future') => Promise<'covered'|'suppressed'|'error'>} onExtendRange
 *        Asks the shell to grow the rendered range. Resolves once the days are
 *        actually held, so this component never renders days it has no data
 *        for; `suppressed` means try again on the next scroll.
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
  onExtendRange,
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

  // Range extension. `busyDirection` places the spinner; `failedDirection`
  // places the retry. Both live here rather than in the hook because the hook
  // has no notion of which end of the list is growing.
  const [busyDirection, setBusyDirection] = useState(null);
  const [failedDirection, setFailedDirection] = useState(null);
  const busyRef = useRef(false);
  // The scroll offset at which each direction last attempted an extension.
  const attemptedAtRef = useRef({ past: null, future: null });
  const lastScrollTopRef = useRef(0);

  const requestExtend = useCallback(async (direction, scrollTop, { force = false } = {}) => {
    if (!onExtendRange || busyRef.current) return;
    // Re-arm rule: a direction may not fire again until the reader has actually
    // moved since its last attempt. Without this, an extension that lands still
    // inside the threshold immediately requests another, chaining fetches
    // nobody asked for.
    if (!force && attemptedAtRef.current[direction] === scrollTop) return;
    attemptedAtRef.current[direction] = scrollTop;

    busyRef.current = true;
    setBusyDirection(direction);
    try {
      const status = await onExtendRange(direction);
      // `suppressed` is neither success nor failure — a fetch was already in
      // flight, so leave any existing retry alone and wait for the next scroll.
      if (status === 'error') setFailedDirection(direction);
      else if (status === 'covered') setFailedDirection(null);
    } finally {
      busyRef.current = false;
      setBusyDirection(null);
    }
  }, [onExtendRange]);

  // Kept in a ref so the scroll subscription below stays stable: `onExtendRange`
  // is rebuilt by the shell on every range change, and resubscribing mid-fling
  // would drop the in-flight rAF.
  const requestExtendRef = useRef(requestExtend);
  useEffect(() => { requestExtendRef.current = requestExtend; }, [requestExtend]);

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
      const listTop = el.getBoundingClientRect().top;
      const scrollTop = el.scrollTop;

      // Extension is checked before the day observation below, which returns
      // early in several cases the reader can legitimately be scrolling through.
      //
      // Direction of travel matters, not just proximity. The list opens at
      // scrollTop 0, so a proximity-only rule would fetch a fortnight of history
      // on the reader's first downward flick. "Scrolling toward an end" means
      // moving toward it.
      const previousScrollTop = lastScrollTopRef.current;
      lastScrollTopRef.current = scrollTop;
      const distanceToBottom = el.scrollHeight - scrollTop - el.clientHeight;
      if (scrollTop > previousScrollTop && distanceToBottom < EXTEND_THRESHOLD_PX) {
        requestExtendRef.current('future', scrollTop);
      } else if (scrollTop < previousScrollTop && scrollTop < EXTEND_THRESHOLD_PX) {
        requestExtendRef.current('past', scrollTop);
      }

      const sections = [];
      Object.entries(dateRefs.current).forEach(([key, node]) => {
        if (!node) return;
        sections.push({
          key,
          offsetTop: offsetWithinList(node, listTop, scrollTop),
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

  // Hold the reader's position when content is inserted ABOVE them — prepended
  // day sections, but equally the loading and retry rows at the top of the list.
  //
  // Anchoring on a node rather than on `scrollHeight` deltas is what makes it
  // uniform: whatever appears above the anchor, the correction is the same, and
  // content appended below moves the anchor by zero. A layout effect because
  // the correction must land in the same frame as the insertion; an ordinary
  // effect is a visible jump. Depends on `overflow-anchor: none` in the CSS so
  // that engines with native scroll anchoring do not also correct and double it.
  const anchorRef = useRef(null);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) {
      anchorRef.current = null;
      return;
    }
    const listTop = el.getBoundingClientRect().top;

    const prev = anchorRef.current;
    if (prev) {
      const node = dateRefs.current[prev.key];
      // A missing or detached node means the range was replaced rather than
      // extended (a distant jump), so there is no position worth preserving.
      if (node && node.isConnected) {
        const delta = offsetWithinList(node, listTop, el.scrollTop) - prev.offsetTop;
        if (delta !== 0) el.scrollTop += delta;
      }
    }

    const firstKey = datesToShow.length ? formatDateKey(datesToShow[0]) : null;
    const firstNode = firstKey ? dateRefs.current[firstKey] : null;
    // The offset is scroll-invariant, so it does not need re-reading after the
    // correction above.
    anchorRef.current = firstNode
      ? { key: firstKey, offsetTop: offsetWithinList(firstNode, listTop, el.scrollTop) }
      : null;
  });

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

  // The spinner and the retry occupy the same slot at each end: an extension is
  // either in flight or it failed, never both.
  function renderExtendEnd(direction) {
    if (busyDirection === direction) {
      return (
        <div className="mobile-agenda-extend" aria-live="polite">
          <div className="mobile-agenda-extend-spinner" />
          <span className="mobile-agenda-extend-label">
            {direction === 'past' ? 'Loading earlier events' : 'Loading more events'}
          </span>
        </div>
      );
    }
    if (failedDirection === direction) {
      return (
        <div className="mobile-agenda-extend">
          <button
            type="button"
            className="mobile-agenda-extend-retry"
            onClick={() => requestExtend(direction, null, { force: true })}
          >
            {direction === 'past'
              ? "Couldn't load earlier events. Tap to retry."
              : "Couldn't load more events. Tap to retry."}
          </button>
        </div>
      );
    }
    return null;
  }

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
          <>
            {renderExtendEnd('past')}
            {datesToShow.map(date => {
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
            })}
            {renderExtendEnd('future')}
          </>
        )}
      </div>
    </div>
  );
}

export default MobileAgenda;
