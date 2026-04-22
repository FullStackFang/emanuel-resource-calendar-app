// src/components/TimelineView.jsx
// Inline 3-day+ all-locations timeline view for "Group by Time" mode.
// Shows all events across all locations, color-coded by location, positioned by time.
import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  HOUR_LABELS,
  isAllDayEvent,
  calculateEventPosition as calcPosition,
  formatTimelineEventTime,
  formatDecimalHour,
} from '../utils/timelineUtils';
import { getEventField, isRecurringEvent } from '../utils/eventTransformers';
import { RecurringIcon } from './shared/CalendarIcons';
import './TimelineView.css';

const HOUR_HEIGHT = 50;          // px per hour row
const GRID_HEIGHT = HOUR_HEIGHT * 24; // 1200px total
const DAY_COUNT = 3;             // Fixed 3-day view — wide columns for readable event blocks
const COMPACT_THRESHOLD = 40;    // px — below this, show title only

/**
 * Compute equal-width side-by-side column layout for a day's events.
 * Unlike the cascade approach (used by WeekTimelineModal), this places
 * overlapping events in adjacent columns of equal width — no event
 * obscures another.
 *
 * Algorithm:
 * 1. Sort events by start time (longer events first for ties)
 * 2. Find connected overlap groups (events that transitively overlap)
 * 3. Within each group, greedily assign the first available column
 * 4. Each event gets: left = (col/totalCols)%, width = (1/totalCols)%
 *
 * @param {Array} dayEvents - Regular (non-all-day) events for one day
 * @returns {Map<string, {left, width, zIndex, hasOverlap}>}
 */
function calculateColumnLayout(dayEvents) {
  const result = new Map();
  if (dayEvents.length === 0) return result;

  // Sort by start time, then longer events first (they anchor columns)
  const sorted = [...dayEvents].sort((a, b) => {
    const aStart = new Date(a.start.dateTime).getTime();
    const bStart = new Date(b.start.dateTime).getTime();
    if (aStart !== bStart) return aStart - bStart;
    const aDur = new Date(a.end.dateTime).getTime() - aStart;
    const bDur = new Date(b.end.dateTime).getTime() - bStart;
    return bDur - aDur;
  });

  // Find connected overlap groups — events that transitively overlap
  const groups = [];
  let curGroup = [sorted[0]];
  let groupEnd = new Date(sorted[0].end.dateTime).getTime();

  for (let i = 1; i < sorted.length; i++) {
    const evStart = new Date(sorted[i].start.dateTime).getTime();
    if (evStart < groupEnd) {
      curGroup.push(sorted[i]);
      const evEnd = new Date(sorted[i].end.dateTime).getTime();
      if (evEnd > groupEnd) groupEnd = evEnd;
    } else {
      groups.push(curGroup);
      curGroup = [sorted[i]];
      groupEnd = new Date(sorted[i].end.dateTime).getTime();
    }
  }
  groups.push(curGroup);

  // Assign columns within each group
  const GAP = 3; // px gap between side-by-side columns

  groups.forEach(group => {
    if (group.length === 1) {
      const id = group[0].id || group[0].eventId;
      result.set(id, { left: '4px', width: 'calc(100% - 8px)', zIndex: 5, hasOverlap: false });
      return;
    }

    // Greedy column assignment: each column tracks its latest end time
    const colEnds = []; // colEnds[c] = end timestamp of last event in column c
    const eventCol = new Map();

    group.forEach(event => {
      const evStart = new Date(event.start.dateTime).getTime();
      let col = -1;
      for (let c = 0; c < colEnds.length; c++) {
        if (evStart >= colEnds[c]) { col = c; break; }
      }
      if (col === -1) { col = colEnds.length; colEnds.push(0); }
      colEnds[col] = new Date(event.end.dateTime).getTime();
      eventCol.set(event.id || event.eventId, col);
    });

    const totalCols = colEnds.length;
    const colWidth = 100 / totalCols;

    group.forEach(event => {
      const id = event.id || event.eventId;
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
      const id = event.id || event.eventId;
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

    // Compute visible hour range from all regular events (±1 hour padding)
    let minHour = 24;
    let maxHour = 0;
    for (const { regular } of Object.values(grouped)) {
      regular.forEach(event => {
        const s = new Date(event.start.dateTime);
        const e = new Date(event.end.dateTime);
        const sh = s.getHours() + s.getMinutes() / 60;
        const eh = e.getHours() + e.getMinutes() / 60;
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
      const columnMap = calculateColumnLayout(regular);
      layouts[dateKey] = new Map();
      regular.forEach(event => {
        const id = event.id || event.eventId;
        // Position relative to visible range (not full 24h)
        const start = new Date(event.start.dateTime);
        const end = new Date(event.end.dateTime);
        const startH = start.getHours() + start.getMinutes() / 60;
        const endH = end.getHours() + end.getMinutes() / 60;
        const clampedStart = Math.max(startH, rangeStart);
        const clampedEnd = Math.min(endH <= startH ? rangeEnd : endH, rangeEnd);
        const top = ((clampedStart - rangeStart) / rangeHours) * 100;
        const height = Math.max(((clampedEnd - clampedStart) / rangeHours) * 100, 1.5);

        layouts[dateKey].set(id, {
          position: { top: `${top}%`, height: `${height}%`, heightPx: (height / 100) * gridHeight },
          layout: columnMap.get(id) || { left: '4px', width: 'calc(100% - 8px)', zIndex: 5, hasOverlap: false },
        });
      });
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
                  const eventId = event.id || event.eventId;
                  const cached = layoutCache[dateKey]?.get(eventId);
                  if (!cached) return null;

                  const { position, layout } = cached;
                  const locInfo = eventLocationMap.get(eventId) || { primary: 'Unspecified', count: 1, all: ['Unspecified'] };
                  const locationColor = getLocationColor(locInfo.primary);
                  const eventTitle = event.subject || event.eventTitle || 'Untitled Event';
                  const heightPx = position.heightPx;
                  const isCompact = heightPx < COMPACT_THRESHOLD;
                  const isDraft = event.status === 'draft';
                  const isPending = event.status === 'pending';
                  const isMultiLocation = locInfo.count > 1;
                  const isRecurring = isRecurringEvent(event);

                  return (
                    <div
                      key={eventId}
                      className={
                        'timeline-event-block' +
                        (isCompact ? ' compact' : '') +
                        (layout.hasOverlap ? ' has-overlap' : '') +
                        (isDraft ? ' draft' : '') +
                        (isPending ? ' pending' : '')
                      }
                      style={{
                        top: position.top,
                        height: position.height,
                        left: layout.left,
                        width: layout.width,
                        zIndex: layout.zIndex,
                        backgroundColor: `color-mix(in srgb, ${locationColor} 80%, #1a1a2e)`,
                        borderLeftColor: locationColor,
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${eventTitle}, ${locInfo.primary}, ${formatTimelineEventTime(event)}`}
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
                        time: formatTimelineEventTime(event),
                        location: locInfo.primary,
                        allLocations: isMultiLocation ? locInfo.all.join(', ') : null,
                        x: e.clientX, y: e.clientY,
                      })}
                      onMouseMove={(e) => tooltipInfo && setTooltipInfo(prev =>
                        prev ? { ...prev, x: e.clientX, y: e.clientY } : null
                      )}
                      onMouseLeave={() => setTooltipInfo(null)}
                    >
                      {/* Recurring indicator */}
                      {isRecurring && (
                        <span className="timeline-event-recurring">
                          <RecurringIcon size={11} />
                        </span>
                      )}

                      <div className="timeline-event-title">{eventTitle}</div>

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
                          <div className="timeline-event-time">
                            {formatTimelineEventTime(event)}
                          </div>
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

      {/* Cursor-following tooltip */}
      {tooltipInfo && (
        <div
          ref={tooltipRef}
          className="timeline-tooltip"
          style={{ position: 'fixed', zIndex: 1000, pointerEvents: 'none', top: -9999, left: -9999 }}
        >
          <div className="timeline-tooltip-title">{tooltipInfo.title}</div>
          <div className="timeline-tooltip-time">{tooltipInfo.time}</div>
          <div className="timeline-tooltip-location">{tooltipInfo.location}</div>
          {tooltipInfo.allLocations && (
            <div className="timeline-tooltip-multi">All locations: {tooltipInfo.allLocations}</div>
          )}
        </div>
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
              {showAllDayList.events.map((event, index) => {
                const eventId = event.id || event.eventId || index;
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
