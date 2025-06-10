import React, { memo, useCallback } from 'react';
import { useTimezone } from '../context/TimezoneContext';
import { formatDateTimeWithTimezone } from '../utils/timezoneUtils';
import './DayEventPanel.css';

const DayEventPanel = memo(({ 
  selectedDay, 
  events, 
  onEventClick,
  formatEventTime,
  getCategoryColor,
  getLocationColor,
  groupBy
}) => {
  // USE TIMEZONE CONTEXT INSTEAD OF PROP
  const { userTimezone } = useTimezone();
  
  // ALL HOOKS MUST BE AT THE TOP - BEFORE ANY EARLY RETURNS
  
  // Create timezone-aware event time formatter
  const formatEventTimeWithContext = useCallback((dateTimeString, eventSubject) => {
    try {
      // Use the timezone context for consistent formatting
      return formatDateTimeWithTimezone(dateTimeString, userTimezone);
    } catch (error) {
      console.error('Error formatting event time in DayEventPanel:', error);
      // Fallback to original formatter if available
      if (formatEventTime && typeof formatEventTime === 'function') {
        return formatEventTime(dateTimeString, eventSubject);
      }
      return 'Time unavailable';
    }
  }, [userTimezone, formatEventTime]);

  const formatDate = useCallback((date) => {
    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: userTimezone // Use context timezone
    });
  }, [userTimezone]);

  // EARLY RETURN AFTER ALL HOOKS
  if (!selectedDay) {
    return (
      <div className="day-event-panel">
        <div className="panel-empty-state">
          <p>Select a day to view events</p>
        </div>
      </div>
    );
  }

  const dayEvents = events || [];

  return (
    <div className="day-event-panel">
      <div className="panel-header">
        <h3>{formatDate(selectedDay)}</h3>
        <div className="event-count">
          {dayEvents.length} {dayEvents.length === 1 ? 'event' : 'events'}
        </div>
      </div>
      
      <div className="panel-content">
        {dayEvents.length === 0 ? (
          <div className="no-events">
            <p>No events scheduled for this day</p>
          </div>
        ) : (
          <div className="events-list">
            {dayEvents
              .sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime))
              .map(event => (
                <div 
                  key={`${event.id}-${userTimezone}`} // Include timezone in key to force re-render
                  className="panel-event-item"
                  onClick={(e) => onEventClick(event, e)}
                  style={{
                    borderLeft: `4px solid ${
                      groupBy === 'categories' 
                        ? getCategoryColor(event.category) 
                        : getLocationColor(event.location?.displayName || 'Unspecified')
                    }`
                  }}
                >
                  <div className="event-time">
                    {formatEventTimeWithContext(event.start.dateTime, event.subject)}
                    {' - '}
                    {formatEventTimeWithContext(event.end.dateTime, event.subject)}
                  </div>
                  
                  <div className="event-subject">{event.subject}</div>
                  
                  {event.location?.displayName && (
                    <div className="event-detail">
                      <span className="detail-icon">📍</span>
                      {event.location.displayName}
                    </div>
                  )}
                  
                  <div className="event-detail">
                    <span className="detail-icon">🏷️</span>
                    {event.category || 'Uncategorized'}
                  </div>
                  
                  {event.calendarName && (
                    <div className="event-detail calendar-name">
                      <span className="detail-icon">📅</span>
                      {event.calendarName}
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
});

export default DayEventPanel;