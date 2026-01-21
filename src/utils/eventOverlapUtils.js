// src/utils/eventOverlapUtils.js

/**
 * Check if two time ranges overlap
 * @param {Date} start1 - Start time of first event
 * @param {Date} end1 - End time of first event
 * @param {Date} start2 - Start time of second event
 * @param {Date} end2 - End time of second event
 * @returns {boolean} - True if events overlap
 */
export const doEventsOverlap = (start1, end1, start2, end2) => {
  return start1 < end2 && end1 > start2;
};

/**
 * Get the actual start and end times including setup/teardown
 * @param {Object} event - Event object
 * @returns {Object} - { start: Date, end: Date }
 */
export const getEventBounds = (event) => {
  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  
  // Include setup time before event
  if (event.setupMinutes && event.setupMinutes > 0) {
    start.setMinutes(start.getMinutes() - event.setupMinutes);
  }
  
  // Include teardown time after event
  if (event.teardownMinutes && event.teardownMinutes > 0) {
    end.setMinutes(end.getMinutes() + event.teardownMinutes);
  }
  
  return { start, end };
};

/**
 * Group overlapping events together
 * @param {Array} events - Array of events to process
 * @returns {Array} - Array of event groups where each group contains overlapping events
 */
export const groupOverlappingEvents = (events) => {
  if (!events || events.length === 0) return [];
  
  // Sort events by start time
  const sortedEvents = [...events].sort((a, b) => {
    const aStart = new Date(a.start.dateTime);
    const bStart = new Date(b.start.dateTime);
    return aStart - bStart;
  });
  
  const groups = [];
  let currentGroup = [sortedEvents[0]];
  
  for (let i = 1; i < sortedEvents.length; i++) {
    const event = sortedEvents[i];
    let overlapsWithGroup = false;
    
    // Check if this event overlaps with any event in the current group
    for (const groupEvent of currentGroup) {
      const bounds1 = getEventBounds(groupEvent);
      const bounds2 = getEventBounds(event);
      
      if (doEventsOverlap(bounds1.start, bounds1.end, bounds2.start, bounds2.end)) {
        overlapsWithGroup = true;
        break;
      }
    }
    
    if (overlapsWithGroup) {
      currentGroup.push(event);
    } else {
      // Start a new group
      groups.push(currentGroup);
      currentGroup = [event];
    }
  }
  
  // Add the last group
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }
  
  return groups;
};

/**
 * Calculate overlap percentage between two events
 * @param {Object} event1 - First event
 * @param {Object} event2 - Second event
 * @returns {Object} - Overlap percentages for both events
 */
export const calculateOverlapPercentages = (event1, event2) => {
  const start1 = new Date(event1.start.dateTime);
  const end1 = new Date(event1.end.dateTime);
  const start2 = new Date(event2.start.dateTime);
  const end2 = new Date(event2.end.dateTime);
  
  // Find overlap region
  const overlapStart = Math.max(start1.getTime(), start2.getTime());
  const overlapEnd = Math.min(end1.getTime(), end2.getTime());
  
  if (overlapStart >= overlapEnd) {
    return { event1: 0, event2: 0 };
  }
  
  // Calculate durations
  const duration1 = end1 - start1;
  const duration2 = end2 - start2;
  const overlapDuration = overlapEnd - overlapStart;
  
  // Calculate percentages
  const event1Percentage = (overlapDuration / duration1) * 100;
  const event2Percentage = (overlapDuration / duration2) * 100;
  
  // Calculate position of overlap within each event
  const event1OverlapStart = ((overlapStart - start1) / duration1) * 100;
  const event2OverlapStart = ((overlapStart - start2) / duration2) * 100;
  
  return {
    event1: {
      percentage: event1Percentage,
      startPercent: event1OverlapStart,
      endPercent: event1OverlapStart + event1Percentage
    },
    event2: {
      percentage: event2Percentage,
      startPercent: event2OverlapStart,
      endPercent: event2OverlapStart + event2Percentage
    }
  };
};

/**
 * Calculate layout positions for overlapping events
 * @param {Array} eventGroup - Group of overlapping events
 * @returns {Array} - Array of events with layout properties added
 */
export const calculateEventPositions = (eventGroup) => {
  if (!eventGroup || eventGroup.length === 0) return [];
  
  // Sort by start time, then by duration (longer events first)
  const sorted = [...eventGroup].sort((a, b) => {
    const aStart = new Date(a.start.dateTime);
    const bStart = new Date(b.start.dateTime);
    const aDuration = new Date(a.end.dateTime) - aStart;
    const bDuration = new Date(b.end.dateTime) - bStart;
    
    if (aStart.getTime() === bStart.getTime()) {
      return bDuration - aDuration; // Longer duration first
    }
    return aStart - bStart;
  });
  
  // Stack events by start time instead of columns
  const processedEvents = sorted.map((event, index) => {
    const eventWithLayout = {
      ...event,
      stackOrder: index,
      totalStacks: sorted.length,
      overlapRegions: []
    };
    
    // Calculate overlap regions with other events
    sorted.forEach((otherEvent, otherIndex) => {
      if (index !== otherIndex) {
        const overlapInfo = calculateOverlapPercentages(event, otherEvent);
        if (overlapInfo.event1.percentage > 0) {
          eventWithLayout.overlapRegions.push({
            eventId: otherEvent.id,
            startPercent: overlapInfo.event1.startPercent,
            endPercent: overlapInfo.event1.endPercent,
            percentage: overlapInfo.event1.percentage
          });
        }
      }
    });
    
    return eventWithLayout;
  });
  
  return processedEvents;
};

/**
 * Process all events and add layout information
 * @param {Array} events - All events to process
 * @returns {Array} - Events with layout information added
 */
export const processEventsForOverlap = (events) => {
  if (!events || events.length === 0) return [];
  
  const groups = groupOverlappingEvents(events);
  const processedEvents = [];
  
  groups.forEach(group => {
    if (group.length === 1) {
      // No overlap
      processedEvents.push({
        ...group[0],
        stackOrder: 0,
        totalStacks: 1,
        overlapRegions: [],
        width: '100%',
        left: '0%'
      });
    } else {
      // Calculate positions for overlapping events
      const positioned = calculateEventPositions(group);
      processedEvents.push(...positioned);
    }
  });
  
  return processedEvents;
};

/**
 * Get overlap type for styling purposes
 * @param {Object} event - Event object
 * @returns {string} - 'none', 'setup-teardown', 'main-event', or 'both'
 */
export const getOverlapType = (event, allEvents) => {
  const bounds = getEventBounds(event);
  const mainStart = new Date(event.start.dateTime);
  const mainEnd = new Date(event.end.dateTime);
  
  let hasSetupOverlap = false;
  let hasMainOverlap = false;
  let hasTeardownOverlap = false;
  
  allEvents.forEach(otherEvent => {
    if (otherEvent.id === event.id) return;
    
    const otherBounds = getEventBounds(otherEvent);
    
    // Check setup time overlap
    if (event.setupMinutes > 0 && doEventsOverlap(bounds.start, mainStart, otherBounds.start, otherBounds.end)) {
      hasSetupOverlap = true;
    }
    
    // Check main event overlap
    if (doEventsOverlap(mainStart, mainEnd, otherBounds.start, otherBounds.end)) {
      hasMainOverlap = true;
    }
    
    // Check teardown time overlap
    if (event.teardownMinutes > 0 && doEventsOverlap(mainEnd, bounds.end, otherBounds.start, otherBounds.end)) {
      hasTeardownOverlap = true;
    }
  });
  
  if (hasMainOverlap) return 'main-event';
  if (hasSetupOverlap || hasTeardownOverlap) return 'setup-teardown';
  return 'none';
};

/**
 * Check if two events are in conflict (considering isAllowedConcurrent flag)
 * An overlap is only considered a conflict if BOTH events have isAllowedConcurrent: false
 *
 * @param {Object} event1 - First event object (must have start, end, and optionally isAllowedConcurrent)
 * @param {Object} event2 - Second event object (must have start, end, and optionally isAllowedConcurrent)
 * @returns {boolean} - True if events are in conflict (overlap AND both disallow concurrent)
 */
export const areEventsConflicting = (event1, event2) => {
  // Get bounds for both events (includes setup/teardown times)
  const bounds1 = getEventBounds(event1);
  const bounds2 = getEventBounds(event2);

  // Check if events overlap in time
  const overlaps = doEventsOverlap(bounds1.start, bounds1.end, bounds2.start, bounds2.end);

  if (!overlaps) {
    return false;
  }

  // Events overlap - but only a conflict if BOTH disallow concurrent scheduling
  // If either event allows concurrent, they can coexist without conflict
  const event1AllowsConcurrent = event1.isAllowedConcurrent ?? false;
  const event2AllowsConcurrent = event2.isAllowedConcurrent ?? false;

  return !event1AllowsConcurrent && !event2AllowsConcurrent;
};