// src/components/TimelineView.jsx
// Inline 3-day+ all-locations timeline view for "Group by Time" mode.
// Shows all events across all locations, color-coded by location, positioned by time.
import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  HOUR_LABELS,
  isAllDayEvent,
  formatDecimalHour,
  resolveEventTimeRanges,
  calculateReservationEnvelope,
  getBlockKey,
} from '../utils/timelineUtils';
import { getEventField, isRecurringEvent } from '../utils/eventTransformers';
import { RecurringIcon } from './shared/CalendarIcons';
import './TimelineView.css';

const HOUR_HEIGHT = 50;          // px per hour row
const GRID_HEIGHT = HOUR_HEIGHT * 24; // 1200px total
const DAY_COUNT = 3;             // Fixed 3-day view — wide columns for readable event blocks
// Three-line layout (title 18.2 + location 16.6 + timing-group 6 + time 12 + padding 12)
// needs ~65px vertical. Below 48 we bail out to title-only rather than clip two lines.
const COMPACT_THRESHOLD = 48;    // px — below this, show title only
// Four visible lines with grouped rhythm (title 18.2 + location 15.6 + timing-group 6 top
// margin + time 12 + 1 gap + hold 11.9 + padding 12) ≈ 77px. 76 gives a clean fit.
const EXPANDED_THRESHOLD = 76;   // px — at or above this, also show secondary (room-hold) time line

/**
 * Compute equal-width side-by-side column layout for a day's events.
 * Unlike the cascade approach (used by WeekTimelineModal), this places
 * overlapping events in adjacent columns of equal width — no event
 * obscures another.
 *
 * Overlap is detected using the **reservation envelope** (the block's visible
 * extent, including setup/teardown buffers) so adjacent blocks don't collide
 * on their buffer zones.
 *
 * Algorithm:
 * 1. Sort events by envelope start (longer envelopes first for ties)
 * 2. Find connected overlap groups (events that transitively overlap)
 * 3. Within each group, greedily assign the first available column
 * 4. Each event gets: left = (col/totalCols)%, width = (1/totalCols)%
 *
 * @param {Array} dayEvents - Regular (non-all-day) events for one day
 * @param {Map<string, {blockStart: Date, blockEnd: Date}>} envelopes -
 *   Precomputed reservation envelopes keyed by event id
 * @returns {Map<string, {left, width, zIndex, hasOverlap}>}
 */
function calculateColumnLayout(dayEvents, envelopes) {
  const result = new Map();
  if (dayEvents.length === 0) return result;

  const envOf = (ev) => envelopes.get(getBlockKey(ev));

  // Sort by envelope start, then longer envelopes first (they anchor columns),
  // then stable lexical tie-break on block key so the ordering is deterministic
  // across renders even when two events share identical time bounds.
  const sorted = [...dayEvents].sort((a, b) => {
    const aEnv = envOf(a);
    const bEnv = envOf(b);
    const aStart = aEnv.blockStart.getTime();
    const bStart = bEnv.blockStart.getTime();
    if (aStart !== bStart) return aStart - bStart;
    const aDur = aEnv.blockEnd.getTime() - aStart;
    const bDur = bEnv.blockEnd.getTime() - bStart;
    if (aDur !== bDur) return bDur - aDur;
    const aKey = getBlockKey(a);
    const bKey = getBlockKey(b);
    if (aKey < bKey) return -1;
    if (aKey > bKey) return 1;
    return 0;
  });

  // Find connected overlap groups — events that transitively overlap
  const groups = [];
  let curGroup = [sorted[0]];
  let groupEnd = envOf(sorted[0]).blockEnd.getTime();

  for (let i = 1; i < sorted.length; i++) {
    const env = envOf(sorted[i]);
    const evStart = env.blockStart.getTime();
    if (evStart < groupEnd) {
      curGroup.push(sorted[i]);
      const evEnd = env.blockEnd.getTime();
      if (evEnd > groupEnd) groupEnd = evEnd;
    } else {
      groups.push(curGroup);
      curGroup = [sorted[i]];
      groupEnd = env.blockEnd.getTime();
    }
  }
  groups.push(curGroup);

  // Assign columns within each group
  const GAP = 3; // px gap between side-by-side columns

  groups.forEach(group => {
    if (group.length === 1) {
      const id = getBlockKey(group[0]);
      result.set(id, { left: '4px', width: 'calc(100% - 8px)', zIndex: 5, hasOverlap: false });
      return;
    }

    // Greedy column assignment: each column tracks its latest envelope end time
    const colEnds = []; // colEnds[c] = end timestamp of last envelope in column c
    const eventCol = new Map();

    group.forEach(event => {
      const env = envOf(event);
      const evStart = env.blockStart.getTime();
      let col = -1;
      for (let c = 0; c < colEnds.length; c++) {
        if (evStart >= colEnds[c]) { col = c; break; }
      }
      if (col === -1) { col = colEnds.length; colEnds.push(0); }
      colEnds[col] = env.blockEnd.getTime();
      eventCol.set(getBlockKey(event), col);
    });

    const totalCols = colEnds.length;
    const colWidth = 100 / totalCols;

    group.forEach(event => {
      const id = getBlockKey(event);
      const col = eventCol.get(id);
      result.set(id, {
        left: `calc(${col * colWidth}% + ${GAP / 2}px)`,
        width: `calc(${colWidth}% - ${GAP}px)`,
        zIndex: 5 + col,
        hasOverlap: true,
      });
    });
  });

  return result;
}

/**
 * Format a Date to YYYY-MM-DD for grouping keys.
 */
const formatDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export default function TimelineView({
  days,                  // Array of Date objects (up to 7) from getDaysInRange()
  events,                // filteredEvents — already filtered by selected locations/categories
  getLocationColor,      // (locationName) => hex color
  generalLocations,      // Location objects from context (for ObjectId → name resolution)
  handleEventClick,      // (event) => opens review modal
  isUnspecifiedLocation, // (event) => boolean — matches sidebar filter logic
  formatDateHeader,      // (date) => display string (e.g., "Mon, 4/21")
  canAddEvent,           // boolean — permission gate for create button
  handleDayCellClick,    // (day, category, location) => opens creation modal
}) {
  // ── Fixed 3-day view ─────────────────────────────────────────────────
  const containerRef = useRef(null);
  const visibleDays = days.slice(0, DAY_COUNT);

  // ── Event → location resolution ─────────────────────────────────────
  const eventLocationMap = useMemo(() => {
    const map = new Map();
    const locById = new Map(generalLocations.map(l => [String(l._id), l.name]));

    events.forEach(event => {
      const id = getBlockKey(event);
      const locations = getEventField(event, 'locations', []);
      if (locations && locations.length > 0) {
        map.set(id, {
          primary: locById.get(String(locations[0])) || 'Unspecified',
          count: locations.length,
          all: locations.map(lid => locById.get(String(lid)) || 'Unknown'),
        });
      } else if (getEventField(event, 'virtualMeetingUrl')) {
        map.set(id, { primary: 'Virtual Meeting', count: 1, all: ['Virtual Meeting'] });
      } else if (isUnspecifiedLocation(event)) {
        map.set(id, { primary: 'Unspecified', count: 1, all: ['Unspecified'] });
      } else {
        map.set(id, { primary: 'Unspecified', count: 1, all: ['Unspecified'] });
      }
    });
    return map;
  }, [events, generalLocations, isUnspecifiedLocation]);

  // ── Memoized layout: group events by date + pre-compute positions ───
  const { eventsByDate, layoutCache, rangeStart, rangeEnd, rangeHours, gridHeight, visibleHourLabels } = useMemo(() => {
    const grouped = {};
    visibleDays.forEach(date => {
      grouped[formatDateKey(date)] = { allDay: [], regular: [] };
    });

    events.forEach(event => {
      if (!event.start?.dateTime) return;
      const eventStart = new Date(event.start.dateTime);
      const dateKey = formatDateKey(eventStart);
      if (grouped[dateKey]) {
        if (isAllDayEvent(event)) {
          grouped[dateKey].allDay.push(event);
        } else {
          grouped[dateKey].regular.push(event);
        }
      }
    });

    // Compute reservation envelopes once — shared by hour range, column
    // layout overlap detection, and block positioning. getBlockKey guarantees
    // a stable, always-defined map key so two events with missing ids don't
    // collide on the `undefined` bucket (which would strand one of them
    // without a column assignment and render it full-width).
    const envelopes = new Map();
    for (const { regular } of Object.values(grouped)) {
      regular.forEach(event => {
        envelopes.set(getBlockKey(event), calculateReservationEnvelope(event));
      });
    }

    // Compute visible hour range from all regular events' envelopes (±1 hour
    // padding) — use the envelope so setup/teardown buffer is visible.
    let minHour = 24;
    let maxHour = 0;
    for (const { regular } of Object.values(grouped)) {
      regular.forEach(event => {
        const env = envelopes.get(getBlockKey(event));
        const sh = env.blockStart.getHours() + env.blockStart.getMinutes() / 60;
        const eh = env.blockEnd.getHours() + env.blockEnd.getMinutes() / 60;
        if (sh < minHour) minHour = sh;
        if (eh > maxHour) maxHour = eh;
      });
    }
    // Default range if no events, and apply ±1 hour padding clamped to 0-24
    if (minHour >= maxHour) { minHour = 8; maxHour = 18; }
    const rangeStart = Math.max(0, Math.floor(minHour) - 1);
    const rangeEnd = Math.min(24, Math.ceil(maxHour) + 1);
    const rangeHours = rangeEnd - rangeStart;
    const gridHeight = rangeHours * HOUR_HEIGHT;

    // Build hour labels for visible range only
    const visibleHourLabels = [];
    for (let h = rangeStart; h < rangeEnd; h++) {
      visibleHourLabels.push({ hour: h, label: HOUR_LABELS[h] });
    }

    // Pre-compute equal-width column layout per day — O(1) lookup during render
    const layouts = {};
    for (const [dateKey, { regular }] of Object.entries(grouped)) {
      const columnMap = calculateColumnLayout(regular, envelopes);
      layouts[dateKey] = new Map();
      regular.forEach(event => {
        const id = getBlockKey(event);
        const env = envelopes.get(id);
        // Position the block using the reservation envelope (not the event time)
        const startH = env.blockStart.getHours() + env.blockStart.getMinutes() / 60;
        const endH = env.blockEnd.getHours() + env.blockEnd.getMinutes() / 60;
        const clampedStart = Math.max(startH, rangeStart);
        const clampedEnd = Math.min(endH <= startH ? rangeEnd : endH, rangeEnd);
        const top = ((clampedStart - rangeStart) / rangeHours) * 100;
        const height = Math.max(((clampedEnd - clampedStart) / rangeHours) * 100, 1.5);

        // Column layout should have an entry for every event. If it doesn't,
        // something upstream went wrong (duplicate key, bad envelope, etc.)
        // — use a packed column at the END of the cluster rather than a
        // full-width fallback so the event doesn't silently z-stack behind
        // its siblings. Warn in dev so we can catch the root cause.
        let resolvedLayout = columnMap.get(id);
        if (!resolvedLayout) {
          if (import.meta.env.DEV) {
            console.warn(
              '[TimelineView] event missing column assignment — check for ' +
              'duplicate keys or malformed envelope data',
              { key: id, event }
            );
          }
          // Packed-column fallback: treat as a narrow column on the right
          // edge so at least the event is visible and doesn't overlay
          // properly-packed siblings.
          resolvedLayout = {
            left: 'calc(75% + 1.5px)',
            width: 'calc(25% - 3px)',
            zIndex: 9,
            hasOverlap: true,
          };
        }

        layouts[dateKey].set(id, {
          position: { top: `${top}%`, height: `${height}%`, heightPx: (height / 100) * gridHeight },
          layout: resolvedLayout,
          envelope: env,
        });
      });
    }

    // Dev-mode overlap validator — after all layouts are computed, verify
    // that no two events with genuinely overlapping envelopes ended up in
    // the same column. If this fires, there's a regression in the column
    // packing algorithm.
    if (import.meta.env.DEV) {
      for (const [dateKey, { regular }] of Object.entries(grouped)) {
        const dayLayouts = layouts[dateKey];
        const seen = []; // [{ key, env, column }]
        for (const event of regular) {
          const key = getBlockKey(event);
          const entry = dayLayouts.get(key);
          if (!entry) continue;
          const column = entry.layout.left + '|' + entry.layout.width;
          const env = entry.envelope;
          for (const prior of seen) {
            if (prior.column !== column) continue;
            const overlaps =
              env.blockStart.getTime() < prior.env.blockEnd.getTime() &&
              env.blockEnd.getTime() > prior.env.blockStart.getTime();
            if (overlaps) {
              console.error(
                '[TimelineView] overlap bug: two time-overlapping events ' +
                'were assigned the same column on ' + dateKey,
                { a: prior.key, b: key, column }
              );
            }
          }
          seen.push({ key, env, column });
        }
      }
    }

    return { eventsByDate: grouped, layoutCache: layouts, rangeStart, rangeEnd, rangeHours, gridHeight, visibleHourLabels };
  }, [events, visibleDays]);

  // ── Current time indicator (updates every 30s) ──────────────────────
  const [currentTimeDecimal, setCurrentTimeDecimal] = useState(() => {
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60;
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      setCurrentTimeDecimal(now.getHours() + now.getMinutes() / 60);
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  const todayKey = formatDateKey(new Date());
  // Current time is only visible if it falls within the dynamic hour range
  const currentTimeInRange = currentTimeDecimal >= rangeStart && currentTimeDecimal <= rangeEnd;

  const scrollRef = useRef(null);

  // ── Tooltip state + smart positioning ───────────────────────────────
  const [tooltipInfo, setTooltipInfo] = useState(null);
  const tooltipRef = useRef(null);

  useLayoutEffect(() => {
    if (!tooltipRef.current || !tooltipInfo) return;
    const el = tooltipRef.current;
    const { x, y } = tooltipInfo;
    const rect = el.getBoundingClientRect();
    const offset = 12;
    el.style.top = (y + rect.height + offset > window.innerHeight)
      ? `${y - rect.height - offset}px`
      : `${y + offset}px`;
    el.style.left = (x + rect.width + offset > window.innerWidth)
      ? `${x - rect.width - offset}px`
      : `${x + offset}px`;
  }, [tooltipInfo]);

  // ── All-day event list modal ────────────────────────────────────────
  const [showAllDayList, setShowAllDayList] = useState(null);

  // ── Focus return for a11y (restore focus after modal close) ─────────
  const lastFocusedRef = useRef(null);

  // ────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────
  return (
    <div className="timeline-view-container" ref={containerRef} role="grid" aria-label="Timeline view">
      {/* Scrollable timeline grid */}
      <div className="timeline-grid" ref={scrollRef}>
        {/* Time labels column (sticky left) — only visible hours */}
        <div className="timeline-time-column">
          <div className="timeline-time-header" />
          {visibleHourLabels.map(({ hour, label }) => (
            <div key={hour} className="timeline-hour-label">
              {label}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {visibleDays.map(date => {
          const dateKey = formatDateKey(date);
          const dayData = eventsByDate[dateKey] || { allDay: [], regular: [] };
          const { allDay: allDayEvents, regular: regularEvents } = dayData;

          return (
            <div key={dateKey} className="timeline-day-column" role="column">
              {/* Sticky day header */}
              <div className="timeline-day-header">
                {formatDateHeader(date)}
              </div>

              {/* Hour grid with event blocks — dynamic height based on visible range */}
              <div className="timeline-hour-grid" style={{ height: `${gridHeight}px` }}>
                {/* Centered "+" create button — appears on hover over the day column */}
                {canAddEvent && (
                  <button
                    className="timeline-add-event-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDayCellClick(date);
                    }}
                    title="Add event"
                  >+</button>
                )}
                {/* Hour lines — only for visible range */}
                {visibleHourLabels.map(({ hour }, i) => (
                  <div
                    key={hour}
                    className={`timeline-hour-line${i % 2 === 0 ? ' even' : ''}`}
                    style={{ top: `${i * HOUR_HEIGHT}px` }}
                  />
                ))}

                {/* Current time indicator (today only, within visible range) */}
                {dateKey === todayKey && currentTimeInRange && (
                  <div
                    className="timeline-current-time"
                    style={{ top: `${((currentTimeDecimal - rangeStart) / rangeHours) * 100}%` }}
                  >
                    <span className="timeline-current-time-badge">
                      {formatDecimalHour(currentTimeDecimal)}
                    </span>
                  </div>
                )}

                {/* All-day event badge */}
                {allDayEvents.length > 0 && (
                  <>
                    <div className="timeline-all-day-overlay" />
                    <div
                      className="timeline-all-day-badge"
                      onClick={() => setShowAllDayList({ date: dateKey, events: allDayEvents })}
                      title="Click to view all-day events"
                    >
                      All Day ({allDayEvents.length} {allDayEvents.length === 1 ? 'event' : 'events'})
                    </div>
                  </>
                )}

                {/* Event blocks */}
                {regularEvents.map((event) => {
                  const eventId = getBlockKey(event);
                  const cached = layoutCache[dateKey]?.get(eventId);
                  if (!cached) return null;

                  const { position, layout, envelope } = cached;
                  const locInfo = eventLocationMap.get(eventId) || { primary: 'Unspecified', count: 1, all: ['Unspecified'] };
                  const locationColor = getLocationColor(locInfo.primary);
                  const eventTitle = event.subject || event.eventTitle || 'Untitled Event';
                  const heightPx = position.heightPx;
                  const isCompact = heightPx < COMPACT_THRESHOLD;
                  const isExpanded = heightPx >= EXPANDED_THRESHOLD;
                  const isDraft = event.status === 'draft';
                  const isPending = event.status === 'pending';
                  const isMultiLocation = locInfo.count > 1;
                  const isRecurring = isRecurringEvent(event);
                  const timeRanges = resolveEventTimeRanges(event);
                  // Separate flags per side — green start notch renders only when
                  // there's setup buffer (event starts AFTER block top), red end
                  // notch only when there's teardown buffer (event ends BEFORE
                  // block bottom). Keeps marks off the block's edge.
                  const hasSetup = envelope.eventTopPct > 0;
                  const hasTeardown = (envelope.eventTopPct + envelope.eventSpanPct) < 100;
                  // Show the room-hold line only when: we have a distinct secondary
                  // range, the block is tall enough, and the column isn't narrow (overlap).
                  // Status prefix surfaces draft/pending in the aria-label because
                  // the visible chip text is suppressed by aria-label on the parent.
                  const statusPrefix = isDraft ? 'Draft: ' : isPending ? 'Pending: ' : '';
                  const ariaLabel = timeRanges.secondary
                    ? `${statusPrefix}${eventTitle}, ${locInfo.primary}, room held ${timeRanges.secondary}, event ${timeRanges.primary}`
                    : `${statusPrefix}${eventTitle}, ${locInfo.primary}, ${timeRanges.primary}`;
                  // Background fill uses color-mix against white so the block stays
                  // OPAQUE — otherwise the TimelineView hour-row tints bleed through
                  // and compete with the buffer-zone striations. The visual result
                  // matches hexToRgba(color, 0.15) on white pixel-for-pixel, but
                  // does not let the grid behind show through.
                  // Percent ramp mirrors WeekView's alpha ramp:
                  //   8% (draft) / 12% (pending) / 15% (default).
                  const bgPercent = isDraft ? 8 : isPending ? 12 : 15;
                  const blockBg = `color-mix(in srgb, ${locationColor} ${bgPercent}%, white)`;
                  // Timeline axis already shows time of day — AM/PM in per-block
                  // labels is redundant. Strip it for display (aria-label keeps it).
                  const stripMeridian = (s) => s ? s.replace(/\s*(AM|PM)/gi, '') : s;
                  const displayTime = stripMeridian(timeRanges.primary);

                  return (
                    <div
                      key={eventId}
                      className={
                        'timeline-event-block' +
                        (isCompact ? ' compact' : '') +
                        (layout.hasOverlap ? ' has-overlap' : '') +
                        (hasSetup ? ' has-setup' : '') +
                        (hasTeardown ? ' has-teardown' : '') +
                        (isDraft ? ' draft' : '') +
                        (isPending ? ' pending' : '')
                      }
                      style={{
                        top: position.top,
                        height: position.height,
                        left: layout.left,
                        width: layout.width,
                        zIndex: layout.zIndex,
                        // CSS consumes these custom properties: --loc-color for the
                        // 1px outline, --block-bg for the rgba fill, --event-top /
                        // --event-span for positioning the buffer-zone striations.
                        '--loc-color': locationColor,
                        '--block-bg': blockBg,
                        '--event-top': `${envelope.eventTopPct}%`,
                        '--event-span': `${envelope.eventSpanPct}%`,
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={ariaLabel}
                      onClick={(e) => {
                        lastFocusedRef.current = document.activeElement;
                        handleEventClick(event, e);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          lastFocusedRef.current = e.currentTarget;
                          handleEventClick(event, e);
                        }
                      }}
                      onMouseEnter={(e) => setTooltipInfo({
                        title: eventTitle,
                        time: timeRanges.primary,
                        timeHold: timeRanges.secondary,
                        location: locInfo.primary,
                        allLocations: isMultiLocation ? locInfo.all.join(', ') : null,
                        x: e.clientX, y: e.clientY,
                      })}
                      onMouseMove={(e) => tooltipInfo && setTooltipInfo(prev =>
                        prev ? { ...prev, x: e.clientX, y: e.clientY } : null
                      )}
                      onMouseLeave={() => setTooltipInfo(null)}
                    >
                      {/* Status chip — occupies the top-right corner slot in
                          expanded mode only. Compact mode conveys status via
                          border color alone. Exactly one chip per block. */}
                      {!isCompact && isDraft && (
                        <span className="timeline-event-chip chip-draft">Draft</span>
                      )}
                      {!isCompact && isPending && !isDraft && (
                        <span className="timeline-event-chip chip-pending">Pending</span>
                      )}

                      <div className="timeline-event-title">
                        {isRecurring && (
                          <span className="timeline-event-recurring" aria-hidden="true">
                            <RecurringIcon size={11} />
                          </span>
                        )}
                        <span className="timeline-event-title-text">{eventTitle}</span>
                      </div>

                      {!isCompact && (
                        <>
                          <div className="timeline-event-location">{locInfo.primary}</div>
                          {isMultiLocation && (
                            <div
                              className="timeline-event-multi-loc"
                              title={locInfo.all.join(', ')}
                            >
                              + {locInfo.count - 1} more
                            </div>
                          )}
                          {/* Event time sits centered at the bottom. AM/PM stripped
                              (timeline axis carries time-of-day context). Hold range
                              removed — the block's visible top and bottom already
                              show the full room-hold window. */}
                          <div className="timeline-event-time">{displayTime}</div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Cursor-following tooltip — portaled to <body> so it escapes the
          .calendar-grid `transform: scale(...)` ancestor in Calendar.jsx.
          A non-`none` transform on any ancestor turns that ancestor into the
          containing block for `position: fixed` descendants, which would
          otherwise displace the tooltip and scale it with the calendar zoom. */}
      {tooltipInfo && createPortal(
        <div
          ref={tooltipRef}
          className="timeline-tooltip"
          style={{ position: 'fixed', zIndex: 1000, pointerEvents: 'none', top: -9999, left: -9999 }}
        >
          <div className="timeline-tooltip-title">{tooltipInfo.title}</div>
          <div className="timeline-tooltip-time">{tooltipInfo.time}</div>
          {tooltipInfo.timeHold && (
            <div className="timeline-tooltip-hold">
              <span className="timeline-tooltip-hold-label">Room held</span>
              {tooltipInfo.timeHold}
            </div>
          )}
          <div className="timeline-tooltip-location">{tooltipInfo.location}</div>
          {tooltipInfo.allLocations && (
            <div className="timeline-tooltip-multi">All locations: {tooltipInfo.allLocations}</div>
          )}
        </div>,
        document.body
      )}

      {/* All-day event list modal */}
      {showAllDayList && (
        <div
          className="timeline-all-day-list-overlay"
          onClick={() => setShowAllDayList(null)}
        >
          <div
            className="timeline-all-day-list"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="timeline-all-day-list-header">
              <h3>All-Day Events - {new Date(showAllDayList.date + 'T12:00:00').toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric'
              })}</h3>
              <button
                type="button"
                className="timeline-all-day-list-close"
                onClick={() => setShowAllDayList(null)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <div className="timeline-all-day-list-content">
              {showAllDayList.events.map((event) => {
                const eventId = getBlockKey(event);
                const locInfo = eventLocationMap.get(eventId) || { primary: 'Unspecified' };
                return (
                  <div
                    key={eventId}
                    className="timeline-all-day-list-item"
                    role="button"
                    tabIndex={0}
                    onClick={(e) => handleEventClick(event, e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleEventClick(event, e);
                      }
                    }}
                  >
                    <span
                      className="timeline-all-day-list-dot"
                      style={{ backgroundColor: getLocationColor(locInfo.primary) }}
                    />
                    <div className="timeline-all-day-list-item-title">
                      {event.subject || event.eventTitle || 'Untitled Event'}
                    </div>
                    <div className="timeline-all-day-list-item-location">
                      {locInfo.primary}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
