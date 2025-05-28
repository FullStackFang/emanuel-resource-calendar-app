import React, { memo } from 'react';
import './DayEventPanel.css';

const DayEventPanel = memo(({ 
  selectedDay, 
  events, 
  onEventClick,
  formatEventTime,
  getCategoryColor,
  getLocationColor,
  groupBy,
  userTimeZone
}) => {
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
  
  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: userTimeZone
    });
  };

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
                  key={event.id}
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
                    {formatEventTime(event.start.dateTime, event.subject)}
                    {' - '}
                    {formatEventTime(event.end.dateTime, event.subject)}
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