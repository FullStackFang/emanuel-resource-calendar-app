// src/components/SchedulingAssistant.jsx
import React, { useState, useEffect, useRef } from 'react';
import './SchedulingAssistant.css';

export default function SchedulingAssistant({
  selectedRooms,
  selectedDate,
  eventStartTime,
  eventEndTime,
  availability,
  onTimeSlotClick,
  onRoomRemove, // Callback to remove a room from selection
  onEventTimeChange // Callback to update event times when dragging
}) {
  const [eventBlocks, setEventBlocks] = useState([]);
  const [activeRoomIndex, setActiveRoomIndex] = useState(0); // Track which room tab is active
  const [roomStats, setRoomStats] = useState({}); // Stats per room: { roomId: { conflictCount, events } }
  const [draggingEventId, setDraggingEventId] = useState(null);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragOffsets, setDragOffsets] = useState({}); // Track drag offset for each event
  const timelineRef = useRef(null);

  const PIXELS_PER_HOUR = 80; // Increased from 40px to 80px for better visibility
  const START_HOUR = 0;
  const END_HOUR = 24;
  
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

  // Process availability data and create event blocks with calculated positions
  useEffect(() => {
    if (!availability || !selectedRooms.length) {
      setEventBlocks([]);
      setRoomStats({});
      return;
    }

    console.log('[SchedulingAssistant] Processing availability - Rooms:', selectedRooms.length, 'Date:', effectiveDate);

    const blocks = [];
    const stats = {};

    selectedRooms.forEach((room, roomIndex) => {
      const roomAvailability = availability.find(a => a.room._id === room._id);

      if (!roomAvailability || !roomAvailability.conflicts) {
        console.log(`[SchedulingAssistant] No availability data for room: ${room.name}`);
        stats[room._id] = { conflictCount: 0, eventCount: 0 };
        return;
      }

      console.log(`[SchedulingAssistant] Room: ${room.name} - Reservations: ${roomAvailability.conflicts.reservations?.length || 0}, Events: ${roomAvailability.conflicts.events?.length || 0}`);

      const roomColor = locationColors[roomIndex % locationColors.length];
      let roomEventCount = 0;
      let eventIndexInRoom = 0; // Track event order within room for color variation

      // Process reservations
      if (roomAvailability.conflicts.reservations) {
        roomAvailability.conflicts.reservations.forEach(reservation => {
          console.log(`[SchedulingAssistant] Processing reservation: "${reservation.eventTitle}" from ${reservation.originalStart} to ${reservation.originalEnd}`);
          const startTime = new Date(reservation.originalStart || reservation.startDateTime);
          const endTime = new Date(reservation.originalEnd || reservation.endDateTime);

          // Calculate position and height
          const position = calculateEventPosition(startTime, endTime);

          // Apply color variation based on event index
          const variedColor = adjustColorShade(roomColor, eventIndexInRoom);

          blocks.push({
            id: reservation._id || reservation.id,
            type: 'reservation',
            room,
            roomIndex,
            color: variedColor,
            baseColor: roomColor,
            eventIndexInRoom,
            title: reservation.eventTitle,
            startTime,
            endTime,
            organizer: reservation.requesterName || reservation.requesterEmail,
            status: reservation.status,
            isConflict: false, // Will be calculated later
            ...position
          });

          roomEventCount++;
          eventIndexInRoom++;
        });
      }

      // Process calendar events
      if (roomAvailability.conflicts.events) {
        roomAvailability.conflicts.events.forEach(event => {
          const startTime = new Date(event.start.dateTime);
          const endTime = new Date(event.end.dateTime);

          const position = calculateEventPosition(startTime, endTime);

          // Apply color variation based on event index
          const variedColor = adjustColorShade(roomColor, eventIndexInRoom);

          blocks.push({
            id: event.id,
            type: 'calendar-event',
            room,
            roomIndex,
            color: variedColor,
            baseColor: roomColor,
            eventIndexInRoom,
            title: event.subject || 'Calendar Event',
            startTime,
            endTime,
            organizer: event.organizer?.emailAddress?.name || 'Unknown',
            isConflict: false, // Will be calculated later
            ...position
          });

          roomEventCount++;
          eventIndexInRoom++;
        });
      }

      // Initialize stats (conflicts will be calculated after)
      stats[room._id] = {
        conflictCount: 0,
        eventCount: roomEventCount
      };
    });

    // Calculate conflicts between all events (not just user's event)
    // Group blocks by room for conflict detection
    const blocksByRoom = {};
    blocks.forEach(block => {
      const roomId = block.room._id;
      if (!blocksByRoom[roomId]) {
        blocksByRoom[roomId] = [];
      }
      blocksByRoom[roomId].push(block);
    });

    // Check each event against all other events in the same room
    blocks.forEach(block => {
      const roomBlocks = blocksByRoom[block.room._id] || [];
      const hasConflict = roomBlocks.some(otherBlock => {
        if (otherBlock.id === block.id) return false;
        return block.startTime < otherBlock.endTime && block.endTime > otherBlock.startTime;
      });
      block.isConflict = hasConflict;
    });

    // Recalculate stats based on conflicts
    selectedRooms.forEach(room => {
      const roomBlocks = blocksByRoom[room._id] || [];
      const conflictingEvents = roomBlocks.filter(b => b.isConflict);

      if (stats[room._id]) {
        stats[room._id].conflictCount = conflictingEvents.length;
        stats[room._id].eventCount = roomBlocks.length;
      }
    });

    console.log(`[SchedulingAssistant] FINAL: Generated ${blocks.length} total event blocks`);
    blocks.forEach(b => console.log(`  - "${b.title}" at ${b.startTime.toLocaleTimeString()} (top: ${b.top}px)`));

    setEventBlocks(blocks);
    setRoomStats(stats);
  }, [availability, selectedRooms, effectiveDate]);

  // Reset active room index when selected rooms change
  useEffect(() => {
    if (activeRoomIndex >= selectedRooms.length) {
      setActiveRoomIndex(0);
    }
  }, [selectedRooms, activeRoomIndex]);

  // Calculate event block position based on start/end times
  const calculateEventPosition = (startTime, endTime) => {
    const dayStart = new Date(effectiveDate + 'T00:00:00');

    // Calculate hours from start of day
    const startHours = (startTime - dayStart) / (1000 * 60 * 60);
    const endHours = (endTime - dayStart) / (1000 * 60 * 60);

    // Clamp to visible day range
    const clampedStartHours = Math.max(START_HOUR, Math.min(END_HOUR, startHours));
    const clampedEndHours = Math.max(START_HOUR, Math.min(END_HOUR, endHours));

    const top = clampedStartHours * PIXELS_PER_HOUR;
    const height = (clampedEndHours - clampedStartHours) * PIXELS_PER_HOUR;

    return {
      top,
      height: Math.max(height, 20) // Minimum height of 20px
    };
  };

  const formatHour = (hour) => {
    if (hour === 0) return '12 AM';
    if (hour < 12) return `${hour} AM`;
    if (hour === 12) return '12 PM';
    return `${hour - 12} PM`;
  };

  // Generate color variation from a base hex color
  // Adjusts the brightness/darkness to create visual distinction
  const adjustColorShade = (hexColor, variationIndex) => {
    // Remove # if present
    const hex = hexColor.replace('#', '');

    // Parse RGB values
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Calculate adjustment factor
    // Alternate between lighter and darker shades
    // variationIndex 0: base color
    // variationIndex 1: lighter
    // variationIndex 2: darker
    // variationIndex 3: even lighter, etc.
    const adjustmentSteps = 20; // How much to adjust per step
    const isLighter = variationIndex % 2 === 1;
    const magnitude = Math.floor((variationIndex + 1) / 2) * adjustmentSteps;

    const adjust = (value) => {
      if (isLighter) {
        // Make lighter: move towards 255
        return Math.min(255, value + magnitude);
      } else {
        // Make darker: move towards 0
        return Math.max(0, value - magnitude);
      }
    };

    const newR = adjust(r);
    const newG = adjust(g);
    const newB = adjust(b);

    // Convert back to hex
    const toHex = (n) => {
      const hex = n.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };

    return `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`;
  };

  // Format time for display
  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  // Detect if an event overlaps with other events in the same room
  const getOverlapOffset = (block, allVisibleBlocks) => {
    // Find all blocks that overlap with this one
    const overlapping = allVisibleBlocks.filter(otherBlock => {
      if (otherBlock.id === block.id) return false;

      // Check if times overlap
      return block.startTime < otherBlock.endTime && block.endTime > otherBlock.startTime;
    });

    if (overlapping.length === 0) return { left: 0, width: 100 };

    // Calculate offset based on event index
    // Each overlapping event gets a small horizontal shift
    const offsetPercent = (block.eventIndexInRoom % 3) * 3; // 0%, 3%, 6% offset
    const widthPercent = 97; // Slightly narrower to show stagger effect

    return { left: offsetPercent, width: widthPercent };
  };

  // Handle drag start for any event
  const handleEventDragStart = (e, block) => {
    console.log('[Drag] START - event:', block.title);
    e.stopPropagation();
    setDraggingEventId(block.id);
    setDragStartY(e.clientY);

    // Store initial position
    setDragOffsets(prev => ({
      ...prev,
      [block.id]: 0
    }));
  };

  // Handle dragging
  const handleEventDrag = (e) => {
    if (!draggingEventId) return;

    // Don't skip on clientY === 0, as browsers sometimes report this during drag
    if (e.clientY !== 0) {
      const deltaY = e.clientY - dragStartY;
      console.log('[Drag] MOVE - deltaY:', deltaY, 'clientY:', e.clientY);
      setDragOffsets(prev => ({
        ...prev,
        [draggingEventId]: deltaY
      }));
    }
  };

  // Handle drag end - events snap back (no form updates)
  const handleEventDragEnd = () => {
    if (!draggingEventId) return;

    // Just reset drag state - events snap back to original position
    setDraggingEventId(null);
    setDragOffsets({});
  };

  // Render event block with drag capability
  const renderEventBlock = (block, allVisibleBlocks) => {
    const eventIcon = block.type === 'reservation' ? '📅' : '🗓️';
    const borderStyle = block.status === 'pending' ? 'dashed' : 'solid';
    const offset = getOverlapOffset(block, allVisibleBlocks);

    const isDragging = draggingEventId === block.id;
    const dragOffset = dragOffsets[block.id] || 0;

    // Calculate new position if dragging
    const top = block.top + (isDragging ? dragOffset : 0);

    if (isDragging) {
      console.log('[Drag] RENDER - block.top:', block.top, 'dragOffset:', dragOffset, 'calculatedTop:', top);
    }

    // Check for conflicts at current dragged position
    let hasConflict = block.isConflict;
    if (isDragging) {
      const hourOffset = dragOffset / PIXELS_PER_HOUR;
      const durationMs = block.endTime - block.startTime;
      const draggedStart = new Date(block.startTime.getTime() + hourOffset * 60 * 60 * 1000);
      const draggedEnd = new Date(draggedStart.getTime() + durationMs);

      // Check conflicts with other events (excluding self)
      hasConflict = allVisibleBlocks.some(otherBlock =>
        otherBlock.id !== block.id &&
        draggedStart < otherBlock.endTime &&
        draggedEnd > otherBlock.startTime
      );
    }

    // Visual styling - all events equally visible
    const opacity = hasConflict ? 0.95 : 0.8;
    const conflictIndicator = hasConflict ? '⚠️ ' : '';
    const cursor = isDragging ? 'grabbing' : 'grab';
    const boxShadow = isDragging
      ? '0 8px 20px rgba(0, 0, 0, 0.3)'
      : '0 2px 6px rgba(0, 0, 0, 0.2)';

    return (
      <div
        key={`${block.id}-${block.roomIndex}`}
        className={`event-block ${block.type} ${hasConflict ? 'conflict' : 'non-conflict'}`}
        style={{
          top: `${top}px`,
          height: `${block.height}px`,
          backgroundColor: block.color,
          borderStyle: borderStyle,
          borderWidth: '2px',
          left: `${offset.left}%`,
          width: `${offset.width}%`,
          opacity: opacity,
          cursor: cursor,
          boxShadow: boxShadow,
          zIndex: isDragging ? 200 : 5,
          transition: isDragging ? 'none' : 'all 0.2s'
        }}
        draggable
        onDragStart={(e) => handleEventDragStart(e, block)}
        onDrag={handleEventDrag}
        onDragEnd={handleEventDragEnd}
        onClick={() => handleEventBlockClick(block)}
        title={`${hasConflict ? '⚠️ CONFLICT: ' : ''}${block.title}\n${formatTime(block.startTime)} - ${formatTime(block.endTime)}\nOrganizer: ${block.organizer}\n\n👆 Drag to explore conflict resolution${hasConflict ? '\n⚠️ Overlaps with other events' : '\n✓ No conflicts'}`}
      >
        <div className="event-block-content">
          <div className="event-block-header">
            <span className="event-icon">{conflictIndicator}{eventIcon}</span>
            <span className="event-title">{block.title}</span>
          </div>
          <div className="event-time">
            {formatTime(block.startTime)} - {formatTime(block.endTime)}
          </div>
          {block.organizer && (
            <div className="event-organizer">{block.organizer}</div>
          )}
          {block.status && block.status === 'pending' && (
            <div className="event-status">Pending Approval</div>
          )}
        </div>
      </div>
    );
  };


  // Get the currently active room
  const activeRoom = selectedRooms[activeRoomIndex];

  // Filter event blocks to show only the active room's events
  const visibleEventBlocks = activeRoom
    ? eventBlocks.filter(block => block.room._id === activeRoom._id)
    : [];

  // Show which events are visible for the active room
  if (activeRoom) {
    console.log(`[SchedulingAssistant] VISIBLE for ${activeRoom.name}: ${visibleEventBlocks.length} events`);
    visibleEventBlocks.forEach(b => console.log(`  - "${b.title}" at ${b.startTime.toLocaleTimeString()}`));
  }

  // Get stats for the active room
  const activeRoomStats = activeRoom ? roomStats[activeRoom._id] : { conflictCount: 0, eventCount: 0 };

  // Smart auto-scroll: center on the user's event time, or earliest conflicting event
  useEffect(() => {
    // Don't auto-scroll while dragging - it interferes with the user's interaction
    if (draggingEventId) {
      return;
    }

    if (!timelineRef.current) return;

    let targetHour = 8; // Default fallback to 8 AM

    // If we have a user's event time (from form), center on that
    if (eventStartTime) {
      const [hours, minutes] = eventStartTime.split(':').map(Number);
      targetHour = hours + minutes / 60;
      console.log(`[SchedulingAssistant] Auto-scroll to user event time: ${eventStartTime} (hour ${targetHour})`);
    } else if (visibleEventBlocks.length > 0) {
      // Otherwise, find earliest conflicting event, or just earliest event if no conflicts
      const conflictingEvents = visibleEventBlocks.filter(b => b.isConflict);
      const eventsToConsider = conflictingEvents.length > 0 ? conflictingEvents : visibleEventBlocks;

      const earliestEvent = eventsToConsider.reduce((earliest, block) => {
        return block.startTime < earliest.startTime ? block : earliest;
      }, eventsToConsider[0]);

      const dayStart = new Date(effectiveDate + 'T00:00:00');
      targetHour = (earliestEvent.startTime - dayStart) / (1000 * 60 * 60);
      console.log(`[SchedulingAssistant] Auto-scroll to earliest event: ${earliestEvent.title} (hour ${targetHour})`);
    }

    // Calculate scroll position to center the target hour
    const containerHeight = timelineRef.current.clientHeight;
    const visibleHours = containerHeight / PIXELS_PER_HOUR;
    const scrollPosition = (targetHour - visibleHours / 2) * PIXELS_PER_HOUR;

    // Ensure we don't scroll before the start or past the end
    const maxScroll = (END_HOUR - START_HOUR) * PIXELS_PER_HOUR - containerHeight;
    const clampedScroll = Math.max(0, Math.min(scrollPosition, maxScroll));

    timelineRef.current.scrollTop = clampedScroll;
  }, [eventBlocks, activeRoomIndex, effectiveDate, visibleEventBlocks, draggingEventId]);

  // Handle event block click
  const handleEventBlockClick = (block) => {
    console.log('[SchedulingAssistant] Event block clicked:', block);
    // TODO: Open event details modal
  };

  // Handle time slot click
  const handleTimeSlotClick = (hour) => {
    if (onTimeSlotClick) {
      onTimeSlotClick(hour);
    }
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
        <h3>🗓️ Scheduling Assistant</h3>
        <div className="selected-date">
          {new Date(effectiveDate + 'T12:00:00').toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })}
        </div>
      </div>

      {/* Room Tabs */}
      {selectedRooms.length > 0 && (
        <div className="room-tabs">
          {selectedRooms.map((room, index) => {
            const roomColor = locationColors[index % locationColors.length];
            const isActive = index === activeRoomIndex;
            const stats = roomStats[room._id] || { conflictCount: 0 };

            const handleCloseTab = (e) => {
              e.stopPropagation(); // Prevent tab selection when clicking close

              // If we're closing the active tab, switch to another tab first
              if (isActive && selectedRooms.length > 1) {
                // Switch to the previous tab, or the next one if we're at the start
                const newActiveIndex = index > 0 ? index - 1 : 0;
                setActiveRoomIndex(newActiveIndex);
              }

              // Call parent's callback to remove the room
              if (onRoomRemove) {
                onRoomRemove(room);
              }
            };

            return (
              <button
                key={room._id}
                className={`room-tab ${isActive ? 'active' : ''}`}
                style={{
                  borderBottomColor: isActive ? roomColor : 'transparent',
                  color: isActive ? roomColor : '#6b7280'
                }}
                onClick={() => setActiveRoomIndex(index)}
              >
                <span className="room-tab-name">{room.name}</span>
                {stats.conflictCount > 0 && (
                  <span className="room-tab-badge" style={{ backgroundColor: roomColor }}>
                    {stats.conflictCount}
                  </span>
                )}
                <span
                  className="room-tab-close"
                  onClick={handleCloseTab}
                  title={`Remove ${room.name}`}
                >
                  ×
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Quick Stats for Active Room */}
      {activeRoomStats && activeRoomStats.eventCount > 0 && (
        <div className="stats-panel">
          <div className="stat-item">
            <span className="stat-icon">📅</span>
            <span className="stat-value">{activeRoomStats.eventCount}</span>
            <span className="stat-label">
              Event{activeRoomStats.eventCount !== 1 ? 's' : ''}
            </span>
          </div>
          {activeRoomStats.conflictCount > 0 && (
            <div className="stat-item">
              <span className="stat-icon">⚠️</span>
              <span className="stat-value">{activeRoomStats.conflictCount}</span>
              <span className="stat-label">
                Conflict{activeRoomStats.conflictCount !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Timeline Container */}
      <div className="timeline-wrapper">

        {/* Scrollable timeline */}
        <div ref={timelineRef} className="timeline-container">
          {/* Time grid background */}
          <div className="timeline-grid">
            <div className="time-labels">
              {Array.from({ length: END_HOUR - START_HOUR }).map((_, index) => {
                const hour = START_HOUR + index;
                return (
                  <div
                    key={hour}
                    className="time-label"
                    style={{ height: `${PIXELS_PER_HOUR}px` }}
                    onClick={() => handleTimeSlotClick(hour)}
                  >
                    <span className="time-text">{formatHour(hour)}</span>
                  </div>
                );
              })}
            </div>

            {/* Event blocks area */}
            <div
              className="events-area"
              style={{ height: `${(END_HOUR - START_HOUR) * PIXELS_PER_HOUR}px` }}
            >
              {/* Hour lines */}
              {Array.from({ length: END_HOUR - START_HOUR }).map((_, index) => (
                <div
                  key={index}
                  className="hour-line"
                  style={{
                    top: `${index * PIXELS_PER_HOUR}px`,
                    height: `${PIXELS_PER_HOUR}px`
                  }}
                />
              ))}

              {/* Event blocks - all draggable */}
              {visibleEventBlocks.map(block => renderEventBlock(block, visibleEventBlocks))}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}