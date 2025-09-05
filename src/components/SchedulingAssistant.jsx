// src/components/SchedulingAssistant.jsx
import React, { useState, useEffect, useRef } from 'react';
import './SchedulingAssistant.css';

export default function SchedulingAssistant({ 
  selectedRooms, 
  selectedDate,
  eventStartTime,
  eventEndTime,
  availability,
  onTimeSlotClick 
}) {
  const [timeSlots, setTimeSlots] = useState([]);
  const timelineRef = useRef(null);
  
  // Use today's date as default if no date is selected (in local timezone)
  const getTodayDate = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  const effectiveDate = selectedDate || getTodayDate();
  
  // Location color palette
  const locationColors = [
    '#0078d4', // Blue
    '#107c10', // Green  
    '#d13438', // Red
    '#ff8c00', // Orange
    '#5c2d91', // Purple
    '#008575', // Teal
    '#00bcf2', // Light Blue
    '#bad80a', // Lime
    '#e3008c', // Magenta
    '#00188f'  // Dark Blue
  ];

  // Generate time slots for the full day (12 AM to 11 PM - 24 hours total)
  useEffect(() => {
    const slots = [];
    for (let hour = 0; hour < 24; hour++) {
      slots.push({
        time: hour,
        displayTime: formatHour(hour),
        conflicts: getConflictsForHour(hour)
      });
    }
    setTimeSlots(slots);
  }, [availability, effectiveDate]);

  // Auto-scroll to 8 AM on load (8 hours × 40px per hour = 320px)
  useEffect(() => {
    if (timelineRef.current && timeSlots.length > 0) {
      const scrollTo8AM = 8 * 40; // 8 AM is the 8th hour, 40px per time slot
      timelineRef.current.scrollTop = scrollTo8AM;
    }
  }, [timeSlots]);

  const formatHour = (hour) => {
    if (hour === 0) return '12 AM';
    if (hour < 12) return `${hour} AM`;
    if (hour === 12) return '12 PM';
    return `${hour - 12} PM`;
  };

  const getConflictsForHour = (hour) => {
    if (!availability || !selectedRooms.length) return [];

    return selectedRooms.map((room, index) => {
      const roomAvailability = availability.find(a => a.room._id === room._id);
      const conflicts = [];
      
      if (roomAvailability && roomAvailability.conflicts && roomAvailability.conflicts.reservations.length > 0) {
        // Simple approach: check if this hour falls within any reservation time
        const hasConflictThisHour = roomAvailability.conflicts.reservations.some(reservation => {
          const resStart = new Date(reservation.originalStart);
          const resEnd = new Date(reservation.originalEnd);
          
          // Get the hour from the reservation start/end times
          const startHour = resStart.getHours();
          const endHour = resEnd.getHours();
          
          // Check if current hour falls within the reservation time range
          // Handle reservations that span multiple hours
          if (startHour <= endHour) {
            // Same day reservation
            return hour >= startHour && hour <= endHour;
          } else {
            // Reservation spans midnight
            return hour >= startHour || hour <= endHour;
          }
        });

        if (hasConflictThisHour) {
          // Get all reservations for tooltip
          const allReservations = roomAvailability.conflicts.reservations;
          
          conflicts.push({
            type: 'busy',
            duration: 'partial',
            events: [],
            reservations: allReservations
          });
        }
      }

      return {
        room,
        roomIndex: index,
        color: locationColors[index % locationColors.length],
        conflicts
      };
    });
  };

  const isEventTimeSlot = (hour) => {
    if (!eventStartTime || !eventEndTime) return false;
    
    const eventStart = new Date(`${effectiveDate}T${eventStartTime}`);
    const eventEnd = new Date(`${effectiveDate}T${eventEndTime}`);
    
    const slotStart = new Date(effectiveDate);
    slotStart.setHours(hour, 0, 0, 0);
    const slotEnd = new Date(effectiveDate);
    slotEnd.setHours(hour + 1, 0, 0, 0);
    
    return eventStart < slotEnd && eventEnd > slotStart;
  };

  const getConflictTooltip = (roomData) => {
    const room = roomData.room;
    const conflicts = roomData.conflicts[0]; // Get the first conflict for this hour
    
    if (!conflicts) return `${room.name} - Busy`;
    
    let tooltipLines = [`${room.name} - Conflicts:`];
    
    // Add calendar events
    if (conflicts.events && conflicts.events.length > 0) {
      conflicts.events.forEach(event => {
        const startTime = new Date(event.start.dateTime).toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        });
        const endTime = new Date(event.end.dateTime).toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        });
        tooltipLines.push(`• ${event.subject || 'Event'} (${startTime} - ${endTime})`);
      });
    }
    
    // Add room reservations
    if (conflicts.reservations && conflicts.reservations.length > 0) {
      conflicts.reservations.forEach(reservation => {
        const startTime = new Date(reservation.startDateTime).toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        });
        const endTime = new Date(reservation.endDateTime).toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        });
        tooltipLines.push(`• ${reservation.eventTitle} (${startTime} - ${endTime})`);
      });
    }
    
    return tooltipLines.join('\n');
  };

  if (!selectedRooms.length) {
    return (
      <div className="scheduling-assistant">
        <div className="assistant-header">
          <h3>📅 Scheduling Assistant</h3>
          <p>Select locations to view their availability</p>
        </div>
        <div className="empty-assistant">
          <div className="empty-icon">🏢</div>
          <p>Click on location cards to add them to the scheduling view</p>
        </div>
      </div>
    );
  }

  return (
    <div className="scheduling-assistant">
      <div className="assistant-header">
        <h3>📅 Scheduling Assistant</h3>
        <div className="selected-date">
          {new Date(effectiveDate + 'T12:00:00').toLocaleDateString('en-US', { 
            weekday: 'long',
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          })}
        </div>
      </div>

      {/* Location Legend */}
      <div className="location-legend">
        {selectedRooms.map((room, index) => (
          <div key={room._id} className="legend-item">
            <div 
              className="legend-color" 
              style={{ backgroundColor: locationColors[index % locationColors.length] }}
            ></div>
            <span className="legend-name">{room.name}</span>
          </div>
        ))}
      </div>

      {/* Timeline */}
      <div ref={timelineRef} className="timeline-container">
        {timeSlots.map((slot) => (
          <div 
            key={slot.time} 
            className={`time-slot ${isEventTimeSlot(slot.time) ? 'event-time' : ''}`}
            onClick={() => onTimeSlotClick && onTimeSlotClick(slot.time)}
          >
            <div className="time-label">{slot.displayTime}</div>
            <div className="availability-bars">
              {slot.conflicts.map((roomData) => (
                <div 
                  key={roomData.room._id}
                  className="room-availability"
                >
                  {roomData.conflicts.length > 0 && (
                    <div 
                      className="busy-bar"
                      style={{ backgroundColor: roomData.color }}
                      title={getConflictTooltip(roomData)}
                    >
                      <span className="conflict-indicator">●</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Find Available Time Button */}
      {eventStartTime && eventEndTime && (
        <div className="assistant-actions">
          <button className="find-time-btn">
            🔍 Find Available Time
          </button>
        </div>
      )}
    </div>
  );
}