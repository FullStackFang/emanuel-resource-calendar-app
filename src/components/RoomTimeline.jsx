// src/components/RoomTimeline.jsx
import React from 'react';
import './RoomTimeline.css';

export default function RoomTimeline({ room, conflicts, requestedWindow }) {
  // Timeline spans from 8 AM to 10 PM (14 hours)
  const timelineStart = 8; // 8 AM
  const timelineEnd = 22; // 10 PM
  const totalHours = timelineEnd - timelineStart;
  
  // Default to today's date if no requestedWindow provided
  const defaultDate = new Date();
  const timelineDate = requestedWindow?.eventStart || defaultDate;
  
  // Helper to convert time to position percentage on timeline
  const timeToPosition = (date) => {
    const hours = date.getHours() + date.getMinutes() / 60;
    const adjustedHours = Math.max(timelineStart, Math.min(timelineEnd, hours));
    return ((adjustedHours - timelineStart) / totalHours) * 100;
  };
  
  // Helper to format time for display
  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: date.getMinutes() === 0 ? undefined : '2-digit',
      hour12: true
    });
  };
  
  // Generate timeline blocks for conflicts and requested time
  const timelineBlocks = [];
  
  // Add requested time slot
  if (requestedWindow) {
    const { eventStart, eventEnd, effectiveStart, effectiveEnd } = requestedWindow;
    
    // Main event time (blue)
    timelineBlocks.push({
      id: 'requested-event',
      type: 'requested',
      left: timeToPosition(eventStart),
      width: timeToPosition(eventEnd) - timeToPosition(eventStart),
      title: 'Your Event',
      time: `${formatTime(eventStart)} - ${formatTime(eventEnd)}`,
      color: '#0284c7'
    });
    
    // Setup time (light blue, if any)
    if (effectiveStart < eventStart) {
      timelineBlocks.push({
        id: 'requested-setup',
        type: 'setup',
        left: timeToPosition(effectiveStart),
        width: timeToPosition(eventStart) - timeToPosition(effectiveStart),
        title: 'Setup Time',
        time: `${formatTime(effectiveStart)} - ${formatTime(eventStart)}`,
        color: '#7dd3fc'
      });
    }
    
    // Teardown time (light blue, if any)
    if (effectiveEnd > eventEnd) {
      timelineBlocks.push({
        id: 'requested-teardown',
        type: 'teardown',
        left: timeToPosition(eventEnd),
        width: timeToPosition(effectiveEnd) - timeToPosition(eventEnd),
        title: 'Teardown Time',
        time: `${formatTime(eventEnd)} - ${formatTime(effectiveEnd)}`,
        color: '#7dd3fc'
      });
    }
  }
  
  // Add reservation conflicts (red)
  conflicts?.reservations?.forEach((reservation, index) => {
    const { effectiveStart, effectiveEnd, originalStart, originalEnd } = reservation;
    
    // Main reservation time
    timelineBlocks.push({
      id: `reservation-${index}`,
      type: 'reservation',
      left: timeToPosition(originalStart),
      width: timeToPosition(originalEnd) - timeToPosition(originalStart),
      title: reservation.eventTitle,
      subtitle: `by ${reservation.requesterName}`,
      time: `${formatTime(originalStart)} - ${formatTime(originalEnd)}`,
      color: '#dc2626',
      status: reservation.status
    });
    
    // Setup time for reservation
    if (effectiveStart < originalStart) {
      timelineBlocks.push({
        id: `reservation-setup-${index}`,
        type: 'reservation-buffer',
        left: timeToPosition(effectiveStart),
        width: timeToPosition(originalStart) - timeToPosition(effectiveStart),
        title: 'Setup Buffer',
        subtitle: reservation.eventTitle,
        time: `${formatTime(effectiveStart)} - ${formatTime(originalStart)}`,
        color: '#fca5a5'
      });
    }
    
    // Teardown time for reservation
    if (effectiveEnd > originalEnd) {
      timelineBlocks.push({
        id: `reservation-teardown-${index}`,
        type: 'reservation-buffer',
        left: timeToPosition(originalEnd),
        width: timeToPosition(effectiveEnd) - timeToPosition(originalEnd),
        title: 'Teardown Buffer',
        subtitle: reservation.eventTitle,
        time: `${formatTime(originalEnd)} - ${formatTime(effectiveEnd)}`,
        color: '#fca5a5'
      });
    }
  });
  
  // Add calendar event conflicts (orange)
  conflicts?.events?.forEach((event, index) => {
    timelineBlocks.push({
      id: `event-${index}`,
      type: 'calendar-event',
      left: timeToPosition(event.start),
      width: timeToPosition(event.end) - timeToPosition(event.start),
      title: event.subject,
      subtitle: `by ${event.organizer}`,
      time: `${formatTime(event.start)} - ${formatTime(event.end)}`,
      color: '#ea580c'
    });
  });
  
  // Generate hour markers
  const hourMarkers = [];
  for (let hour = timelineStart; hour <= timelineEnd; hour += 2) {
    const position = ((hour - timelineStart) / totalHours) * 100;
    const time12 = hour === 12 ? '12PM' : hour > 12 ? `${hour - 12}PM` : `${hour}AM`;
    hourMarkers.push({
      position,
      label: time12,
      hour
    });
  }
  
  return (
    <div className="room-timeline">
      <div className="timeline-header">
        <h4>📅 {room.name} Schedule - {timelineDate.toLocaleDateString('en-US', { 
          weekday: 'short', 
          month: 'short', 
          day: 'numeric' 
        })}</h4>
        <div className="timeline-legend">
          {requestedWindow && (
            <span className="legend-item">
              <span className="legend-color" style={{ backgroundColor: '#0284c7' }}></span>
              Your Event
            </span>
          )}
          <span className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#dc2626' }}></span>
            Reservations
          </span>
          <span className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#ea580c' }}></span>
            Calendar Events
          </span>
          <span className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#7dd3fc' }}></span>
            Buffer Times
          </span>
        </div>
      </div>
      
      <div className="timeline-container">
        <div className="timeline-track">
          {/* Hour markers */}
          {hourMarkers.map(marker => (
            <div
              key={marker.hour}
              className="hour-marker"
              style={{ left: `${marker.position}%` }}
            >
              <div className="hour-line"></div>
              <div className="hour-label">{marker.label}</div>
            </div>
          ))}
          
          {/* Timeline blocks */}
          {timelineBlocks.map(block => (
            <div
              key={block.id}
              className={`timeline-block ${block.type}`}
              style={{
                left: `${block.left}%`,
                width: `${Math.max(block.width, 1)}%`, // Minimum 1% width for visibility
                backgroundColor: block.color
              }}
              title={`${block.title}\n${block.time}${block.subtitle ? `\n${block.subtitle}` : ''}`}
            >
              <div className="block-content">
                <div className="block-title">{block.title}</div>
                {block.subtitle && <div className="block-subtitle">{block.subtitle}</div>}
                <div className="block-time">{block.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {timelineBlocks.length === 0 && (
        <div className="no-conflicts-message">
          ✅ No events or reservations found - this room appears to be free all day!
        </div>
      )}
      
      {timelineBlocks.length === 1 && timelineBlocks[0].type === 'requested' && (
        <div className="no-conflicts-message">
          ✅ No conflicts found - this room is available for your requested time!
        </div>
      )}
    </div>
  );
}