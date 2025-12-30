// src/components/SchedulingAssistant.jsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { logger } from '../utils/logger';
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
  availabilityLoading = false, // True when availability data is being fetched
  onTimeSlotClick,
  onRoomRemove, // Callback to remove a room from selection
  onEventTimeChange, // Callback to update event times when dragging
  currentReservationId, // ID of the current reservation being reviewed (only this one is draggable)
  onLockedEventClick, // Callback when a locked reservation event is clicked
  defaultCalendar = '', // Calendar name to display in header
  organizerName = '', // Organizer name for user events
  organizerEmail = '', // Organizer email for user events
  disabled = false // Read-only mode - disables all interactions
}) {
  const [eventBlocks, setEventBlocks] = useState([]);
  const [activeRoomIndex, setActiveRoomIndex] = useState(0); // Track which room tab is active
  const [roomStats, setRoomStats] = useState({}); // Stats per room: { roomId: { conflictCount, events } }
  const [draggingEventId, setDraggingEventId] = useState(null);
  const [dragOffsets, setDragOffsets] = useState({}); // Track drag offset for each event
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const timelineRef = useRef(null);
  const tabsContainerRef = useRef(null);
  const manuallyAdjustedPositions = useRef({}); // Track manually dragged positions: { eventId: { top, startTime, endTime } }
  const userEventAdjustment = useRef(null); // Track user event's dragged position: { startTime, endTime }
  const hasScrolledOnce = useRef(false); // Track if initial auto-scroll has happened
  const autoScrollInterval = useRef(null); // Track auto-scroll animation frame
  const dragClickOffset = useRef(0); // Track where on event block user clicked (for accurate cursor tracking)
  const liveDragOffset = useRef(0); // Track live drag offset during drag (for smooth CSS transform without re-renders)
  const lastMouseY = useRef(0); // Track last mouse Y position for position updates during auto-scroll

  const PIXELS_PER_HOUR = 50; // 50px per hour
  const START_HOUR = 0;  // Start at 12 AM (midnight)
  const END_HOUR = 24;   // End at 11:59 PM (full 24 hours scrollable)

  // Auto-scroll configuration for drag operations
  const SCROLL_HOT_ZONE = 70;        // pixels from edge to trigger auto-scroll (smaller for more natural feel)
  const SCROLL_SPEED_BASE = 8;       // base scroll speed (pixels per frame)
  const SCROLL_SPEED_MAX = 25;       // max scroll speed at edge
  
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
    // Don't clear events while loading new availability data - keep showing existing events
    if (availabilityLoading) {
      logger.debug('[SchedulingAssistant] Skipping update - availabilityLoading=true');
      return;
    }

    if (!availability || !selectedRooms.length) {
      logger.debug('[SchedulingAssistant] Clearing events - availability:', !!availability, 'rooms:', selectedRooms.length);
      setEventBlocks([]);
      setRoomStats({});
      return;
    }

    logger.debug('[SchedulingAssistant] Processing availability - Rooms:', selectedRooms.length, 'Date:', effectiveDate);

    const blocks = [];
    const stats = {};

    selectedRooms.forEach((room, roomIndex) => {
      const roomAvailability = availability.find(a => a.room._id === room._id);

      if (!roomAvailability || !roomAvailability.conflicts) {
        logger.debug(`[SchedulingAssistant] No availability data for room: ${room.name}`);
        stats[room._id] = { conflictCount: 0, eventCount: 0 };
        return;
      }

      logger.debug(`[SchedulingAssistant] Room: ${room.name} - Reservations: ${roomAvailability.conflicts.reservations?.length || 0}, Events: ${roomAvailability.conflicts.events?.length || 0}`);

      const roomColor = locationColors[roomIndex % locationColors.length];
      let roomEventCount = 0;
      let eventIndexInRoom = 0; // Track event order within room for color variation

      // Process reservations
      if (roomAvailability.conflicts.reservations) {
        roomAvailability.conflicts.reservations.forEach(reservation => {
          logger.debug(`[SchedulingAssistant] Processing reservation: "${reservation.eventTitle}" - Event: ${reservation.originalStart} to ${reservation.originalEnd}, Blocked: ${reservation.effectiveStart} to ${reservation.effectiveEnd}`);
          const reservationId = reservation._id || reservation.id;

          // SKIP the current reservation being edited - it will be shown as the user event instead
          if (currentReservationId && reservationId === currentReservationId) {
            logger.debug(`[SchedulingAssistant] Skipping current reservation from backend: "${reservation.eventTitle}"`);
            return; // Skip this reservation
          }

          // Check if this event has been manually adjusted
          const manualAdjustment = manuallyAdjustedPositions.current[reservationId];

          let startTime, endTime, position;

          if (manualAdjustment) {
            // Use the manually adjusted position and times
            logger.debug(`[SchedulingAssistant] Using manually adjusted position for: "${reservation.eventTitle}"`);
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
            organizer: reservation.roomReservationData?.requestedBy?.name || reservation.requesterName || reservation.roomReservationData?.requestedBy?.email || reservation.requesterEmail,
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
          // SKIP the current event being edited - it will be shown as the user event instead
          if (currentReservationId && event.id === currentReservationId) {
            logger.debug(`[SchedulingAssistant] Skipping current calendar event from backend: "${event.subject}"`);
            return; // Skip this event
          }

          // Use effectiveStart/effectiveEnd if available (includes setup/teardown), otherwise fall back to base times
          const startTime = new Date(event.effectiveStart || event.start.dateTime || event.start);
          const endTime = new Date(event.effectiveEnd || event.end.dateTime || event.end);

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

          logger.debug(`[SchedulingAssistant] User event effective blocking - Event: ${eventStartTime} - ${eventEndTime}, Blocked: ${setupTime || eventStartTime} - ${teardownTime || eventEndTime}`);
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
          organizer: organizerName || organizerEmail || 'You',
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

    logger.debug(`[SchedulingAssistant] FINAL: Generated ${blocks.length} total event blocks`);
    blocks.forEach(b => logger.debug(`  - "${b.title}" at ${b.startTime.toLocaleTimeString()} (top: ${b.top}px)`));

    setEventBlocks(blocks);
    setRoomStats(stats);
  }, [availability, availabilityLoading, selectedRooms, effectiveDate, eventStartTime, eventEndTime, setupTime, teardownTime, doorOpenTime, doorCloseTime, eventTitle]);

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

  // Reset scroll flag when current reservation changes (for navigation between reservations)
  useEffect(() => {
    hasScrolledOnce.current = false;
  }, [currentReservationId]);

  // Check if we need carousel arrows (more than 3 tabs)
  useEffect(() => {
    const needsCarousel = selectedRooms.length > 3;

    // For infinite carousel, always show both arrows when we have more than 3 tabs
    setCanScrollLeft(needsCarousel);
    setCanScrollRight(needsCarousel);

    logger.debug('[Carousel] Update:', {
      totalTabs: selectedRooms.length,
      activeIndex: activeRoomIndex,
      needsCarousel,
      canScrollLeft: needsCarousel,
      canScrollRight: needsCarousel
    });
  }, [selectedRooms, activeRoomIndex]);

  // Calculate event block position based on start/end times
  const calculateEventPosition = (startTime, endTime) => {
    // Calculate hours from start of day using local hours directly
    const startHours = startTime.getHours() + startTime.getMinutes() / 60;
    const endHours = endTime.getHours() + endTime.getMinutes() / 60;

    // Handle events that might span midnight (end time on next day)
    const adjustedEndHours = endHours < startHours ? endHours + 24 : endHours;

    // Clamp to visible day range
    const clampedStartHours = Math.max(START_HOUR, Math.min(END_HOUR, startHours));
    const clampedEndHours = Math.max(START_HOUR, Math.min(END_HOUR, adjustedEndHours));

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

  // Update event position based on mouse Y and current scroll
  // Called from both handleMouseMove AND auto-scroll loop
  const updateEventPosition = useCallback((mouseY) => {
    if (!draggingEventId) return;

    // Find the dragged event block
    const draggedBlock = eventBlocks.find(b => b.id === draggingEventId);
    if (!draggedBlock || !timelineRef.current) return;

    // Get timeline bounding rect
    const timelineRect = timelineRef.current.getBoundingClientRect();

    // Clamp cursor to viewport boundaries - cannot go outside timeline top/bottom
    const clampedMouseY = Math.max(
      timelineRect.top,
      Math.min(mouseY, timelineRect.bottom)
    );

    // Calculate cursor position within the timeline (accounting for scroll and zoom)
    const cursorYInViewport = clampedMouseY - timelineRect.top;
    const cursorYLogical = cursorYInViewport / 0.75; // Account for 75% zoom
    const currentScroll = timelineRef.current.scrollTop;
    const cursorYInTimeline = cursorYLogical + currentScroll;

    // Subtract the click offset to get where event top should be
    const desiredEventTop = cursorYInTimeline - dragClickOffset.current;

    // Calculate time boundaries
    const eventDurationMs = draggedBlock.endTime - draggedBlock.startTime;
    const desiredStartTimeMs = (desiredEventTop / PIXELS_PER_HOUR) * 60 * 60 * 1000;
    const dayStart = new Date(effectiveDate + 'T00:00:00');
    // Allow events to end at exactly midnight (24:00 = next day's 00:00)
    const dayEnd = new Date(effectiveDate + 'T00:00:00');
    dayEnd.setDate(dayEnd.getDate() + 1); // Next day's midnight
    const desiredStartTime = new Date(dayStart.getTime() + desiredStartTimeMs);
    const desiredEndTime = new Date(desiredStartTime.getTime() + eventDurationMs);

    // Calculate the maximum allowed position (event ending at midnight)
    const eventDurationHours = draggedBlock.height / PIXELS_PER_HOUR;
    const maxStartPixels = (24 - eventDurationHours) * PIXELS_PER_HOUR;

    // Clamp to time boundaries (12am to 12am next day)
    let clampedEventTop = desiredEventTop;
    const hitTopBoundary = desiredStartTime < dayStart;
    const hitBottomBoundary = desiredEndTime > dayEnd;

    // Check if cursor is at the edges of the viewport (user wants to go further)
    const cursorAtBottomEdge = mouseY >= timelineRect.bottom - 10; // 10px tolerance
    const cursorAtTopEdge = mouseY <= timelineRect.top + 10; // 10px tolerance

    // Check if scroll is at its limits
    const maxScroll = timelineRef.current.scrollHeight - timelineRef.current.clientHeight;
    const isScrollAtMax = currentScroll >= maxScroll - 1; // Small tolerance
    const isScrollAtMin = currentScroll <= 1;

    if (hitTopBoundary || (cursorAtTopEdge && isScrollAtMin)) {
      // Snap to 12 AM (start of day) when:
      // 1. Event would start before midnight, OR
      // 2. Cursor is at top edge AND scroll is at minimum (user is pushing up)
      clampedEventTop = 0;
    } else if (hitBottomBoundary || (cursorAtBottomEdge && isScrollAtMax)) {
      // Snap to maximum position (event ends at midnight) when:
      // 1. Event would extend past midnight, OR
      // 2. Cursor is at bottom edge AND scroll is maxed out (user is pushing down)
      clampedEventTop = maxStartPixels;
    }

    // Final clamp to ensure we stay within valid bounds
    clampedEventTop = Math.max(0, Math.min(clampedEventTop, maxStartPixels));

    // Calculate offset from original position
    const finalOffset = clampedEventTop - draggedBlock.top;
    liveDragOffset.current = finalOffset;

    // Apply CSS transform directly to DOM element (smooth, no React re-render)
    const draggedElement = document.querySelector(`[data-event-id="${draggingEventId}"]`);
    if (draggedElement) {
      draggedElement.style.transform = `translateY(${finalOffset}px)`;
      draggedElement.style.zIndex = '1000';
    }

    // Auto-scroll detection (only check, don't call startAutoScroll from here to avoid recursion)
    // Use clamped position for scroll detection
    const mouseYRelativeToViewport = clampedMouseY - timelineRect.top;
    const rectHeight = timelineRect.height;

    // Return scroll info for caller to handle
    return {
      hitTopBoundary,
      hitBottomBoundary,
      mouseYRelativeToViewport,
      rectHeight,
      isAtTopEdge: clampedMouseY === timelineRect.top,
      isAtBottomEdge: clampedMouseY === timelineRect.bottom
    };
  }, [draggingEventId, eventBlocks, timelineRef, effectiveDate, PIXELS_PER_HOUR]);

  // Auto-scroll timeline when dragging near edges
  const startAutoScroll = useCallback((direction, speed) => {
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

      // Update event position with stored mouse Y (keeps event following cursor during scroll)
      if (lastMouseY.current && draggingEventId) {
        updateEventPosition(lastMouseY.current);
      }

      // Continue scrolling if not at limits (use !== to handle edge values)
      const atScrollLimit = (direction === 'up' && newScroll === 0) ||
                           (direction === 'down' && newScroll === maxScroll);
      if (!atScrollLimit) {
        autoScrollInterval.current = requestAnimationFrame(scroll);
      }
    };

    autoScrollInterval.current = requestAnimationFrame(scroll);
  }, [timelineRef, updateEventPosition, draggingEventId]);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollInterval.current) {
      cancelAnimationFrame(autoScrollInterval.current);
      autoScrollInterval.current = null;
    }
  }, []);

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

  // Format time string from HH:MM (24-hour) to "H:MM AM/PM" (12-hour)
  const formatTimeString = (timeStr) => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:${minutes} ${period}`;
  };

  // Snap a Date to the nearest 15-minute increment
  const snapToQuarterHour = (date) => {
    const minutes = date.getMinutes();
    const roundedMinutes = Math.round(minutes / 15) * 15;

    const snapped = new Date(date);
    snapped.setMinutes(roundedMinutes);
    snapped.setSeconds(0);
    snapped.setMilliseconds(0);

    return snapped;
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

  // Handle mouse down - start drag (replaces HTML5 drag API)
  const handleMouseDown = (e, block) => {
    // Block all backend events (only user event is draggable)
    if (!block.isUserEvent) {
      logger.debug('[Drag] BLOCKED - Backend event locked:', block.title);
      return;
    }

    // Prevent text selection and other default behaviors
    e.preventDefault();
    e.stopPropagation();

    logger.debug('[Drag] START - event:', block.title);

    // Store where on the event block the user clicked (in logical coordinates)
    const eventElement = e.currentTarget;
    const eventRect = eventElement.getBoundingClientRect();
    const clickOffsetY = e.clientY - eventRect.top; // Viewport coordinates
    dragClickOffset.current = clickOffsetY / 0.75; // Convert to logical coordinates for zoom

    setDraggingEventId(block.id);

    // Reset offset for this event
    liveDragOffset.current = 0;
    lastMouseY.current = e.clientY; // Initialize mouse position
    setDragOffsets(prev => ({
      ...prev,
      [block.id]: 0
    }));

    // Prevent modal scrolling during drag and disable text selection
    const modal = document.querySelector('.review-modal');
    if (modal) modal.classList.add('dragging-timeline');
  };

  // Handle mouse move - store position and update event
  const handleMouseMove = useCallback((e) => {
    if (!draggingEventId) return;

    // Prevent default drag behavior
    e.preventDefault();

    // Store mouse Y for use during auto-scroll
    lastMouseY.current = e.clientY;

    // Update event position and get scroll info
    const scrollInfo = updateEventPosition(e.clientY);
    if (!scrollInfo) return;

    const { hitTopBoundary, hitBottomBoundary, mouseYRelativeToViewport, rectHeight, isAtTopEdge, isAtBottomEdge } = scrollInfo;

    // Handle auto-scroll based on cursor position near edges
    // Don't block auto-scroll based on time boundary - user may need to scroll to see final position
    if (isAtTopEdge || mouseYRelativeToViewport < SCROLL_HOT_ZONE) {
      // Near or at top edge - scroll up
      let speed;
      if (isAtTopEdge) {
        // Cursor clamped at top edge - use max speed
        speed = SCROLL_SPEED_MAX;
      } else {
        // Normal hot zone behavior
        const edgeProximity = SCROLL_HOT_ZONE - mouseYRelativeToViewport;
        const normalizedProximity = edgeProximity / SCROLL_HOT_ZONE;
        const easedProximity = Math.pow(normalizedProximity, 2);
        speed = SCROLL_SPEED_BASE + easedProximity * (SCROLL_SPEED_MAX - SCROLL_SPEED_BASE);
      }
      startAutoScroll('up', speed);
    }
    else if (isAtBottomEdge || mouseYRelativeToViewport > (rectHeight - SCROLL_HOT_ZONE)) {
      // Near or at bottom edge - scroll down
      let speed;
      if (isAtBottomEdge) {
        // Cursor clamped at bottom edge - use max speed
        speed = SCROLL_SPEED_MAX;
      } else {
        // Normal hot zone behavior
        const edgeProximity = mouseYRelativeToViewport - (rectHeight - SCROLL_HOT_ZONE);
        const normalizedProximity = edgeProximity / SCROLL_HOT_ZONE;
        const easedProximity = Math.pow(normalizedProximity, 2);
        speed = SCROLL_SPEED_BASE + easedProximity * (SCROLL_SPEED_MAX - SCROLL_SPEED_BASE);
      }
      startAutoScroll('down', speed);
    }
    else {
      stopAutoScroll();
    }
  }, [draggingEventId, updateEventPosition, SCROLL_HOT_ZONE, SCROLL_SPEED_BASE, SCROLL_SPEED_MAX, startAutoScroll, stopAutoScroll]);

  // Handle mouse up - end drag (replaces HTML5 drag API)
  const handleMouseUp = useCallback(() => {
    if (!draggingEventId) return;

    // Stop any active auto-scroll
    stopAutoScroll();

    // Get the live drag offset from ref (used during drag)
    const dragOffset = liveDragOffset.current;

    // Clean up CSS transform applied during drag
    const draggedElement = document.querySelector(`[data-event-id="${draggingEventId}"]`);
    if (draggedElement) {
      draggedElement.style.transform = '';
      draggedElement.style.zIndex = '';
    }

    if (dragOffset !== 0) {
      const hourOffset = dragOffset / PIXELS_PER_HOUR;
      const draggedBlock = eventBlocks.find(b => b.id === draggingEventId);

      if (draggedBlock) {
        const durationMs = draggedBlock.endTime - draggedBlock.startTime;
        let newStartTime = new Date(draggedBlock.startTime.getTime() + hourOffset * 60 * 60 * 1000);
        // Snap to nearest 15-minute increment
        newStartTime = snapToQuarterHour(newStartTime);
        let newEndTime = new Date(newStartTime.getTime() + durationMs);

        // Clamp times to stay within 0:00 - 24:00 (midnight to midnight) on the effective date
        const dayStart = new Date(effectiveDate + 'T00:00:00');
        const dayEnd = new Date(effectiveDate + 'T00:00:00');
        dayEnd.setDate(dayEnd.getDate() + 1); // Next day's midnight (24:00)

        // If event would start before midnight, clamp to midnight
        if (newStartTime < dayStart) {
          newStartTime = new Date(dayStart);
          newEndTime = new Date(newStartTime.getTime() + durationMs);
        }
        // If event would end after midnight, clamp end to midnight and adjust start
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

        logger.debug('[Drag] END - Event dragged:', {
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

          logger.debug('[Drag] User event time calculation:', {
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

    // Re-enable modal scrolling
    const modal = document.querySelector('.review-modal');
    if (modal) modal.classList.remove('dragging-timeline');

    // Reset drag state
    liveDragOffset.current = 0;
    lastMouseY.current = 0;
    setDraggingEventId(null);
    setDragOffsets({});
  }, [draggingEventId, dragOffsets, eventBlocks, PIXELS_PER_HOUR, effectiveDate, eventStartTime, eventEndTime, setupTime, teardownTime, doorOpenTime, doorCloseTime, onEventTimeChange, currentReservationId, stopAutoScroll, setEventBlocks, setDraggingEventId, setDragOffsets, calculateEventPosition, END_HOUR, START_HOUR]);

  // Global mouse event listeners for drag (replaces HTML5 drag API)
  useEffect(() => {
    if (draggingEventId) {
      // Attach global listeners when dragging starts
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      logger.debug('[Drag] Global mouse listeners attached');

      return () => {
        // Clean up listeners when dragging stops
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        logger.debug('[Drag] Global mouse listeners removed');
      };
    }
  }, [draggingEventId, handleMouseMove, handleMouseUp]);

  // Render event block with drag capability
  const renderEventBlock = (block, allVisibleBlocks) => {
    const eventIcon = block.isUserEvent ? '✏️' : (block.type === 'reservation' ? '📅' : '🗓️');
    const borderStyle = block.status === 'pending' ? 'dashed' : 'solid';
    const offset = getOverlapOffset(block, allVisibleBlocks);

    const isDragging = draggingEventId === block.id;
    const dragOffset = dragOffsets[block.id] || 0;

    // Calculate new position - during drag, CSS transform handles position (not top style)
    // Only apply dragOffset when NOT actively dragging (for final position after drop)
    const top = block.top + (!isDragging && dragOffset ? dragOffset : 0);

    // Determine if this is the user's event or a backend event
    const isUserEvent = block.isUserEvent;
    const isCurrentReservation = currentReservationId && block.id === currentReservationId;
    // Lock ALL backend events (only user events are draggable)
    const isLocked = !isUserEvent;

    // Check for conflicts at current dragged position
    let hasConflict = block.isConflict;
    if (isDragging) {
      // Use live drag offset from ref (updated during drag without re-renders)
      const currentDragOffset = liveDragOffset.current;
      const hourOffset = currentDragOffset / PIXELS_PER_HOUR;
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
      // User event styling - bright, vibrant, draggable (unless disabled)
      opacity = hasConflict ? 0.95 : 0.9;
      cursor = disabled ? 'default' : (isDragging ? 'grabbing' : 'grab');
      boxShadow = isDragging
        ? '0 8px 20px rgba(0, 120, 212, 0.5)'
        : '0 0 0 3px rgba(0, 120, 212, 0.5)'; // Blue glow for user event
      backgroundColor = block.color;
      filter = 'none';
    } else if (isLocked) {
      // Locked event styling - greyed out with nav button
      opacity = 0.75;
      cursor = 'not-allowed';
      boxShadow = 'none';
      backgroundColor = '#999999'; // Grey color
      filter = 'grayscale(100%)';
    } else {
      // Current reservation styling - normal/vibrant (unless disabled)
      opacity = hasConflict ? 0.95 : 0.8;
      cursor = disabled ? 'default' : (isDragging ? 'grabbing' : 'grab');
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
      // Different message for reservations (with nav button) vs calendar events (no nav button)
      if (block.type === 'reservation') {
        title = `🔒 ${block.title}\n${formatTime(block.startTime)} - ${formatTime(block.endTime)}\nOrganizer: ${block.organizer}\n\n→ Click the arrow button to open this reservation\n(This event is locked - you can only drag your own reservation)`;
      } else {
        title = `🔒 ${block.title}\n${formatTime(block.startTime)} - ${formatTime(block.endTime)}\nOrganizer: ${block.organizer}\n\nThis calendar event is locked - you can only drag your own reservation.`;
      }
    } else {
      title = `${currentEventLabel}${hasConflict ? '⚠️ CONFLICT: ' : ''}${block.title}\n${formatTime(block.startTime)} - ${formatTime(block.endTime)}\nOrganizer: ${block.organizer}\n\n👆 Drag to reschedule your event${hasConflict ? '\n⚠️ Overlaps with other events' : '\n✓ No conflicts'}`;
    }

    return (
      <div
        key={`${block.id}-${block.roomIndex}`}
        data-event-id={block.id}
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
        onMouseDown={!isLocked && !disabled ? (e) => handleMouseDown(e, block) : undefined}
        title={title}
      >
        <div className="event-block-content">
          <div className="event-block-header">
            <span className="event-icon">{lockedIcon}{currentEventLabel}{conflictIndicator}{eventIcon}</span>
            <span className="event-title">{block.title}</span>
            {/* Navigation button for locked reservations */}
            {isLocked && block.type === 'reservation' && onLockedEventClick && (
              <button
                type="button"
                className="event-nav-button"
                onClick={(e) => handleNavigateToEvent(e, block.id)}
                title="Open this reservation"
              >
                →
              </button>
            )}
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

    logger.debug(`[SchedulingAssistant] VISIBLE for ${activeRoom.name}: ${filtered.length} events`);
    filtered.forEach(b => logger.debug(`  - "${b.title}" at ${b.startTime.toLocaleTimeString()}`));

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
      logger.debug(`[SchedulingAssistant] Initial auto-scroll to user event time: ${eventStartTime} (hour ${targetHour})`);
    } else if (visibleEventBlocks.length > 0) {
      // Otherwise, find earliest conflicting event, or just earliest event if no conflicts
      const conflictingEvents = visibleEventBlocks.filter(b => b.isConflict);
      const eventsToConsider = conflictingEvents.length > 0 ? conflictingEvents : visibleEventBlocks;

      const earliestEvent = eventsToConsider.reduce((earliest, block) => {
        return block.startTime < earliest.startTime ? block : earliest;
      }, eventsToConsider[0]);

      const dayStart = new Date(effectiveDate + 'T00:00:00');
      targetHour = (earliestEvent.startTime - dayStart) / (1000 * 60 * 60);
      logger.debug(`[SchedulingAssistant] Initial auto-scroll to earliest event: ${earliestEvent.title} (hour ${targetHour})`);
    }

    // Calculate scroll position to show event near top with 2 hours of context before it
    const hoursBeforeEvent = 2; // Show 2 hours before the event
    const scrollPosition = (targetHour - hoursBeforeEvent) * PIXELS_PER_HOUR;

    // Ensure we don't scroll before the start or past the end
    const containerHeight = timelineRef.current.clientHeight;
    const maxScroll = (END_HOUR - START_HOUR) * PIXELS_PER_HOUR - containerHeight;
    const clampedScroll = Math.max(0, Math.min(scrollPosition, maxScroll));

    timelineRef.current.scrollTop = clampedScroll;

    // Mark that we've scrolled once, so this doesn't run again
    hasScrolledOnce.current = true;
  }, [eventBlocks, activeRoomIndex, effectiveDate, draggingEventId, eventStartTime, visibleEventBlocks]); // Keep dependencies but early return prevents re-runs

  // Handle navigation button click for locked events
  const handleNavigateToEvent = (e, reservationId) => {
    e.stopPropagation(); // Prevent event block click
    logger.debug('[SchedulingAssistant] Navigate button clicked for reservation:', reservationId);

    if (onLockedEventClick) {
      onLockedEventClick(reservationId);
    }
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
          <h3>📅 Selected Rooms & Scheduling Assistant</h3>
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
        <h3>
          🗓️ Selected Rooms & Scheduling Assistant
          {defaultCalendar && (
            <span className="calendar-name-badge"> ({defaultCalendar})</span>
          )}
        </h3>
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
          {canScrollLeft && !disabled && (
            <button
              type="button"
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
                type="button"
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
                {!disabled && (
                  <span
                    className="room-tab-close"
                    onClick={handleCloseTab}
                    title={`Remove ${room.name}`}
                  >
                    ×
                  </span>
                )}
              </button>
            );
          })}
          </div>

          {canScrollRight && !disabled && (
            <button
              type="button"
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
        <div ref={timelineRef} className={`timeline-container ${draggingEventId ? 'dragging-active' : ''}`}>
          {/* Time grid background */}
          <div className="timeline-grid">
            <div className="time-labels">
              {Array.from({ length: END_HOUR - START_HOUR }).map((_, index) => {
                const hour = START_HOUR + index;
                return (
                  <div
                    key={hour}
                    className="time-label"
                    style={{
                      position: 'absolute',
                      top: `${index * PIXELS_PER_HOUR}px`,
                      height: `${PIXELS_PER_HOUR}px`,
                      left: 0,
                      right: 0
                    }}
                    onClick={() => !disabled && handleTimeSlotClick(hour)}
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

              {/* Quarter-hour lines (15-minute increments) */}
              {Array.from({ length: (END_HOUR - START_HOUR) * 4 }).map((_, index) => {
                // Skip lines that fall on the hour (already drawn above)
                if (index % 4 === 0) return null;

                const quarterHourPosition = index * (PIXELS_PER_HOUR / 4);
                return (
                  <div
                    key={`quarter-${index}`}
                    className="quarter-hour-line"
                    style={{
                      top: `${quarterHourPosition}px`
                    }}
                  />
                );
              })}

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