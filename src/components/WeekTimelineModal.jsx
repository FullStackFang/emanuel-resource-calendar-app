// src/components/WeekTimelineModal.jsx
import React, { useState, useEffect, useMemo } from 'react';
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
  dateRange = [],
  events = [],
  calendarName = ''
}) {
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

  // Prevent background scrolling when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // State for all-day event list modal
  const [showAllDayList, setShowAllDayList] = useState(null); // { date: 'dateKey', events: [] }

  // Helper function: Check if event is all-day (>= 23 hours)
  const isAllDayEvent = (event) => {
    const start = new Date(event.start?.dateTime || event.startDateTime);
    const end = new Date(event.end?.dateTime || event.endDateTime);
    const durationHours = (end - start) / (1000 * 60 * 60);
    return durationHours >= 23;
  };

  // Helper function: Calculate overlap-aware positioning for staggered layout
  const calculateOverlapLayout = (event, dayEvents) => {
    // Find all events that overlap with this one
    const overlapping = dayEvents.filter(other => {
      if (other.id === event.id || other.eventId === event.eventId) return false;

      const otherStart = new Date(other.start?.dateTime || other.startDateTime);
      const otherEnd = new Date(other.end?.dateTime || other.endDateTime);
      const eventStart = new Date(event.start?.dateTime || event.startDateTime);
      const eventEnd = new Date(event.end?.dateTime || event.endDateTime);

      return eventStart < otherEnd && eventEnd > otherStart;
    });

    if (overlapping.length === 0) {
      return { left: '4px', right: '4px', zIndex: 5 };
    }

    // Sort group by start time
    const group = [event, ...overlapping].sort((a, b) => {
      const aStart = new Date(a.start?.dateTime || a.startDateTime);
      const bStart = new Date(b.start?.dateTime || b.startDateTime);
      return aStart - bStart;
    });

    const index = group.findIndex(e =>
      (e.id && e.id === event.id) || (e.eventId && e.eventId === event.eventId)
    );
    const totalInGroup = group.length;

    // Stagger: 4px offset per layer, max 4 layers before recycling
    const offset = (index % 4) * 4;
    const maxOffset = (Math.min(totalInGroup - 1, 3)) * 4;

    return {
      left: `${4 + offset}px`,
      right: `${4 + (maxOffset - offset)}px`,
      zIndex: 5 + index,
      hasOverlap: true
    };
  };

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
      const eventStart = new Date(event.start?.dateTime || event.startDateTime);
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

  // Calculate event block position and height
  const calculateEventPosition = (event) => {
    const start = new Date(event.start?.dateTime || event.startDateTime);
    const end = new Date(event.end?.dateTime || event.endDateTime);

    const startHour = start.getHours() + start.getMinutes() / 60;
    const endHour = end.getHours() + end.getMinutes() / 60;

    const top = (startHour / 24) * 100; // percentage from top
    const height = ((endHour - startHour) / 24) * 100; // percentage height

    return { top: `${top}%`, height: `${Math.max(height, 2)}%` }; // minimum 2% height
  };

  // Format time for event display
  const formatEventTime = (event) => {
    const start = new Date(event.start?.dateTime || event.startDateTime);
    const end = new Date(event.end?.dateTime || event.endDateTime);

    const formatTime = (date) => {
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    };

    return `${formatTime(start)} - ${formatTime(end)}`;
  };

  // Handle overlay click
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Generate hour labels (0-23)
  const hourLabels = Array.from({ length: 24 }, (_, i) => {
    const hour = i % 12 === 0 ? 12 : i % 12;
    const period = i < 12 ? 'AM' : 'PM';
    return `${hour} ${period}`;
  });

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
                  <div className="week-timeline-day-grid">
                    {Array.from({ length: 24 }, (_, i) => (
                      <div key={i} className="week-timeline-hour-line"></div>
                    ))}

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
                        >
                          <div className="week-timeline-event-title">
                            {eventTitle}
                          </div>
                          <div className="week-timeline-event-time">
                            {formatEventTime(event)}
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
                    {event.location?.displayName && (
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

      </div>
    </div>
  );
}
