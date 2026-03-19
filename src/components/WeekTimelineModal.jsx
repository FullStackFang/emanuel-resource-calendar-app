// src/components/WeekTimelineModal.jsx
import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import useScrollLock from '../hooks/useScrollLock';
import {
  HOUR_LABELS,
  isAllDayEvent,
  calculateOverlapLayout,
  calculateEventPosition as calcPosition,
  formatTimelineEventTime,
} from '../utils/timelineUtils';
import { RecurringIcon } from './shared/CalendarIcons';
import './WeekTimelineModal.css';

/**
 * WeekTimelineModal
 *
 * A modal that displays a read-only multi-day timeline for a specific location.
 * Shows all events for that location across multiple days in a 7-column grid with 24-hour timelines.
 *
 * @param {boolean} isOpen - Whether the modal is open
 * @param {function} onClose - Callback to close the modal
 * @param {string} locationName - Name of the location to display
 * @param {array} dateRange - Array of date strings [startDate, endDate] in YYYY-MM-DD format
 * @param {array} events - Array of calendar events for that location
 * @param {string} calendarName - Name of the calendar (optional)
 */
export default function WeekTimelineModal({
  isOpen,
  onClose,
  locationName,
  locationId,
  dateRange = [],
  events = [],
  calendarName = '',
  onQuickAdd,
  canAddEvent = false
}) {
  // Lock body scroll when modal is open (runs before paint to prevent jitter)
  useScrollLock(isOpen);

  // Close modal on ESC key
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
      return () => document.removeEventListener('keydown', handleEsc);
    }
  }, [isOpen, onClose]);


  // State for all-day event list modal
  const [showAllDayList, setShowAllDayList] = useState(null); // { date: 'dateKey', events: [] }

  // Tooltip state + ref for cursor-following tooltip
  const [tooltipInfo, setTooltipInfo] = useState(null);
  const tooltipRef = useRef(null);

  // Quick-add hover state
  const [hoverInfo, setHoverInfo] = useState(null);

  const quickAddEnabled = canAddEvent && !!onQuickAdd;

  // Format decimal hour to display string (e.g., 9.5 → "9:30 AM")
  const formatHour = (decimalHour) => {
    const hours = Math.floor(decimalHour);
    const minutes = Math.round((decimalHour - hours) * 60);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`;
  };

  // Compute snapped decimal hour from mouse Y position within grid
  const getDecimalHourFromEvent = (e, gridEl) => {
    const rect = gridEl.getBoundingClientRect();
    const rawHour = ((e.clientY - rect.top) / rect.height) * 24;
    return Math.max(0, Math.min(23.5, Math.round(rawHour * 2) / 2));
  };

  const handleGridClick = (e, dateKey) => {
    if (!quickAddEnabled) return;
    // Don't trigger on existing event blocks or all-day badges
    if (e.target.closest('.week-timeline-event-block') || e.target.closest('.week-timeline-all-day-badge')) return;
    const grid = e.currentTarget;
    const hour = getDecimalHourFromEvent(e, grid);
    onQuickAdd(locationId, dateKey, hour);
  };

  const handleGridMouseMove = (e, dateKey) => {
    if (!quickAddEnabled) return;
    if (e.target.closest('.week-timeline-event-block') || e.target.closest('.week-timeline-all-day-badge')) {
      setHoverInfo(null);
      return;
    }
    const grid = e.currentTarget;
    const hour = getDecimalHourFromEvent(e, grid);
    setHoverInfo({ dateKey, hour });
  };

  const handleGridMouseLeave = () => {
    setHoverInfo(null);
  };

  // Smart positioning via useLayoutEffect (matches SchedulingAssistant pattern)
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

  // Generate array of dates for the week
  const weekDates = useMemo(() => {
    if (!dateRange || dateRange.length !== 2) return [];

    const [startDateStr, endDateStr] = dateRange;
    const startDate = new Date(startDateStr + 'T12:00:00');
    const endDate = new Date(endDateStr + 'T12:00:00');

    const dates = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return dates;
  }, [dateRange]);

  // Helper function: Format date as YYYY-MM-DD for keys
  const formatDateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Helper function: Format date for display (e.g., "Mon 11/1")
  const formatDateHeader = (date) => {
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
    const monthDay = `${date.getMonth() + 1}/${date.getDate()}`;
    return `${dayName} ${monthDay}`;
  };

  // Helper function: Format date range for modal title
  const formatDateRange = () => {
    if (weekDates.length === 0) return '';
    if (weekDates.length === 1) {
      return weekDates[0].toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }

    const firstDate = weekDates[0];
    const lastDate = weekDates[weekDates.length - 1];

    return `${firstDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${lastDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  };

  // Group events by date, separating all-day from regular events
  const eventsByDate = useMemo(() => {
    const grouped = {};

    weekDates.forEach(date => {
      const dateStr = formatDateKey(date);
      grouped[dateStr] = {
        allDay: [],
        regular: []
      };
    });

    events.forEach(event => {
      // Use event.start.dateTime - the canonical date field
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

    return grouped;
  }, [events, weekDates]);

  // Use shared calculateEventPosition (no timezone param = browser local)
  const calculateEventPosition = (event) => calcPosition(event);

  // Use shared formatTimelineEventTime
  const formatEventTime = (event) => formatTimelineEventTime(event);

  // Handle overlay click
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Use shared hour labels constant
  const hourLabels = HOUR_LABELS;

  if (!isOpen) return null;

  return (
    <div className="week-timeline-modal-overlay" onClick={handleOverlayClick}>
      <div className="week-timeline-modal-container">
        {/* Header */}
        <div className="week-timeline-modal-header">
          <div className="week-timeline-modal-title">
            <h2>{locationName} - Timeline View</h2>
            <p className="week-timeline-modal-date">{formatDateRange()}</p>
            {calendarName && (
              <span className="week-timeline-modal-calendar-badge">{calendarName}</span>
            )}
          </div>
          <button
            type="button"
            className="week-timeline-modal-close"
            onClick={onClose}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        {/* Timeline Content */}
        <div className="week-timeline-modal-content">
          <div className="week-timeline-grid">
            {/* Time labels column */}
            <div className="week-timeline-time-column">
              <div className="week-timeline-time-header"></div>
              {hourLabels.map((label, index) => (
                <div key={index} className="week-timeline-hour-label">
                  {label}
                </div>
              ))}
            </div>

            {/* Day columns */}
            {weekDates.map((date) => {
              const dateKey = formatDateKey(date);
              const dayData = eventsByDate[dateKey] || { allDay: [], regular: [] };
              const allDayEvents = dayData.allDay;
              const regularEvents = dayData.regular;

              return (
                <div key={dateKey} className="week-timeline-day-column">
                  {/* Day header */}
                  <div className="week-timeline-day-header">
                    {formatDateHeader(date)}
                  </div>

                  {/* Timeline grid with hour lines */}
                  <div
                    className={`week-timeline-day-grid${quickAddEnabled ? ' quick-add-enabled' : ''}`}
                    onClick={(e) => handleGridClick(e, dateKey)}
                    onMouseMove={(e) => handleGridMouseMove(e, dateKey)}
                    onMouseLeave={handleGridMouseLeave}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <div key={i} className="week-timeline-hour-line"></div>
                    ))}

                    {/* Quick-add ghost indicator */}
                    {hoverInfo?.dateKey === dateKey && (
                      <div
                        className="week-timeline-quick-add-indicator"
                        style={{ top: `${(hoverInfo.hour / 24) * 100}%` }}
                      >
                        <span className="week-timeline-quick-add-label">+ {formatHour(hoverInfo.hour)}</span>
                      </div>
                    )}

                    {/* All-Day Event Overlay */}
                    {allDayEvents.length > 0 && (
                      <>
                        <div className="week-timeline-all-day-overlay"></div>
                        <div
                          className="week-timeline-all-day-badge"
                          onClick={() => setShowAllDayList({ date: dateKey, events: allDayEvents })}
                          title="Click to view all-day events"
                        >
                          All Day ({allDayEvents.length} {allDayEvents.length === 1 ? 'event' : 'events'})
                        </div>
                      </>
                    )}

                    {/* Regular Event Blocks with Overlap Detection */}
                    {regularEvents.map((event, index) => {
                      const position = calculateEventPosition(event);
                      const layout = calculateOverlapLayout(event, regularEvents);
                      const eventTitle = event.subject || event.eventTitle || 'Untitled Event';
                      const eventId = event.id || event.eventId || index;

                      return (
                        <div
                          key={eventId}
                          className={`week-timeline-event-block ${layout.hasOverlap ? 'has-overlap' : ''}`}
                          style={{
                            top: position.top,
                            height: position.height,
                            left: layout.left,
                            right: layout.right,
                            zIndex: layout.zIndex
                          }}
                          onMouseEnter={(e) => setTooltipInfo({ title: eventTitle, time: formatEventTime(event), x: e.clientX, y: e.clientY })}
                          onMouseMove={(e) => tooltipInfo && setTooltipInfo(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                          onMouseLeave={() => setTooltipInfo(null)}
                        >
                          {((event.eventType || event.graphData?.type) === 'seriesMaster' ||
                            (event.seriesMasterId || event.graphData?.seriesMasterId) ||
                            (event.recurrence || event.graphData?.recurrence)) && (
                            <div style={{
                              position: 'absolute',
                              top: '2px',
                              right: '3px',
                              color: '#444',
                              lineHeight: 1,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '2px'
                            }}>
                              <RecurringIcon size={12} />
                              {event.showOccurrenceNumbers && (
                                <span style={{
                                  fontSize: '7px', fontWeight: 700, color: '#1e40af',
                                  backgroundColor: '#dbeafe', padding: '1px 3px',
                                  borderRadius: '3px', border: '1px solid rgba(96, 165, 250, 0.5)'
                                }}>
                                  {event.occurrenceNumber}/{event.totalOccurrences}{event.isInfiniteSeries ? '\u221E' : ''}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="week-timeline-event-title">
                            {eventTitle}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* All-Day Event List Modal */}
        {showAllDayList && (
          <div
            className="week-timeline-all-day-list-overlay"
            onClick={() => setShowAllDayList(null)}
          >
            <div
              className="week-timeline-all-day-list"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="week-timeline-all-day-list-header">
                <h3>All-Day Events - {formatDateHeader(new Date(showAllDayList.date + 'T12:00:00'))}</h3>
                <button
                  type="button"
                  className="week-timeline-all-day-list-close"
                  onClick={() => setShowAllDayList(null)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="week-timeline-all-day-list-content">
                {showAllDayList.events.map((event, index) => (
                  <div key={event.id || event.eventId || index} className="week-timeline-all-day-list-item">
                    <div className="week-timeline-all-day-list-item-title">
                      {event.subject || event.eventTitle || 'Untitled Event'}
                    </div>
                    {event.location?.displayName && event.location.displayName !== 'Unspecified' && (
                      <div className="week-timeline-all-day-list-item-location">
                        📍 {event.location.displayName}
                      </div>
                    )}
                    {event.organizer?.emailAddress?.name && (
                      <div className="week-timeline-all-day-list-item-organizer">
                        👤 {event.organizer.emailAddress.name}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Cursor-following tooltip */}
        {tooltipInfo && (
          <div
            ref={tooltipRef}
            className="week-timeline-tooltip"
            style={{ position: 'fixed', zIndex: 1000, pointerEvents: 'none', top: -9999, left: -9999 }}
          >
            <div className="week-timeline-tooltip-title">{tooltipInfo.title}</div>
            <div className="week-timeline-tooltip-time">{tooltipInfo.time}</div>
          </div>
        )}

      </div>
    </div>
  );
}
