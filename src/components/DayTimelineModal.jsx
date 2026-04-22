// src/components/DayTimelineModal.jsx
import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import useScrollLock from '../hooks/useScrollLock';
import {
  HOUR_LABELS,
  isAllDayEvent,
  calculateOverlapLayout,
  calculateEventPosition,
  formatTimelineEventTime,
  formatDecimalHour,
  getDecimalHourFromMouseEvent,
} from '../utils/timelineUtils';
import { RecurringIcon } from './shared/CalendarIcons';
import { isRecurringEvent } from '../utils/eventTransformers';
import './DayTimelineModal.css';

/**
 * DayTimelineModal
 *
 * A modal that displays a 24-hour timeline for a specific location on a specific day.
 * Supports click-to-create with a green time indicator on hover (30-min increments),
 * matching the behavior of WeekTimelineModal.
 */
export default function DayTimelineModal({
  isOpen,
  onClose,
  location,
  date,
  events = [],
  calendarName = '',
  onQuickAdd,
  canAddEvent = false,
  locationId
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

  const [showAllDayList, setShowAllDayList] = useState(false);

  // Tooltip state + ref for cursor-following tooltip
  const [tooltipInfo, setTooltipInfo] = useState(null);
  const tooltipRef = useRef(null);

  // Quick-add hover state
  const [hoverInfo, setHoverInfo] = useState(null);

  const quickAddEnabled = canAddEvent && !!onQuickAdd;

  const handleGridClick = (e) => {
    if (!quickAddEnabled) return;
    if (e.target.closest('.day-timeline-event-block') || e.target.closest('.day-timeline-all-day-badge')) return;
    const hour = getDecimalHourFromMouseEvent(e, e.currentTarget);
    onQuickAdd(locationId, date, hour);
  };

  const handleGridMouseMove = (e) => {
    if (!quickAddEnabled) return;
    if (e.target.closest('.day-timeline-event-block') || e.target.closest('.day-timeline-all-day-badge')) {
      if (hoverInfo !== null) setHoverInfo(null);
      return;
    }
    const hour = getDecimalHourFromMouseEvent(e, e.currentTarget);
    setHoverInfo(prev => (prev?.hour === hour ? prev : { hour }));
  };

  const handleGridMouseLeave = () => {
    setHoverInfo(null);
  };

  // Smart tooltip positioning via useLayoutEffect (matches WeekTimelineModal pattern)
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

  // Split events and pre-compute layouts (avoids O(N^2) recomputation on hover re-renders)
  const { allDayEvents, regularEvents, overlapLayouts } = useMemo(() => {
    const allDay = [];
    const regular = [];
    events.forEach(event => {
      if (isAllDayEvent(event)) {
        allDay.push(event);
      } else {
        regular.push(event);
      }
    });
    const layouts = new Map();
    regular.forEach(event => {
      layouts.set(event.id || event.eventId, calculateOverlapLayout(event, regular));
    });
    return { allDayEvents: allDay, regularEvents: regular, overlapLayouts: layouts };
  }, [events]);

  // Handle overlay click
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Format date for display
  const formattedDate = date ? new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) : '';

  if (!isOpen) return null;

  return (
    <div className="day-timeline-modal-overlay" onClick={handleOverlayClick}>
      <div className="day-timeline-modal-container">
        {/* Header */}
        <div className="day-timeline-modal-header">
          <div className="day-timeline-modal-title">
            <h2>{location?.name || 'Location'} - Timeline View</h2>
            <p className="day-timeline-modal-date">{formattedDate}</p>
            {calendarName && (
              <span className="day-timeline-modal-calendar-badge">{calendarName}</span>
            )}
          </div>
          <button
            type="button"
            className="day-timeline-modal-close"
            onClick={onClose}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        {/* Timeline Content */}
        <div className="day-timeline-modal-content">
          <div className="day-timeline-grid">
            {/* Time labels column */}
            <div className="day-timeline-time-column">
              <div className="day-timeline-time-header"></div>
              {HOUR_LABELS.map((label, index) => (
                <div key={index} className="day-timeline-hour-label">
                  {label}
                </div>
              ))}
            </div>

            {/* Single day grid column */}
            <div
              className={`day-timeline-day-grid${quickAddEnabled ? ' quick-add-enabled' : ''}`}
              onClick={handleGridClick}
              onMouseMove={handleGridMouseMove}
              onMouseLeave={handleGridMouseLeave}
            >
              {Array.from({ length: 24 }, (_, i) => (
                <div key={i} className="day-timeline-hour-line"></div>
              ))}

              {/* Quick-add ghost indicator */}
              {hoverInfo && (
                <div
                  className="day-timeline-quick-add-indicator"
                  style={{ top: `${(hoverInfo.hour / 24) * 100}%` }}
                >
                  <span className="day-timeline-quick-add-label">+ {formatDecimalHour(hoverInfo.hour)}</span>
                </div>
              )}

              {/* All-Day Event Overlay */}
              {allDayEvents.length > 0 && (
                <>
                  <div className="day-timeline-all-day-overlay"></div>
                  <div
                    className="day-timeline-all-day-badge"
                    onClick={() => setShowAllDayList(true)}
                    title="Click to view all-day events"
                  >
                    All Day ({allDayEvents.length} {allDayEvents.length === 1 ? 'event' : 'events'})
                  </div>
                </>
              )}

              {/* Regular Event Blocks with Overlap Detection */}
              {regularEvents.map((event, index) => {
                const position = calculateEventPosition(event);
                const eventId = event.id || event.eventId || index;
                const layout = overlapLayouts.get(event.id || event.eventId) || { left: '4px', right: '4px', zIndex: 5 };
                const eventTitle = event.subject || event.eventTitle || 'Untitled Event';
                const organizerName = event.organizer?.emailAddress?.name
                  || event.roomReservationData?.requestedBy?.name
                  || '';

                return (
                  <div
                    key={eventId}
                    className={`day-timeline-event-block ${layout.hasOverlap ? 'has-overlap' : ''}`}
                    style={{
                      top: position.top,
                      height: position.height,
                      left: layout.left,
                      right: layout.right,
                      zIndex: layout.zIndex
                    }}
                    onMouseEnter={(e) => setTooltipInfo({
                      title: eventTitle,
                      time: formatTimelineEventTime(event),
                      organizer: organizerName,
                      x: e.clientX,
                      y: e.clientY
                    })}
                    onMouseMove={(e) => tooltipInfo && setTooltipInfo(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                    onMouseLeave={() => setTooltipInfo(null)}
                  >
                    {isRecurringEvent(event) && (
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
                    <div className="day-timeline-event-title">
                      {eventTitle}
                    </div>
                    <div className="day-timeline-event-time">
                      {formatTimelineEventTime(event)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* All-Day Event List Modal */}
        {showAllDayList && (
          <div
            className="day-timeline-all-day-list-overlay"
            onClick={() => setShowAllDayList(false)}
          >
            <div
              className="day-timeline-all-day-list"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="day-timeline-all-day-list-header">
                <h3>All-Day Events - {formattedDate}</h3>
                <button
                  type="button"
                  className="day-timeline-all-day-list-close"
                  onClick={() => setShowAllDayList(false)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="day-timeline-all-day-list-content">
                {allDayEvents.map((event, index) => (
                  <div key={event.id || event.eventId || index} className="day-timeline-all-day-list-item">
                    <div className="day-timeline-all-day-list-item-title">
                      {event.subject || event.eventTitle || 'Untitled Event'}
                    </div>
                    {event.location?.displayName && event.location.displayName !== 'Unspecified' && (
                      <div className="day-timeline-all-day-list-item-location">
                        {event.location.displayName}
                      </div>
                    )}
                    {event.organizer?.emailAddress?.name && (
                      <div className="day-timeline-all-day-list-item-organizer">
                        {event.organizer.emailAddress.name}
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
            className="day-timeline-tooltip"
            style={{ position: 'fixed', zIndex: 1000, pointerEvents: 'none', top: -9999, left: -9999 }}
          >
            <div className="day-timeline-tooltip-title">{tooltipInfo.title}</div>
            <div className="day-timeline-tooltip-time">{tooltipInfo.time}</div>
            {tooltipInfo.organizer && (
              <div className="day-timeline-tooltip-organizer">{tooltipInfo.organizer}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
