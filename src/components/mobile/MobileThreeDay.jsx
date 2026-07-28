import React, { useMemo, useRef, useEffect, useState } from 'react';
import { parseTimeFromString, formatTimeFromDateTimeString } from '../../utils/appTimeUtils';
import { formatDateKey, isSameDay } from './MobileWeekStrip';
import { DAY_LABELS } from './mobileConstants';
import './MobileThreeDay.css';

export const HOUR_HEIGHT = 52;
export const GRID_TOP_INSET = 8;
export const MIN_BLOCK_HEIGHT = 20;
export const MINUTES_PER_DAY = 24 * 60;
/** Open on the working day, not on midnight. */
export const INITIAL_SCROLL_HOUR = 9;
export const INITIAL_SCROLL_TOP = GRID_TOP_INSET + INITIAL_SCROLL_HOUR * HOUR_HEIGHT;

/**
 * Density tier cutoffs, in rendered block pixels.
 *
 * A block has its height minus 2px border and 2px padding to spend on text. A
 * 30-minute event is 26px -> 22px of content, which fits exactly one line; an
 * hour is 52px -> 48px, enough for two title lines plus a location. These are
 * the numbers those tiers are derived from — moving HOUR_HEIGHT means revisiting
 * them.
 */
export const TIER_MED_MIN_HEIGHT = 34;
export const TIER_TALL_MIN_HEIGHT = 50;

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Compact hour labels — `7a`, `12p`. Spelling out "10:00 AM" is what forced the
 * old 44px gutter, which cost every column ~5px of text width to state
 * something the reader parses once.
 */
function formatHourLabel(hour) {
  if (hour === 0) return '12a';
  if (hour === 12) return '12p';
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

/** How much text a block of this height can carry without clipping mid-line. */
export function densityTier(height) {
  if (height < TIER_MED_MIN_HEIGHT) return 'short';
  if (height < TIER_TALL_MIN_HEIGHT) return 'med';
  return 'tall';
}

/**
 * Minutes past local midnight for a stored datetime.
 *
 * String-parsed, never `new Date()`: stored datetimes are naive local-time
 * strings, so constructing a Date would reinterpret them in the browser's
 * timezone and slide every block by the offset. This is the same parse
 * `MobileEventCard` uses, which is what keeps a block's position and its
 * printed time from disagreeing.
 */
export function minutesFromDateTime(dateTimeStr) {
  const t = parseTimeFromString(dateTimeStr);
  if (!t) return null;
  return t.hours * 60 + t.minutes;
}

/**
 * Vertical extent of one event within its start day.
 *
 * An event ending on a later date is clamped to midnight — it is grouped under
 * its start day (same as the agenda), so the tail belongs to a day the column
 * does not represent.
 */
export function eventSpanMinutes(event) {
  const start = minutesFromDateTime(event.startDateTime);
  if (start === null) return null;

  let end = minutesFromDateTime(event.endDateTime);
  const endsLaterDay = event.endDate && event.startDate && event.endDate !== event.startDate;
  if (end === null || endsLaterDay || end <= start) {
    end = endsLaterDay ? MINUTES_PER_DAY : Math.min(start + 30, MINUTES_PER_DAY);
  }
  return { start, end: Math.min(end, MINUTES_PER_DAY) };
}

/**
 * Position timed events within one day column.
 *
 * Overlapping events form a cluster and split the column's width equally
 * (v1 rule — no Outlook-style cascading offsets). A cluster is a maximal run of
 * events, sorted by start, each beginning before the running maximum end.
 *
 * The density tier is derived here rather than in the component: it is a pure
 * function of the geometry this function already computes, so it stays testable
 * without a render.
 *
 * @returns {Array<{event, top, height, leftPct, widthPct, tier}>}
 */
export function layoutDayEvents(events) {
  const positioned = (events || [])
    .filter(e => !e.isAllDayEvent)
    .map(event => ({ event, span: eventSpanMinutes(event) }))
    .filter(item => item.span !== null)
    .sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end);

  const clusters = [];
  let current = [];
  let clusterEnd = -1;

  for (const item of positioned) {
    if (current.length > 0 && item.span.start < clusterEnd) {
      current.push(item);
      clusterEnd = Math.max(clusterEnd, item.span.end);
    } else {
      if (current.length > 0) clusters.push(current);
      current = [item];
      clusterEnd = item.span.end;
    }
  }
  if (current.length > 0) clusters.push(current);

  return clusters.flatMap(cluster => {
    const widthPct = 100 / cluster.length;
    return cluster.map((item, index) => {
      const height = Math.max(
        MIN_BLOCK_HEIGHT,
        ((item.span.end - item.span.start) / 60) * HOUR_HEIGHT
      );
      return {
        event: item.event,
        top: GRID_TOP_INSET + (item.span.start / 60) * HOUR_HEIGHT,
        height,
        leftPct: index * widthPct,
        widthPct,
        tier: densityTier(height),
      };
    });
  });
}

/**
 * A 3px rail in the category color over an ~8% wash of it.
 *
 * The rail does the identifying, so the fill does not have to — at 13% (the
 * earlier full-outline treatment) adjacent blocks muddied into each other.
 */
function blockStyle(color) {
  return {
    borderLeft: `3px solid ${color}`,
    background: `${color}14`,
  };
}

/**
 * The 3-day time grid. Presentational — the selected date, the event window,
 * and the detail sheet all belong to `MobileCalendarTab`.
 *
 * @param {Date} selectedDate               The leftmost column.
 * @param {Object} groupedEvents            'YYYY-MM-DD' -> events for that day.
 * @param {(name: string) => string} resolveCategoryColor
 */
function MobileThreeDay({
  selectedDate,
  groupedEvents,
  resolveCategoryColor,
  loading,
  error,
  onEventTap,
  onRetry,
}) {
  const scrollRef = useRef(null);
  const [now, setNow] = useState(() => new Date());

  const days = useMemo(() => {
    const base = new Date(selectedDate);
    base.setHours(0, 0, 0, 0);
    return [0, 1, 2].map(offset => {
      const d = new Date(base);
      d.setDate(d.getDate() + offset);
      return d;
    });
  }, [selectedDate.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo(() => days.map(date => {
    const key = formatDateKey(date);
    const dayEvents = groupedEvents?.[key] || [];
    return {
      date,
      key,
      blocks: layoutDayEvents(dayEvents),
      allDay: dayEvents.filter(e => e.isAllDayEvent),
    };
  }), [days, groupedEvents]);

  const hasAllDay = columns.some(col => col.allDay.length > 0);

  // Tick the current-time indicator. Cleared on unmount so a backgrounded
  // calendar tab does not keep re-rendering.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Open on the working day, once the grid actually exists (the skeleton and
  // error states return early, so the ref is null until content renders).
  useEffect(() => {
    if (loading || error) return;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = INITIAL_SCROLL_TOP;
    }
  }, [loading, error]);

  if (loading) {
    return (
      <div className="mobile-three-day">
        <div className="mobile-three-day-skeleton skeleton" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mobile-three-day">
        <div className="mobile-agenda-error">
          <p>{error}</p>
          <button className="mobile-agenda-retry" onClick={onRetry}>Retry</button>
        </div>
      </div>
    );
  }

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowTop = GRID_TOP_INSET + (nowMinutes / 60) * HOUR_HEIGHT;

  return (
    <div className="mobile-three-day">
      {/* Header and all-day rows sit OUTSIDE the scroller. Keeping them out of
          the scrolling box (with its scrollbar hidden) is what guarantees the
          columns stay aligned with the grid beneath. */}
      <div className="mobile-three-day-header">
        <div className="mobile-three-day-gutter-spacer" />
        {columns.map(col => {
          const today = isSameDay(col.date, now);
          return (
            <div
              key={col.key}
              className={`mobile-three-day-header-cell ${today ? 'today' : ''}`}
            >
              <span className="mobile-three-day-header-letter">
                {DAY_LABELS[col.date.getDay()]}
              </span>
              <span className="mobile-three-day-header-number">
                {col.date.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {hasAllDay && (
        <div className="mobile-three-day-allday">
          {/* No "all-day" caption: it cannot render legibly in a 28px gutter,
              and a chip row pinned under the day headers reads as itself. */}
          <div className="mobile-three-day-gutter-spacer" />
          {columns.map(col => (
            <div key={col.key} className="mobile-three-day-allday-cell">
              {col.allDay.map(event => {
                const color = resolveCategoryColor(event.categories?.[0]);
                return (
                  <button
                    key={event.id || event._id}
                    type="button"
                    className={`mobile-three-day-chip ${event.status === 'pending' ? 'pending' : ''}`}
                    style={blockStyle(color)}
                    onClick={() => onEventTap?.(event)}
                  >
                    {event.eventTitle || 'Untitled Event'}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div className="mobile-three-day-scroll" ref={scrollRef} data-testid="three-day-scroll">
        <div className="mobile-three-day-grid" style={{ height: GRID_TOP_INSET + 24 * HOUR_HEIGHT }}>
          <div className="mobile-three-day-gutter">
            {HOURS.map(hour => (
              <span
                key={hour}
                className="mobile-three-day-hour-label"
                style={{ top: GRID_TOP_INSET + hour * HOUR_HEIGHT }}
              >
                {formatHourLabel(hour)}
              </span>
            ))}
          </div>

          {columns.map(col => {
            const today = isSameDay(col.date, now);
            return (
              <div
                key={col.key}
                className={`mobile-three-day-column ${today ? 'today' : ''}`}
                data-testid={`three-day-column-${col.key}`}
              >
                {HOURS.map(hour => (
                  <div
                    key={hour}
                    className="mobile-three-day-hourline"
                    style={{ top: GRID_TOP_INSET + hour * HOUR_HEIGHT }}
                  />
                ))}

                {col.blocks.map(({ event, top, height, leftPct, widthPct, tier }) => {
                  const color = resolveCategoryColor(event.categories?.[0]);
                  const location = event.locationDisplayNames || event.location || '';
                  return (
                    <button
                      key={event.id || event._id}
                      type="button"
                      className={`mobile-three-day-block ${tier} ${event.status === 'pending' ? 'pending' : ''}`}
                      style={{
                        top,
                        height,
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        ...blockStyle(color),
                      }}
                      onClick={() => onEventTap?.(event)}
                      /* The start time is deliberately not rendered — the block's
                         vertical position states it, and on a 30-minute block the
                         time line consumed the only line the title had. That makes
                         this label the ONLY source of the time for a screen
                         reader; do not thin it out. */
                      aria-label={`${event.eventTitle || 'Untitled Event'}, ${formatTimeFromDateTimeString(event.startDateTime)}`}
                    >
                      <span className="mobile-three-day-block-title">
                        {event.eventTitle || 'Untitled Event'}
                      </span>
                      {tier === 'tall' && location && (
                        <span className="mobile-three-day-block-location">{location}</span>
                      )}
                    </button>
                  );
                })}

                {today && (
                  <div
                    className="mobile-three-day-now"
                    style={{ top: nowTop }}
                    data-testid="three-day-now-indicator"
                    aria-hidden="true"
                  >
                    <span className="mobile-three-day-now-dot" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default MobileThreeDay;
