// src/components/DayTimelineModal.jsx
import React, { useState, useEffect } from 'react';
import SchedulingAssistant from './SchedulingAssistant';
import './DayTimelineModal.css';

/**
 * DayTimelineModal
 *
 * A modal that displays a read-only scheduling assistant timeline for a specific location on a specific day.
 * Shows all events for that location in a 24-hour timeline view.
 *
 * @param {boolean} isOpen - Whether the modal is open
 * @param {function} onClose - Callback to close the modal
 * @param {object} location - Location/room object
 * @param {string} date - Date string (YYYY-MM-DD format)
 * @param {array} events - Array of calendar events for that location/date
 * @param {string} calendarName - Name of the calendar (optional)
 */
export default function DayTimelineModal({
  isOpen,
  onClose,
  location,
  date,
  events = [],
  calendarName = ''
}) {
  const [quickPreview, setQuickPreview] = useState(null);

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

  if (!isOpen) return null;

  // Transform events to availability format expected by SchedulingAssistant
  const availability = location ? [{
    room: location,
    available: true,
    conflicts: {
      reservations: [],
      events: events.map(event => ({
        id: event.id || event.eventId,
        subject: event.subject || event.eventTitle || 'Untitled Event',
        start: { dateTime: event.start?.dateTime || event.startDateTime },
        end: { dateTime: event.end?.dateTime || event.endDateTime },
        organizer: {
          emailAddress: {
            name: event.organizer?.emailAddress?.name || event.requesterName || 'Unknown'
          }
        },
        location: event.location,
        bodyPreview: event.bodyPreview || event.eventDescription || ''
      }))
    }
  }] : [];

  // Handle event block clicks - show quick preview
  const handleEventClick = (eventBlock) => {
    setQuickPreview(eventBlock);
  };

  // Close quick preview
  const handleClosePreview = () => {
    setQuickPreview(null);
  };

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
          {location && (
            <SchedulingAssistant
              selectedRooms={[location]}
              selectedDate={date}
              availability={availability}
              readOnly={true}
              onEventClick={handleEventClick}
              hideRoomControls={true}
              defaultCalendar={calendarName}
            />
          )}
        </div>

        {/* Quick Preview Tooltip */}
        {quickPreview && (
          <div className="event-quick-preview-overlay" onClick={handleClosePreview}>
            <div className="event-quick-preview" onClick={(e) => e.stopPropagation()}>
              <div className="event-quick-preview-header">
                <h3>{quickPreview.title}</h3>
                <button
                  type="button"
                  className="event-quick-preview-close"
                  onClick={handleClosePreview}
                >
                  ×
                </button>
              </div>
              <div className="event-quick-preview-body">
                <div className="event-quick-preview-time">
                  <strong>Time:</strong> {quickPreview.startTime?.toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                  })} - {quickPreview.endTime?.toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                  })}
                </div>
                {quickPreview.organizer && (
                  <div className="event-quick-preview-organizer">
                    <strong>Organizer:</strong> {quickPreview.organizer}
                  </div>
                )}
                {quickPreview.room && (
                  <div className="event-quick-preview-location">
                    <strong>Location:</strong> {quickPreview.room.name}
                  </div>
                )}
                {quickPreview.status && (
                  <div className="event-quick-preview-status">
                    <strong>Status:</strong> {quickPreview.status}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
