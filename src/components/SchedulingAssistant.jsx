// src/components/SchedulingAssistant.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import './SchedulingAssistant.css';

export default function SchedulingAssistant({
  selectedRooms,
  selectedDate,
  eventStartTime,
  eventEndTime,
  setupTime, // Setup start time for room blocking
  teardownTime, // Teardown end time for room blocking
  doorOpenTime, // Door open time (optional)
  doorCloseTime, // Door close time (optional)
  eventTitle, // Title of the event being created/edited
  availability,
  onTimeSlotClick,
  onRoomRemove, // Callback to remove a room from selection
  onEventTimeChange, // Callback to update event times when dragging
  currentReservationId // ID of the current reservation being reviewed (only this one is draggable)
}) {
  const [eventBlocks, setEventBlocks] = useState([]);
  const [activeRoomIndex, setActiveRoomIndex] = useState(0); // Track which room tab is active
  const [roomStats, setRoomStats] = useState({}); // Stats per room: { roomId: { conflictCount, events } }
  const [draggingEventId, setDraggingEventId] = useState(null);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragOffsets, setDragOffsets] = useState({}); // Track drag offset for each event
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const timelineRef = useRef(null);
  const tabsContainerRef = useRef(null);
  const manuallyAdjustedPositions = useRef({}); // Track manually dragged positions: { eventId: { top, startTime, endTime } }
  const userEventAdjustment = useRef(null); // Track user event's dragged position: { startTime, endTime }
  const hasScrolledOnce = useRef(false); // Track if initial auto-scroll has happened
  const autoScrollInterval = useRef(null); // Track auto-scroll animation frame

  const PIXELS_PER_HOUR = 50; // 50px per hour shows 12 hours in 600px viewport
  const START_HOUR = 0;
  const END_HOUR = 24;

  // Auto-scroll configuration for drag operations
  const SCROLL_HOT_ZONE = 80;        // pixels from edge to trigger auto-scroll
  const SCROLL_SPEED_BASE = 8;       // base scroll speed (pixels per frame)
  const SCROLL_SPEED_MAX = 20;       // max scroll speed at edge
  
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
          console.log(`[SchedulingAssistant] Processing reservation: "${reservation.eventTitle}" - Event: ${reservation.originalStart} to ${reservation.originalEnd}, Blocked: ${reservation.effectiveStart} to ${reservation.effectiveEnd}`);
          const reservationId = reservation._id || reservation.id;

          // SKIP the current reservation being edited - it will be shown as the user event instead
          if (currentReservationId && reservationId === currentReservationId) {
            console.log(`[SchedulingAssistant] Skipping current reservation from backend: "${reservation.eventTitle}"`);
            return; // Skip this reservation
          }

          // Check if this event has been manually adjusted
          const manualAdjustment = manuallyAdjustedPositions.current[reservationId];

          let startTime, endTime, position;

          if (manualAdjustment) {
            // Use the manually adjusted position and times
            console.log(`[SchedulingAssistant] Using manually adjusted position for: "${reservation.eventTitle}"`);
            startTime = manualAdjustment.startTime;
            endTime = manualAdjustment.endTime;
            position = {
              top: manualAdjustment.top,
              height: (manualAdjustment.endTime - manualAdjustment.startTime) / (1000 * 60 * 60) * PIXELS_PER_HOUR
            };
          } else {
            // Use the effective blocking times from API (includes setup/teardown)
            startTime = new Date(reservation.effectiveStart);
            endTime = new Date(reservation.effectiveEnd);
            position = calculateEventPosition(startTime, endTime);
          }

          // Apply color variation based on event index
          const variedColor = adjustColorShade(roomColor, eventIndexInRoom);

          blocks.push({
            id: reservationId,
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

    // Create user event blocks (one per selected room)
    // This represents the event being created/edited across all locations
    if (eventStartTime && eventEndTime) {
      selectedRooms.forEach((room, roomIndex) => {
        // Check if user event has been manually dragged
        const adjustment = userEventAdjustment.current;

        let startTime, endTime, position;

        if (adjustment) {
          // Use the manually adjusted times
          startTime = adjustment.startTime;
          endTime = adjustment.endTime;
          position = calculateEventPosition(startTime, endTime);
        } else {
          // Calculate effective blocking times (setup to teardown)
          const eventStart = new Date(`${effectiveDate}T${eventStartTime}`);
          const eventEnd = new Date(`${effectiveDate}T${eventEndTime}`);

          // Use setupTime if provided, otherwise use event start
          if (setupTime) {
            const [setupHours, setupMinutes] = setupTime.split(':').map(Number);
            startTime = new Date(effectiveDate + 'T00:00:00');
            startTime.setHours(setupHours, setupMinutes, 0, 0);
          } else {
            startTime = eventStart;
          }

          // Use teardownTime if provided, otherwise use event end
          if (teardownTime) {
            const [teardownHours, teardownMinutes] = teardownTime.split(':').map(Number);
            endTime = new Date(effectiveDate + 'T00:00:00');
            endTime.setHours(teardownHours, teardownMinutes, 0, 0);
          } else {
            endTime = eventEnd;
          }

          position = calculateEventPosition(startTime, endTime);

          console.log(`[SchedulingAssistant] User event effective blocking - Event: ${eventStartTime} - ${eventEndTime}, Blocked: ${setupTime || eventStartTime} - ${teardownTime || eventEndTime}`);
        }

        const roomColor = locationColors[roomIndex % locationColors.length];

        blocks.push({
          id: 'user-event', // Same ID across all rooms so we can track it globally
          type: 'user-event',
          room,
          roomIndex,
          color: '#0078d4', // Bright blue for user event
          baseColor: '#0078d4',
          eventIndexInRoom: 0, // Always first in visual stacking
          title: eventTitle || 'Untitled Event',
          startTime,
          endTime,
          organizer: 'You',
          isUserEvent: true,
          isDraggable: true,
          isConflict: false, // Will be calculated below
          ...position
        });
      });
    }

    // Calculate conflicts between all events (including user event)
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

    // Recalculate stats - count only conflicts with user's event
    selectedRooms.forEach(room => {
      const roomBlocks = blocksByRoom[room._id] || [];

      // Find the user's event for this room
      const userEvent = roomBlocks.find(b => b.isUserEvent);

      if (userEvent) {
        // Count only events that conflict with the user's event
        const conflictsWithUserEvent = roomBlocks.filter(b =>
          !b.isUserEvent && // Don't count the user event itself
          b.startTime < userEvent.endTime &&
          b.endTime > userEvent.startTime
        );

        if (stats[room._id]) {
          stats[room._id].conflictCount = conflictsWithUserEvent.length;
          stats[room._id].eventCount = roomBlocks.length;
        }
      } else {
        // No user event - show all conflicts
        const conflictingEvents = roomBlocks.filter(b => b.isConflict);
        if (stats[room._id]) {
          stats[room._id].conflictCount = conflictingEvents.length;
          stats[room._id].eventCount = roomBlocks.length;
        }
      }
    });

    console.log(`[SchedulingAssistant] FINAL: Generated ${blocks.length} total event blocks`);
    blocks.forEach(b => console.log(`  - "${b.title}" at ${b.startTime.toLocaleTimeString()} (top: ${b.top}px)`));

    setEventBlocks(blocks);
    setRoomStats(stats);
  }, [availability, selectedRooms, effectiveDate, eventStartTime, eventEndTime, setupTime, teardownTime, doorOpenTime, doorCloseTime, eventTitle]);

  // Reset active room index when selected rooms change
  useEffect(() => {
    if (activeRoomIndex >= selectedRooms.length) {
      setActiveRoomIndex(0);
    }
  }, [selectedRooms, activeRoomIndex]);

  // Clear user event adjustment when time props change externally (user typed in form)
  useEffect(() => {
    // Clear the drag adjustment so we use the new prop values
    userEventAdjustment.current = null;
  }, [eventStartTime, eventEndTime, setupTime, teardownTime, doorOpenTime, doorCloseTime]);

  // Check if we need carousel arrows (more than 3 tabs)
  useEffect(() => {
    const needsCarousel = selectedRooms.length > 3;

    // For infinite carousel, always show both arrows when we have more than 3 tabs
    setCanScrollLeft(needsCarousel);
    setCanScrollRight(needsCarousel);

    console.log('[Carousel] Update:', {
      totalTabs: selectedRooms.length,
      activeIndex: activeRoomIndex,
      needsCarousel,
      canScrollLeft: needsCarousel,
      canScrollRight: needsCarousel
    });
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

  // Auto-scroll timeline when dragging near edges
  const startAutoScroll = (direction, speed) => {
    // Clear any existing auto-scroll
    if (autoScrollInterval.current) {
      cancelAnimationFrame(autoScrollInterval.current);
    }

    const scroll = () => {
      if (!timelineRef.current) return;

      const currentScroll = timelineRef.current.scrollTop;
      const maxScroll = timelineRef.current.scrollHeight - timelineRef.current.clientHeight;

      // Calculate new scroll position
      const newScroll = direction === 'up'
        ? Math.max(0, currentScroll - speed)
        : Math.min(maxScroll, currentScroll + speed);

      // Apply scroll
      timelineRef.current.scrollTop = newScroll;

      // Continue scrolling if not at limits
      if (newScroll > 0 && newScroll < maxScroll) {
        autoScrollInterval.current = requestAnimationFrame(scroll);
      }
    };

    autoScrollInterval.current = requestAnimationFrame(scroll);
  };

  const stopAutoScroll = () => {
    if (autoScrollInterval.current) {
      cancelAnimationFrame(autoScrollInterval.current);
      autoScrollInterval.current = null;
    }
  };

  // Navigate carousel left or right (infinite/circular)
  const scrollTabs = (direction) => {
    if (direction === 'left') {
      // Go left (wrap around to end if at beginning)
      setActiveRoomIndex((prev) => (prev - 1 + selectedRooms.length) % selectedRooms.length);
    } else if (direction === 'right') {
      // Go right (wrap around to beginning if at end)
      setActiveRoomIndex((prev) => (prev + 1) % selectedRooms.length);
    }
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

  // Handle drag start - allow only user events
  const handleEventDragStart = (e, block) => {
    // Block all backend events (only user event is draggable)
    if (!block.isUserEvent) {
      e.preventDefault();
      console.log('[Drag] BLOCKED - Backend event locked:', block.title);
      return;
    }

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

      // Auto-scroll detection: check if mouse is near top or bottom edge of timeline viewport
      if (timelineRef.current) {
        const rect = timelineRef.current.getBoundingClientRect();
        const mouseYRelativeToViewport = e.clientY - rect.top;

        // Check top hot zone
        if (mouseYRelativeToViewport < SCROLL_HOT_ZONE && mouseYRelativeToViewport >= 0) {
          // Calculate speed: closer to edge = faster scroll
          const edgeProximity = SCROLL_HOT_ZONE - mouseYRelativeToViewport;
          const speed = SCROLL_SPEED_BASE + (edgeProximity / SCROLL_HOT_ZONE) * (SCROLL_SPEED_MAX - SCROLL_SPEED_BASE);
          startAutoScroll('up', speed);
        }
        // Check bottom hot zone
        else if (mouseYRelativeToViewport > (rect.height - SCROLL_HOT_ZONE) && mouseYRelativeToViewport <= rect.height) {
          // Calculate speed: closer to edge = faster scroll
          const edgeProximity = mouseYRelativeToViewport - (rect.height - SCROLL_HOT_ZONE);
          const speed = SCROLL_SPEED_BASE + (edgeProximity / SCROLL_HOT_ZONE) * (SCROLL_SPEED_MAX - SCROLL_SPEED_BASE);
          startAutoScroll('down', speed);
        }
        // Not in hot zone - stop auto-scroll
        else {
          stopAutoScroll();
        }
      }
    }
  };

  // Handle drag end - update position and notify parent
  const handleEventDragEnd = () => {
    if (!draggingEventId) return;

    // Stop any active auto-scroll
    stopAutoScroll();

    const dragOffset = dragOffsets[draggingEventId] || 0;

    if (dragOffset !== 0) {
      const hourOffset = dragOffset / PIXELS_PER_HOUR;
      const draggedBlock = eventBlocks.find(b => b.id === draggingEventId);

      if (draggedBlock) {
        const durationMs = draggedBlock.endTime - draggedBlock.startTime;
        let newStartTime = new Date(draggedBlock.startTime.getTime() + hourOffset * 60 * 60 * 1000);
        let newEndTime = new Date(newStartTime.getTime() + durationMs);

        // Clamp times to stay within 0:00 - 23:59:59 on the effective date
        const dayStart = new Date(effectiveDate + 'T00:00:00');
        const dayEnd = new Date(effectiveDate + 'T23:59:59');

        // If event would start before midnight, clamp to midnight
        if (newStartTime < dayStart) {
          newStartTime = new Date(dayStart);
          newEndTime = new Date(newStartTime.getTime() + durationMs);
        }
        // If event would end after 23:59:59, clamp end to 23:59:59 and adjust start
        else if (newEndTime > dayEnd) {
          newEndTime = new Date(dayEnd);
          newStartTime = new Date(newEndTime.getTime() - durationMs);
          // If start is still before midnight after adjustment, clamp both
          if (newStartTime < dayStart) {
            newStartTime = new Date(dayStart);
            newEndTime = new Date(dayEnd);
          }
        }

        const formatTime = (date) => {
          const hours = String(date.getHours()).padStart(2, '0');
          const minutes = String(date.getMinutes()).padStart(2, '0');
          return `${hours}:${minutes}`;
        };

        console.log('[Drag] END - Event dragged:', {
          eventId: draggingEventId,
          isUserEvent: draggedBlock.isUserEvent,
          originalStart: formatTime(draggedBlock.startTime),
          originalEnd: formatTime(draggedBlock.endTime),
          newStart: formatTime(newStartTime),
          newEnd: formatTime(newEndTime),
          offsetHours: hourOffset.toFixed(2)
        });

        // Handle user event differently - sync across all tabs and update form
        if (draggedBlock.isUserEvent) {
          // Calculate ALL time offsets from the original event times
          const eventStart = new Date(`${effectiveDate}T${eventStartTime}`);
          const eventEnd = new Date(`${effectiveDate}T${eventEndTime}`);

          // Calculate the original blocking times (from state)
          const originalBlockStart = draggedBlock.startTime.getTime();
          const originalBlockEnd = draggedBlock.endTime.getTime();

          // Calculate durations/offsets for ALL time fields relative to event times
          const setupDuration = eventStart.getTime() - originalBlockStart;
          const teardownDuration = originalBlockEnd - eventEnd.getTime();

          // Calculate door time offsets (if they exist)
          let doorOpenDuration = 0;
          let doorCloseDuration = 0;

          if (doorOpenTime) {
            const doorOpen = new Date(`${effectiveDate}T${doorOpenTime}`);
            doorOpenDuration = eventStart.getTime() - doorOpen.getTime();
          }

          if (doorCloseTime) {
            const doorClose = new Date(`${effectiveDate}T${doorCloseTime}`);
            doorCloseDuration = doorClose.getTime() - eventEnd.getTime();
          }

          // Apply the same durations to the new position to get ALL new times
          const newEventStart = new Date(newStartTime.getTime() + setupDuration);
          const newEventEnd = new Date(newEndTime.getTime() - teardownDuration);

          // Calculate new door times by applying the same offsets
          const newDoorOpenTime = doorOpenTime ? new Date(newEventStart.getTime() - doorOpenDuration) : null;
          const newDoorCloseTime = doorCloseTime ? new Date(newEventEnd.getTime() + doorCloseDuration) : null;

          console.log('[Drag] User event time calculation:', {
            originalBlockStart: new Date(originalBlockStart).toLocaleTimeString(),
            originalBlockEnd: new Date(originalBlockEnd).toLocaleTimeString(),
            originalEventStart: eventStart.toLocaleTimeString(),
            originalEventEnd: eventEnd.toLocaleTimeString(),
            setupDuration: setupDuration / 1000 / 60,
            teardownDuration: teardownDuration / 1000 / 60,
            doorOpenDuration: doorOpenDuration / 1000 / 60,
            doorCloseDuration: doorCloseDuration / 1000 / 60,
            newBlockStart: newStartTime.toLocaleTimeString(),
            newBlockEnd: newEndTime.toLocaleTimeString(),
            newEventStart: newEventStart.toLocaleTimeString(),
            newEventEnd: newEventEnd.toLocaleTimeString(),
            newDoorOpen: newDoorOpenTime ? newDoorOpenTime.toLocaleTimeString() : 'N/A',
            newDoorClose: newDoorCloseTime ? newDoorCloseTime.toLocaleTimeString() : 'N/A'
          });

          // Store adjustment for user event globally
          userEventAdjustment.current = {
            startTime: newStartTime,
            endTime: newEndTime
          };

          // Notify parent form to update ALL time fields (event times AND all blocking/access times)
          if (onEventTimeChange) {
            const updatedTimes = {
              startTime: formatTime(newEventStart),
              endTime: formatTime(newEventEnd),
              setupTime: formatTime(newStartTime), // New blocking start
              teardownTime: formatTime(newEndTime) // New blocking end
            };

            // Only include door times if they were originally set
            if (doorOpenTime && newDoorOpenTime) {
              updatedTimes.doorOpenTime = formatTime(newDoorOpenTime);
            }
            if (doorCloseTime && newDoorCloseTime) {
              updatedTimes.doorCloseTime = formatTime(newDoorCloseTime);
            }

            onEventTimeChange(updatedTimes);
          }

          // Update all user event blocks across all rooms
          setEventBlocks(prev => prev.map(block => {
            if (block.isUserEvent) {
              const newTop = calculateEventPosition(newStartTime, newEndTime).top;
              return {
                ...block,
                top: newTop,
                startTime: newStartTime,
                endTime: newEndTime
              };
            }
            return block;
          }));
        } else {
          // Handle backend reservation events (existing behavior)
          const newTop = draggedBlock.top + dragOffset;

          // Store the manually adjusted position so it persists across re-renders
          manuallyAdjustedPositions.current[draggingEventId] = {
            top: newTop,
            startTime: newStartTime,
            endTime: newEndTime
          };

          // Update only this specific event block
          setEventBlocks(prev => prev.map(block => {
            if (block.id === draggingEventId) {
              return {
                ...block,
                top: newTop,
                startTime: newStartTime,
                endTime: newEndTime
              };
            }
            return block;
          }));
        }
      }
    }

    // Reset drag state
    setDraggingEventId(null);
    setDragOffsets({});
  };

  // Render event block with drag capability
  const renderEventBlock = (block, allVisibleBlocks) => {
    const eventIcon = block.isUserEvent ? '✏️' : (block.type === 'reservation' ? '📅' : '🗓️');
    const borderStyle = block.status === 'pending' ? 'dashed' : 'solid';
    const offset = getOverlapOffset(block, allVisibleBlocks);

    const isDragging = draggingEventId === block.id;
    const dragOffset = dragOffsets[block.id] || 0;

    // Calculate new position if dragging
    const top = block.top + (isDragging ? dragOffset : 0);

    // Determine if this is the user's event or a backend event
    const isUserEvent = block.isUserEvent;
    const isCurrentReservation = currentReservationId && block.id === currentReservationId;
    // Lock ALL backend events (only user event is draggable)
    const isLocked = !isUserEvent;

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

    // Visual styling - different for user event, current reservation, and locked events
    let opacity, cursor, boxShadow, backgroundColor, filter;

    if (isUserEvent) {
      // User event styling - bright, vibrant, always draggable
      opacity = hasConflict ? 0.95 : 0.9;
      cursor = isDragging ? 'grabbing' : 'grab';
      boxShadow = isDragging
        ? '0 8px 20px rgba(0, 120, 212, 0.5)'
        : '0 0 0 3px rgba(0, 120, 212, 0.5)'; // Blue glow for user event
      backgroundColor = block.color;
      filter = 'none';
    } else if (isLocked) {
      // Locked event styling - greyed out
      opacity = 0.75;
      cursor = 'not-allowed';
      boxShadow = 'none';
      backgroundColor = '#999999'; // Grey color
      filter = 'grayscale(100%)';
    } else {
      // Current reservation styling - normal/vibrant
      opacity = hasConflict ? 0.95 : 0.8;
      cursor = isDragging ? 'grabbing' : 'grab';
      boxShadow = isDragging
        ? '0 8px 20px rgba(0, 0, 0, 0.3)'
        : '0 0 0 3px rgba(0, 120, 212, 0.5)'; // Blue glow for current event
      backgroundColor = block.color;
      filter = 'none';
    }

    const conflictIndicator = hasConflict ? '⚠️ ' : '';
    const currentEventLabel = isCurrentReservation ? '✏️ ' : '';
    const lockedIcon = isLocked ? '🔒 ' : '';

    // Build title/tooltip based on event type and lock status
    let title;
    if (isUserEvent) {
      title = `✏️ ${hasConflict ? '⚠️ CONFLICT: ' : ''}${block.title}\n${formatTime(block.startTime)} - ${formatTime(block.endTime)}\n\n👆 Drag to reschedule${hasConflict ? '\n⚠️ Time conflicts with other events' : '\n✓ No conflicts at this time'}`;
    } else if (isLocked) {
      title = `🔒 ${block.title}\n${formatTime(block.startTime)} - ${formatTime(block.endTime)}\nOrganizer: ${block.organizer}\n\nThis event is locked - you can only drag your own reservation.`;
    } else {
      title = `${currentEventLabel}${hasConflict ? '⚠️ CONFLICT: ' : ''}${block.title}\n${formatTime(block.startTime)} - ${formatTime(block.endTime)}\nOrganizer: ${block.organizer}\n\n👆 Drag to reschedule your event${hasConflict ? '\n⚠️ Overlaps with other events' : '\n✓ No conflicts'}`;
    }

    return (
      <div
        key={`${block.id}-${block.roomIndex}`}
        className={`event-block ${block.type} ${hasConflict ? 'conflict' : 'non-conflict'} ${isLocked ? 'locked' : ''} ${isUserEvent ? 'user-event' : ''} ${isCurrentReservation ? 'current-event' : ''}`}
        style={{
          top: `${top}px`,
          height: `${block.height}px`,
          backgroundColor: backgroundColor,
          borderStyle: borderStyle,
          borderWidth: '2px',
          left: `${offset.left}%`,
          width: `${offset.width}%`,
          opacity: opacity,
          cursor: cursor,
          boxShadow: boxShadow,
          filter: filter,
          zIndex: isDragging ? 200 : (isUserEvent ? 15 : (isCurrentReservation ? 10 : 5)),
          transition: isDragging ? 'none' : 'all 0.2s'
        }}
        draggable={!isLocked}
        onDragStart={!isLocked ? (e) => handleEventDragStart(e, block) : undefined}
        onDrag={!isLocked ? handleEventDrag : undefined}
        onDragEnd={!isLocked ? handleEventDragEnd : undefined}
        onClick={() => handleEventBlockClick(block)}
        title={title}
      >
        <div className="event-block-content">
          <div className="event-block-header">
            <span className="event-icon">{lockedIcon}{currentEventLabel}{conflictIndicator}{eventIcon}</span>
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

  // Filter event blocks to show only the active room's events (memoized to prevent re-renders)
  const visibleEventBlocks = useMemo(() => {
    if (!activeRoom) return [];

    const filtered = eventBlocks.filter(block => block.room._id === activeRoom._id);

    console.log(`[SchedulingAssistant] VISIBLE for ${activeRoom.name}: ${filtered.length} events`);
    filtered.forEach(b => console.log(`  - "${b.title}" at ${b.startTime.toLocaleTimeString()}`));

    return filtered;
  }, [activeRoom, eventBlocks]);

  // Get stats for the active room
  const activeRoomStats = activeRoom ? roomStats[activeRoom._id] : { conflictCount: 0, eventCount: 0 };

  // Smart auto-scroll: center on the user's event time, or earliest conflicting event
  // NOTE: Only runs ONCE on initial load to avoid interfering with user's manual scrolling or dragging
  useEffect(() => {
    // Only auto-scroll once on initial load
    if (hasScrolledOnce.current) {
      return;
    }

    // Don't auto-scroll while dragging - it interferes with the user's interaction
    if (draggingEventId) {
      return;
    }

    if (!timelineRef.current || !eventBlocks.length) return;

    let targetHour = 8; // Default fallback to 8 AM

    // If we have a user's event time (from form), center on that
    if (eventStartTime) {
      const [hours, minutes] = eventStartTime.split(':').map(Number);
      targetHour = hours + minutes / 60;
      console.log(`[SchedulingAssistant] Initial auto-scroll to user event time: ${eventStartTime} (hour ${targetHour})`);
    } else if (visibleEventBlocks.length > 0) {
      // Otherwise, find earliest conflicting event, or just earliest event if no conflicts
      const conflictingEvents = visibleEventBlocks.filter(b => b.isConflict);
      const eventsToConsider = conflictingEvents.length > 0 ? conflictingEvents : visibleEventBlocks;

      const earliestEvent = eventsToConsider.reduce((earliest, block) => {
        return block.startTime < earliest.startTime ? block : earliest;
      }, eventsToConsider[0]);

      const dayStart = new Date(effectiveDate + 'T00:00:00');
      targetHour = (earliestEvent.startTime - dayStart) / (1000 * 60 * 60);
      console.log(`[SchedulingAssistant] Initial auto-scroll to earliest event: ${earliestEvent.title} (hour ${targetHour})`);
    }

    // Calculate scroll position to center the target hour
    const containerHeight = timelineRef.current.clientHeight;
    const visibleHours = containerHeight / PIXELS_PER_HOUR;
    const scrollPosition = (targetHour - visibleHours / 2) * PIXELS_PER_HOUR;

    // Ensure we don't scroll before the start or past the end
    const maxScroll = (END_HOUR - START_HOUR) * PIXELS_PER_HOUR - containerHeight;
    const clampedScroll = Math.max(0, Math.min(scrollPosition, maxScroll));

    timelineRef.current.scrollTop = clampedScroll;

    // Mark that we've scrolled once, so this doesn't run again
    hasScrolledOnce.current = true;
  }, [eventBlocks, activeRoomIndex, effectiveDate, draggingEventId, eventStartTime, visibleEventBlocks]); // Keep dependencies but early return prevents re-runs

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
        <div className="room-tabs-carousel">
          {canScrollLeft && (
            <button
              className="tab-scroll-btn tab-scroll-left"
              onClick={() => scrollTabs('left')}
              aria-label="Scroll tabs left"
            >
              ‹
            </button>
          )}

          <div className="room-tabs" ref={tabsContainerRef}>
            {/* Show up to 3 tabs, or all tabs if less than 3 */}
            {Array.from({ length: Math.min(3, selectedRooms.length) }).map((_, offset) => {
              const index = (activeRoomIndex + offset) % selectedRooms.length;
              const room = selectedRooms[index];
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
                <span
                  className="room-tab-badge"
                  style={{
                    backgroundColor: stats.conflictCount > 0 ? '#dc2626' : '#16a34a'
                  }}
                  title={stats.conflictCount > 0 ? `${stats.conflictCount} conflict${stats.conflictCount !== 1 ? 's' : ''}` : 'No conflicts'}
                >
                  {stats.conflictCount}
                </span>
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

          {canScrollRight && (
            <button
              className="tab-scroll-btn tab-scroll-right"
              onClick={() => scrollTabs('right')}
              aria-label="Scroll tabs right"
            >
              ›
            </button>
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

      {/* Summary */}
      {activeRoomStats && activeRoomStats.eventCount > 0 && (
        <div className="list-selection-summary">
          <strong>{activeRoomStats.eventCount}</strong> event{activeRoomStats.eventCount !== 1 ? 's' : ''}
          {activeRoomStats.conflictCount > 0 && ` (${activeRoomStats.conflictCount} conflict${activeRoomStats.conflictCount !== 1 ? 's' : ''})`}
        </div>
      )}

    </div>
  );
}