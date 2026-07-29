import React, { useMemo, useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { parseTimeFromString, formatTimeFromDateTimeString, formatHoursMinutes } from '../../utils/appTimeUtils';
import { formatDateKey, isSameDay } from './MobileWeekStrip';
import { DAY_LABELS } from './mobileConstants';
import './MobileThreeDay.css';

/**
 * Hour heights, by the maximum concurrency observed in that hour across the
 * three visible columns.
 *
 * `HOUR_HEIGHT` stays at 52 on purpose: an ordinary single-booking hour renders
 * exactly as it always has, so the change reads as the dense hours expanding
 * rather than as a wholesale rescale of the grid.
 */
export const HOUR_HEIGHT = 52;          // concurrency 1
export const HOUR_HEIGHT_BUSY = 74;     // concurrency 2
export const HOUR_HEIGHT_CROWDED = 96;  // concurrency 3+
/** An empty hour with populated neighbours on both sides. */
export const EMPTY_HOUR_HEIGHT = 20;
/** Total height of a run of 2+ empty hours, however long the run is. */
export const GAP_RUN_HEIGHT = 26;
/**
 * A populated hour inside the expanded range.
 *
 * Derived, not chosen: STACK_HEADER_HEIGHT + 4 * STACK_ROW_HEIGHT, which is the
 * height at which a four-way cluster shows every row with no `+N more`.
 */
export const EXPANDED_HOUR_HEIGHT = 168;

export const GRID_TOP_INSET = 8;
export const MIN_BLOCK_HEIGHT = 20;
export const MINUTES_PER_DAY = 24 * 60;
/** Fallback when the visible window has no timed event to open on. */
export const INITIAL_SCROLL_HOUR = 9;

/** A cluster this size or larger stops splitting the column and stacks. */
export const STACK_MIN_CLUSTER = 3;
export const STACK_HEADER_HEIGHT = 16;
export const STACK_ROW_HEIGHT = 38;
export const STACK_MORE_HEIGHT = 18;
/** Enough for the header, one row, and the `+N more` that follows it. */
export const STACK_MIN_HEIGHT = STACK_HEADER_HEIGHT + STACK_ROW_HEIGHT + STACK_MORE_HEIGHT;

/**
 * Density tier cutoffs, in rendered block pixels.
 *
 * A block has its height minus 2px border and 2px padding to spend on text. A
 * 30-minute event in a quiet hour is 26px -> 22px of content, which fits exactly
 * one line; an hour is 52px -> 48px, enough for two title lines plus a location.
 * Under the elastic axis these are a function of the *rendered* height, so the
 * same 30-minute event in a contended hour clears a higher tier — which is the
 * point: the pixels went where the contention is.
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
  const h = hour % 24;
  if (h === 0) return '12a';
  if (h === 12) return '12p';
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

/** "7:30 PM" from minutes past midnight. 1440 reads as midnight, not noon. */
function formatMinutesLabel(minutes) {
  const m = minutes % MINUTES_PER_DAY;
  return formatHoursMinutes(Math.floor(m / 60), m % 60);
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

/** Timed spans for one column, in start order. */
function columnSpans(events) {
  return (events || [])
    .filter(e => !e.isAllDayEvent)
    .map(eventSpanMinutes)
    .filter(Boolean);
}

/**
 * The most events simultaneously active at any instant inside one hour.
 *
 * Deliberately not "how many events touch this hour": 10:00-10:15 and
 * 10:30-10:45 both sit in hour 10 and never coexist, so hour 10 is a
 * single-booking hour and does not earn extra pixels. Sampling at each
 * candidate's start (clipped into the hour) is enough — the count can only rise
 * at a start.
 */
function hourConcurrency(spans, hour) {
  const hourStart = hour * 60;
  const hourEnd = hourStart + 60;
  const inHour = spans.filter(s => s.start < hourEnd && s.end > hourStart);
  if (inHour.length === 0) return 0;

  let max = 0;
  for (const candidate of inHour) {
    const at = Math.max(candidate.start, hourStart);
    let active = 0;
    for (const s of inHour) {
      if (s.start <= at && s.end > at) active += 1;
    }
    if (active > max) max = active;
  }
  return max;
}

function heightForConcurrency(concurrency) {
  if (concurrency >= 3) return HOUR_HEIGHT_CROWDED;
  if (concurrency === 2) return HOUR_HEIGHT_BUSY;
  return HOUR_HEIGHT;
}

/**
 * The elastic time axis, shared by all three columns.
 *
 * One scale for the whole window rather than one per column: cross-day
 * comparison is the only reason the 3-day view exists, and a per-column scale
 * would put the same clock time at three different heights.
 *
 * Run heights are distributed as integers summing to exactly `GAP_RUN_HEIGHT`,
 * so every offset stays an integer. That is not cosmetic — it is what keeps
 * block positions exact instead of accumulating float drift down the day.
 *
 * @param {Array<Array<Object>>} columns  Events per visible day.
 * @param {{fromHour: number, toHour: number}|null} expandedRange
 * @returns {{hourHeights: number[], offsets: number[], totalHeight: number,
 *            gapRuns: Array<Object>, collapsed: boolean[],
 *            concurrency: number[], firstEventHour: number|null}}
 */
export function buildTimeScale(columns = [], expandedRange = null) {
  const spansByColumn = columns.map(columnSpans);
  const concurrency = HOURS.map(hour =>
    spansByColumn.reduce((max, spans) => Math.max(max, hourConcurrency(spans, hour)), 0)
  );

  const isExpanded = (hour) =>
    !!expandedRange && hour >= expandedRange.fromHour && hour <= expandedRange.toHour;

  const hourHeights = new Array(24).fill(0);
  const collapsed = new Array(24).fill(false);
  const gapRuns = [];

  let hour = 0;
  while (hour < 24) {
    if (concurrency[hour] > 0) {
      hourHeights[hour] = isExpanded(hour)
        ? EXPANDED_HOUR_HEIGHT
        : heightForConcurrency(concurrency[hour]);
      hour += 1;
      continue;
    }

    let end = hour;
    while (end + 1 < 24 && concurrency[end + 1] === 0) end += 1;
    const length = end - hour + 1;

    // An expanded empty run returns to its *uncollapsed* height, not the
    // populated-hour expanded height: six empty hours at 168px each would be a
    // thousand pixels of nothing.
    const runExpanded = HOURS.slice(hour, end + 1).some(isExpanded);

    if (length >= 2 && !runExpanded) {
      const base = Math.floor(GAP_RUN_HEIGHT / length);
      let remainder = GAP_RUN_HEIGHT - base * length;
      for (let h = hour; h <= end; h += 1) {
        hourHeights[h] = base + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
        collapsed[h] = true;
      }
      gapRuns.push({ fromHour: hour, toHour: end });
    } else {
      for (let h = hour; h <= end; h += 1) hourHeights[h] = EMPTY_HOUR_HEIGHT;
    }
    hour = end + 1;
  }

  const offsets = new Array(25);
  offsets[0] = 0;
  for (let h = 0; h < 24; h += 1) offsets[h + 1] = offsets[h] + hourHeights[h];

  gapRuns.forEach(run => {
    run.top = GRID_TOP_INSET + offsets[run.fromHour];
    run.height = offsets[run.toHour + 1] - offsets[run.fromHour];
    run.label = `${formatHourLabel(run.fromHour)} – ${formatHourLabel(run.toHour + 1)}`;
  });

  const firstPopulated = concurrency.findIndex(c => c > 0);

  return {
    hourHeights,
    offsets,
    totalHeight: offsets[24],
    gapRuns,
    collapsed,
    concurrency,
    firstEventHour: firstPopulated === -1 ? null : firstPopulated,
    // Carried on the scale so `layoutDayEvents` stays two-argument and a stack
    // can tell whether it is the thing the user expanded.
    expandedRange: expandedRange || null,
  };
}

/** Piecewise-linear position of a clock time on the elastic axis. */
export function minutesToY(scale, minutes) {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY, minutes));
  const hour = Math.min(23, Math.floor(clamped / 60));
  const withinHour = (clamped - hour * 60) / 60;
  return GRID_TOP_INSET + scale.offsets[hour] + withinHour * scale.hourHeights[hour];
}

/** Inverse of `minutesToY`. Every hour height is non-zero, so this is total. */
export function yToMinutes(scale, y) {
  const local = y - GRID_TOP_INSET;
  if (local <= 0) return 0;
  if (local >= scale.totalHeight) return MINUTES_PER_DAY;

  let hour = 0;
  while (hour < 23 && scale.offsets[hour + 1] <= local) hour += 1;
  return hour * 60 + ((local - scale.offsets[hour]) / scale.hourHeights[hour]) * 60;
}

/**
 * A cluster of three or more, rendered as one container instead of three
 * unreadable slivers.
 *
 * The trade is explicit: members lose their individual vertical extent and keep
 * only the cluster envelope, in exchange for a full-width row each. At the ~40px
 * a three-way split leaves on a 390px phone, preserving a duration nobody can
 * read the label of is the wrong half of the problem to solve.
 */
function buildStack(cluster, scale) {
  const startMinutes = Math.min(...cluster.map(i => i.span.start));
  const endMinutes = Math.max(...cluster.map(i => i.span.end));
  const fromHour = Math.floor(startMinutes / 60);
  const toHour = Math.min(23, Math.ceil(endMinutes / 60) - 1);
  const top = minutesToY(scale, startMinutes);

  const rows = cluster.map(item => ({
    event: item.event,
    start: item.span.start,
    end: item.span.end,
  }));

  // Expanding is a promise that every row becomes visible, and the envelope
  // alone cannot keep it: four events inside a 45-minute window occupy only
  // three quarters of even an expanded hour. So an expanded stack takes the
  // height its rows need and is allowed to outgrow its envelope — the one place
  // in this grid where a container is not strictly its own time extent.
  const isExpanded = !!scale.expandedRange
    && scale.expandedRange.fromHour === fromHour
    && scale.expandedRange.toHour === toHour;
  const requiredHeight = isExpanded
    ? STACK_HEADER_HEIGHT + rows.length * STACK_ROW_HEIGHT
    : 0;

  const height = Math.max(
    STACK_MIN_HEIGHT,
    minutesToY(scale, endMinutes) - top,
    requiredHeight
  );

  const bodyHeight = height - STACK_HEADER_HEIGHT;
  const capacity = Math.floor(bodyHeight / STACK_ROW_HEIGHT);
  // When not everything fits, the `+N more` row costs a slot of its own.
  const visibleCount = capacity >= rows.length
    ? rows.length
    : Math.max(1, Math.floor((bodyHeight - STACK_MORE_HEIGHT) / STACK_ROW_HEIGHT));

  return {
    kind: 'stack',
    key: `stack-${startMinutes}-${endMinutes}`,
    top,
    height,
    leftPct: 0,
    widthPct: 100,
    startMinutes,
    endMinutes,
    fromHour,
    toHour,
    rangeLabel: `${formatMinutesLabel(startMinutes)} – ${formatMinutesLabel(endMinutes)}`,
    rows,
    visibleCount,
    hiddenCount: rows.length - visibleCount,
  };
}

/**
 * Position timed events within one day column, against a supplied scale.
 *
 * Overlapping events form a maximal cluster — sorted by start, each beginning
 * before the running maximum end — and the cluster's size decides the treatment:
 * one is full width, two split the column, three or more stack.
 *
 * The scale arrives as a parameter rather than being read from a module
 * constant, which is what keeps this function pure and its geometry assertable
 * without a render.
 *
 * @returns {Array<Object>} `kind: 'block'` and `kind: 'stack'` items, mixed.
 */
export function layoutDayEvents(events, scale) {
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
    if (cluster.length >= STACK_MIN_CLUSTER) return [buildStack(cluster, scale)];

    const widthPct = 100 / cluster.length;
    return cluster.map((item, index) => {
      const top = minutesToY(scale, item.span.start);
      const height = Math.max(MIN_BLOCK_HEIGHT, minutesToY(scale, item.span.end) - top);
      return {
        kind: 'block',
        event: item.event,
        top,
        height,
        leftPct: index * widthPct,
        widthPct,
        tier: densityTier(height),
        timeRange: `${formatMinutesLabel(item.span.start)} – ${formatMinutesLabel(item.span.end)}`,
      };
    });
  });
}

/**
 * A 1px border in the category color over a ~12% wash of it.
 *
 * The earlier treatment was a 3px left rail over an 8% wash. The full border
 * returns those 3px to the text — which is the whole margin a two-way split
 * block has to work with — and reads as a more deliberate object than a
 * side-striped one.
 */
function blockStyle(color) {
  return {
    border: `1px solid ${color}B3`,
    background: `${color}1F`,
  };
}

/**
 * The 3-day time grid. Presentational — the selected date, the event window,
 * and the detail sheet all belong to `MobileCalendarTab`.
 *
 * @param {Date} selectedDate               The leftmost column.
 * @param {Object} groupedEvents            'YYYY-MM-DD' -> events for that day.
 * @param {(name: string) => string} resolveCategoryColor
 * @param {React.MutableRefObject<'x'|'y'|null>} [axisRef]  Swipe axis lock.
 */
function MobileThreeDay({
  selectedDate,
  groupedEvents,
  resolveCategoryColor,
  loading,
  error,
  onEventTap,
  onRetry,
  axisRef,
}) {
  const scrollRef = useRef(null);
  const previousScaleRef = useRef(null);
  const didInitialScrollRef = useRef(false);
  const [now, setNow] = useState(() => new Date());
  const [expanded, setExpanded] = useState(null);

  const days = useMemo(() => {
    const base = new Date(selectedDate);
    base.setHours(0, 0, 0, 0);
    return [0, 1, 2].map(offset => {
      const d = new Date(base);
      d.setDate(d.getDate() + offset);
      return d;
    });
  }, [selectedDate.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const windowKey = formatDateKey(days[0]);

  const dayColumns = useMemo(() => days.map(date => {
    const key = formatDateKey(date);
    const dayEvents = groupedEvents?.[key] || [];
    return {
      date,
      key,
      timed: dayEvents.filter(e => !e.isAllDayEvent),
      allDay: dayEvents.filter(e => e.isAllDayEvent),
    };
  }), [days, groupedEvents]);

  // An expanded range names hours in a specific window. Tagging it with the
  // window it was opened in makes "cleared when the date moves" structural —
  // there is no effect to fire late and no stale range to render for one frame.
  const expandedRange = expanded && expanded.windowKey === windowKey
    ? { fromHour: expanded.fromHour, toHour: expanded.toHour }
    : null;

  const scale = useMemo(
    () => buildTimeScale(dayColumns.map(col => col.timed), expandedRange),
    [dayColumns, expandedRange?.fromHour, expandedRange?.toHour] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const columns = useMemo(
    () => dayColumns.map(col => ({ ...col, items: layoutDayEvents(col.timed, scale) })),
    [dayColumns, scale]
  );

  const hasAllDay = columns.some(col => col.allDay.length > 0);

  const isAxisLocked = useCallback(() => axisRef?.current === 'x', [axisRef]);

  const handleEventTap = useCallback((event) => {
    // A horizontal drag that happens to end over a block stepped the day; it
    // must not also open the block.
    if (isAxisLocked()) return;
    onEventTap?.(event);
  }, [isAxisLocked, onEventTap]);

  const toggleRange = useCallback((fromHour, toHour) => {
    if (isAxisLocked()) return;
    const commit = () => setExpanded(prev => (
      prev && prev.windowKey === windowKey && prev.fromHour === fromHour && prev.toHour === toHour
        ? null
        : { windowKey, fromHour, toHour }
    ));

    // The transition is the polish, not the mechanism: without it the state
    // change simply applies, which is also the reduced-motion contract.
    // Optional all the way down: this ships inside the Teams and Outlook
    // webviews, and an absent matchMedia must mean "no transition", not a throw
    // that swallows the tap.
    const prefersReducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    if (!prefersReducedMotion && typeof document.startViewTransition === 'function') {
      // flushSync because the callback must have mutated the DOM by the time it
      // returns; React would otherwise batch the update past the snapshot.
      document.startViewTransition(() => flushSync(commit));
    } else {
      commit();
    }
  }, [isAxisLocked, windowKey]);

  // Tick the current-time indicator. Cleared on unmount so a backgrounded
  // calendar tab does not keep re-rendering.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Open on the first event of the window, once the grid actually exists (the
  // skeleton and error states return early, so the ref is null until content
  // renders). With the pre-dawn hours collapsed to ~26px there is nothing above
  // the first event worth reserving the viewport for.
  useLayoutEffect(() => {
    if (loading || error) {
      didInitialScrollRef.current = false;
      return;
    }
    if (!scrollRef.current || didInitialScrollRef.current) return;
    didInitialScrollRef.current = true;
    const hour = scale.firstEventHour ?? INITIAL_SCROLL_HOUR;
    scrollRef.current.scrollTop = minutesToY(scale, hour * 60);
  }, [loading, error, scale]);

  // A swipe changes the window, which changes the union, which changes the
  // scale — and a block at 4 PM would land somewhere else under the user's
  // finger. Re-solve the offset so the time at the top of the viewport is the
  // one that was there before. Layout effect, so it lands before paint.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const previous = previousScaleRef.current;
    previousScaleRef.current = scale;
    if (!el || !previous || previous === scale) return;
    if (!didInitialScrollRef.current) return;

    const anchorMinutes = yToMinutes(previous, el.scrollTop);
    el.scrollTop = minutesToY(scale, anchorMinutes);
  }, [scale]);

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
  const nowTop = minutesToY(scale, nowMinutes);
  const visibleHours = HOURS.filter(hour => !scale.collapsed[hour]);

  const renderBlock = (item) => {
    const { event, top, height, leftPct, widthPct, tier, timeRange } = item;
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
        onClick={() => handleEventTap(event)}
        /* The start time is rendered as text on `tall` blocks only — on a
           30-minute block the time line consumes the only line the title had.
           That makes this label the ONLY source of the time in the short and
           med tiers; do not thin it out. */
        aria-label={`${event.eventTitle || 'Untitled Event'}, ${formatTimeFromDateTimeString(event.startDateTime)}`}
      >
        <span className="mobile-three-day-block-title">
          {event.eventTitle || 'Untitled Event'}
        </span>
        {tier === 'tall' && (
          <span className="mobile-three-day-block-time">{timeRange}</span>
        )}
        {tier === 'tall' && location && (
          <span className="mobile-three-day-block-location">{location}</span>
        )}
      </button>
    );
  };

  const renderStack = (item) => {
    const isOpen = !!expandedRange
      && expandedRange.fromHour === item.fromHour
      && expandedRange.toHour === item.toHour;

    return (
      <div
        key={item.key}
        className={`mobile-three-day-stack ${isOpen ? 'expanded' : ''}`}
        style={{ top: item.top, height: item.height, left: `${item.leftPct}%`, width: `${item.widthPct}%` }}
        data-testid={`three-day-stack-${item.fromHour}`}
      >
        <button
          type="button"
          className="mobile-three-day-stack-header"
          onClick={() => toggleRange(item.fromHour, item.toHour)}
          aria-expanded={isOpen}
          aria-label={`${item.rows.length} overlapping events, ${item.rangeLabel}`}
        >
          {item.rows.length} events · {item.rangeLabel}
        </button>

        {item.rows.slice(0, item.visibleCount).map(row => {
          const color = resolveCategoryColor(row.event.categories?.[0]);
          const location = row.event.locationDisplayNames || row.event.location || '';
          const title = row.event.eventTitle || 'Untitled Event';
          return (
            <button
              key={row.event.id || row.event._id}
              type="button"
              className={`mobile-three-day-stack-row ${row.event.status === 'pending' ? 'pending' : ''}`}
              onClick={() => handleEventTap(row.event)}
              aria-label={`${title}, ${formatMinutesLabel(row.start)}`}
            >
              <span className="mobile-three-day-stack-dot" style={{ background: color }} />
              <span className="mobile-three-day-stack-text">
                <span className="mobile-three-day-stack-title">{title}</span>
                <span className="mobile-three-day-stack-meta">
                  {formatMinutesLabel(row.start)}{location ? ` · ${location}` : ''}
                </span>
              </span>
            </button>
          );
        })}

        {item.hiddenCount > 0 && (
          <button
            type="button"
            className="mobile-three-day-stack-more"
            onClick={() => toggleRange(item.fromHour, item.toHour)}
          >
            +{item.hiddenCount} more
          </button>
        )}
      </div>
    );
  };

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
                    onClick={() => handleEventTap(event)}
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
        <div className="mobile-three-day-grid" style={{ height: GRID_TOP_INSET + scale.totalHeight }}>
          <div className="mobile-three-day-gutter">
            {visibleHours.map(hour => (
              <span
                key={hour}
                className="mobile-three-day-hour-label"
                style={{ top: minutesToY(scale, hour * 60) }}
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
                {visibleHours.map(hour => (
                  <div
                    key={hour}
                    className="mobile-three-day-hourline"
                    style={{ top: minutesToY(scale, hour * 60) }}
                  />
                ))}

                {col.items.map(item => (
                  item.kind === 'stack' ? renderStack(item) : renderBlock(item)
                ))}

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

          {/* Bands span the whole grid width, not each column: a run is empty in
              every column by definition, so stating the range once is the
              honest rendering. Drawn last so the label sits over the today
              tint. */}
          {scale.gapRuns.map(run => (
            <button
              key={`gap-${run.fromHour}`}
              type="button"
              className="mobile-three-day-gap"
              style={{ top: run.top, height: run.height }}
              data-testid={`three-day-gap-${run.fromHour}`}
              onClick={() => toggleRange(run.fromHour, run.toHour)}
              aria-label={`No events ${run.label}`}
            >
              <span className="mobile-three-day-gap-label">{run.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default MobileThreeDay;
