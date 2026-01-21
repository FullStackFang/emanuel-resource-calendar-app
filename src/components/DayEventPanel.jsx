import React, { memo, useCallback } from 'react';
import { useTimezone } from '../context/TimezoneContext';
import { usePermissions } from '../hooks/usePermissions';
import { formatDateTimeWithTimezone } from '../utils/timezoneUtils';
import { sortEventsByStartTime } from '../utils/eventTransformers';
import './DayEventPanel.css';

const DayEventPanel = memo(({
  selectedDay,
  events,
  onEventClick,
  onEventEdit,
  onEventDelete,
  onRequestEdit,
  formatEventTime,
  getCategoryColor,
  getLocationColor,
  groupBy
}) => {
  // USE TIMEZONE CONTEXT INSTEAD OF PROP
  const { userTimezone } = useTimezone();

  // Get permissions for role simulation
  const { canEditEvents, canDeleteEvents, canSubmitReservation } = usePermissions();

  // ALL HOOKS MUST BE AT THE TOP - BEFORE ANY EARLY RETURNS

  // Create timezone-aware event time formatter
  const formatEventTimeWithContext = useCallback((dateTimeString, eventSubject, sourceTimezone) => {
    try {
      // Use formatEventTime for proper time-only display with timezone conversion
      // Pass source timezone for correct interpretation of non-UTC times
      if (formatEventTime && typeof formatEventTime === 'function') {
        return formatEventTime(dateTimeString, userTimezone, eventSubject, sourceTimezone);
      }
      // Fallback: use formatDateTimeWithTimezone if formatEventTime not available
      return formatDateTimeWithTimezone(dateTimeString, userTimezone);
    } catch (error) {
      console.error('Error formatting event time in DayEventPanel:', error);
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

  // Check if a location is a virtual meeting URL
  const isVirtualLocation = useCallback((locationString) => {
    if (!locationString) return false;
    try {
      new URL(locationString);
      return true;
    } catch {
      return /^https?:\/\//i.test(locationString) ||
             /zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com/i.test(locationString);
    }
  }, []);

  // Get the virtual platform name
  const getVirtualPlatform = useCallback((locationString) => {
    if (!locationString) return null;
    const lower = locationString.toLowerCase();
    if (lower.includes('zoom')) return 'Zoom';
    if (lower.includes('teams')) return 'Teams';
    if (lower.includes('meet.google')) return 'Google Meet';
    if (lower.includes('webex')) return 'Webex';
    return 'Virtual';
  }, []);

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
            {sortEventsByStartTime(dayEvents)
              .map(event => {
                const isPending = event.status === 'pending';
                const hasPendingEditRequest = event.pendingEditRequest?.status === 'pending';
                // Get primary category for color
                const eventCategories = event.categories || event.graphData?.categories || (event.category ? [event.category] : ['Uncategorized']);
                const primaryCategory = eventCategories[0] || 'Uncategorized';
                const borderColor = groupBy === 'categories'
                  ? getCategoryColor(primaryCategory)
                  : getLocationColor(event.location?.displayName || 'Unspecified');

                return (
                <div
                  key={`${event.id}-${userTimezone}`} // Include timezone in key to force re-render
                  className={`panel-event-item ${isPending ? 'pending-event' : ''} ${hasPendingEditRequest ? 'has-pending-edit' : ''}`}
                  onClick={(e) => onEventClick && onEventClick(event, e)}
                  style={{
                    position: 'relative',
                    borderLeft: `4px ${isPending ? 'dashed' : 'solid'} ${borderColor}`,
                    opacity: isPending ? 0.85 : 1
                  }}
                >
                  {(event.seriesMasterId || event.graphData?.seriesMasterId ||
                    event.graphData?.recurrence || event.graphData?.type === 'seriesMaster') && (
                    <div style={{
                      position: 'absolute',
                      top: '4px',
                      right: '6px',
                      fontSize: '14px',
                      color: '#444',
                      fontWeight: 'bold',
                      lineHeight: 1
                    }}>
                      ↻
                    </div>
                  )}
                  <div className="event-time">
                    {formatEventTimeWithContext(event.start.dateTime, event.subject, event.start?.timeZone || event.graphData?.start?.timeZone)}
                    {' - '}
                    {formatEventTimeWithContext(event.end.dateTime, event.subject, event.end?.timeZone || event.graphData?.end?.timeZone)}
                  </div>
                  
                  <div className="event-subject">{event.subject}</div>
                  
                  {event.location?.displayName && (
                    <div className="event-detail">
                      {isVirtualLocation(event.location.displayName) ? (
                        <>
                          <span className="detail-icon">🎥</span>
                          <span className="virtual-meeting-badge">
                            {getVirtualPlatform(event.location.displayName)} Meeting
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="detail-icon">📍</span>
                          {event.location.displayName}
                        </>
                      )}
                    </div>
                  )}
                  
                  <div className="event-detail">
                    <span className="detail-icon">🏷️</span>
                    {primaryCategory}
                  </div>
                  
                  {((event.setupMinutes && event.setupMinutes > 0) || (event.teardownMinutes && event.teardownMinutes > 0)) && (
                    <div className="event-detail setup-teardown-info">
                      <span className="detail-icon">⏱️</span>
                      Setup/Teardown: 
                      {event.setupMinutes > 0 && <span> {event.setupMinutes}min before</span>}
                      {event.setupMinutes > 0 && event.teardownMinutes > 0 && <span>,</span>}
                      {event.teardownMinutes > 0 && <span> {event.teardownMinutes}min after</span>}
                    </div>
                  )}
                  
                  {event.calendarName && (
                    <div className="event-detail calendar-name">
                      <span className="detail-icon">📅</span>
                      {event.calendarName}
                    </div>
                  )}
                  {isPending && (
                    <div style={{
                      fontSize: '10px',
                      fontWeight: '600',
                      color: '#b45309',
                      backgroundColor: '#fef3c7',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      marginTop: '6px',
                      display: 'inline-block'
                    }}>
                      PENDING
                    </div>
                  )}

                  {/* Pending Edit Request indicator badge */}
                  {hasPendingEditRequest && (
                    <div style={{
                      fontSize: '10px',
                      fontWeight: '600',
                      color: '#7c3aed',
                      backgroundColor: '#ede9fe',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      marginTop: '6px',
                      display: 'inline-block'
                    }}>
                      EDIT PENDING
                    </div>
                  )}

                  {/* Request Edit button for approved events - visible to requesters and above */}
                  {/* Hide if there's already a pending edit request */}
                  {event.status === 'approved' && canSubmitReservation && onRequestEdit && !hasPendingEditRequest && (
                    <button
                      className="request-edit-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRequestEdit(event);
                      }}
                      title="Request changes to this event"
                    >
                      Request Edit
                    </button>
                  )}
                </div>
              );
              })}
          </div>
        )}
      </div>
    </div>
  );
});

export default DayEventPanel;