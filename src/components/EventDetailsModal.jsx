import React from 'react';
import './EventDetailsModal.css';

const EventDetailsModal = ({ isOpen, onClose, events, title, migrationConfig }) => {
  if (!isOpen) return null;

  const formatDateTime = (dateTimeString) => {
    const date = new Date(dateTimeString);
    const dateStr = date.toLocaleDateString();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return { dateStr, timeStr };
  };

  const formatEndTime = (dateTimeString) => {
    const date = new Date(dateTimeString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="event-details-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-summary">
          <div className="summary-item">
            <strong>{events.length}</strong> events found
          </div>
          <div className="summary-item">
            <strong>Date Range:</strong> {migrationConfig.startDate} to {migrationConfig.endDate}
          </div>
          <div className="summary-item">
            <strong>Selected Calendars:</strong> {migrationConfig.calendarIds.length}
          </div>
        </div>

        <div className="modal-content">
          {events.length === 0 ? (
            <div className="no-events">
              <p>✅ No events found in this category</p>
            </div>
          ) : (
            <div className="events-list">
              {events.map((event, index) => {
                const startTime = formatDateTime(event.startDateTime);
                const endTime = formatEndTime(event.endDateTime);
                
                return (
                  <div key={index} className="event-card">
                    <div className="event-header">
                      <h3 className="event-title">
                        {event.subject || 'No Title'}
                      </h3>
                      <div className="event-number">#{index + 1}</div>
                    </div>
                    
                    <div className="event-details">
                      <div className="event-time">
                        📅 {startTime.dateStr} at {startTime.timeStr} - {endTime}
                      </div>
                      
                      {event.organizer && (
                        <div className="event-organizer">
                          👤 <strong>Organizer:</strong> {event.organizer}
                        </div>
                      )}
                      
                      {event.location && (
                        <div className="event-location">
                          📍 <strong>Location:</strong> {event.location}
                        </div>
                      )}
                      
                      {event.categories && (
                        <div className="event-categories">
                          🏷️ <strong>Categories:</strong> {event.categories}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="close-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default EventDetailsModal;