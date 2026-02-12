import React, { memo, useMemo } from 'react';
import { processEventsForOverlap } from '../utils/eventOverlapUtils';
import { logger } from '../utils/logger';
import { useTimezone } from '../context/TimezoneContext';
import { formatEventTime, ensureUTCFormat } from '../utils/timezoneUtils';
import { sortEventsByStartTime } from '../utils/eventTransformers';

const WeekView = memo(({
  // Props
  groupBy,
  outlookCategories,
  selectedCategories,
  availableLocations,
  selectedLocations,
  getDaysInRange,
  formatDateHeader,
  getEventPosition,
  filteredEvents,
  locationGroups, // Use pre-computed location groups from Calendar.jsx
  getCategoryColor,
  getLocationColor,
  handleDayCellClick,
  handleEventClick,
  renderEventContent,
  viewType,
  dynamicCategories,
  // Add these new props from Calendar.jsx
  isEventVirtual,
  isUnspecifiedLocation,
  hasPhysicalLocation,
  isVirtualLocation,
  dynamicLocations,
  showRegistrationTimes,
  handleLocationRowClick // New prop for location timeline modal
}) => {
  // Get user's timezone preference from context
  const { userTimezone } = useTimezone();

  // Check if any filtered events have registration properties
  if (filteredEvents && filteredEvents.length > 0) {
    const eventsWithRegistration = filteredEvents.filter(event => 
      event.hasRegistrationEvent || event.registrationStart || event.registrationEnd
    );
    // Events with registration properties check completed
    
    // Sample event structure check completed
  }
  
  // Helper function to get the display location for an event
  const getEventDisplayLocation = (event) => {
    // Check for offsite events first
    if (event.isOffsite) {
      return 'Offsite';
    }

    // Check if event has no location
    if (isUnspecifiedLocation(event)) {
      return 'Unspecified';
    }

    // Get location text and parse it
    const locationText = event.location?.displayName?.trim() || '';
    const eventLocations = locationText
      .split(/[;,]/)
      .map(loc => loc.trim())
      // Filter out empty strings and "Unspecified" placeholder
      .filter(loc => loc.length > 0 && loc !== 'Unspecified');

    // If no valid locations after parsing, treat as Unspecified
    if (eventLocations.length === 0) {
      return 'Unspecified';
    }

    // Return the first location
    return eventLocations[0];
  };
  
  // Get categories/locations that actually have events to display
  const activeGroups = useMemo(() => {
    if (groupBy === 'categories') {
      // Get categories that have events and are selected
      const categoriesWithEvents = new Set();

      filteredEvents.forEach(event => {
        // Check calendarData.categories first (authoritative), then top-level, then graphData fallback
        const categories = event.calendarData?.categories || event.categories || event.graphData?.categories || (event.category ? [event.category] : ['Uncategorized']);
        const category = categories[0] || 'Uncategorized';
        if (selectedCategories.includes(category)) {
          categoriesWithEvents.add(category);
        }
      });

      // Return sorted array of categories that have events
      return Array.from(categoriesWithEvents).sort();
    } else {
      // Use pre-computed location groups from Calendar.jsx
      // Filter to only show groups that have events
      return Object.keys(locationGroups).filter(groupName => {
        const groupData = locationGroups[groupName];
        return groupData && groupData.events && groupData.events.length > 0;
      }).sort();
    }
  }, [groupBy, filteredEvents, selectedCategories, locationGroups]);

  return (
    <>
      {/* Grid Header (Days) */}
      <div className="grid-header">
        <div className="grid-cell header-cell category-header">
          {groupBy === 'categories' ? 'Categories' : 'Locations'}
        </div>
        {getDaysInRange().map((day, index) => (
          <div key={index} className="grid-cell header-cell">
            {formatDateHeader(day)}
          </div>
        ))}
      </div>

      {/* Dynamic Grid Rows (Only categories/locations with events) */}
      {activeGroups.length > 0 ? (
        activeGroups.map(group => (
          <div key={group} className="grid-row">
            <div
              className="grid-cell category-cell"
              onClick={() => {
                // Only make clickable when grouping by locations
                if (groupBy === 'locations' && handleLocationRowClick) {
                  const days = getDaysInRange();
                  if (days.length > 0) {
                    // Pass locationId from the group data
                    const groupData = locationGroups[group];
                    const locationId = groupData?.locationId;
                    handleLocationRowClick(group, days, 'week', locationId);
                  }
                }
              }}
              style={{
                cursor: groupBy === 'locations' && handleLocationRowClick ? 'pointer' : 'default'
              }}
              title={groupBy === 'locations' && handleLocationRowClick ? 'Click to view timeline' : ''}
            >
              {/* Add color indicator */}
              <div
                className="category-color"
                style={{
                  display: 'inline-block',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  marginRight: '4px',
                  flexShrink: 0,
                  backgroundColor: groupBy === 'categories'
                    ? getCategoryColor(group)
                    : getLocationColor(group)
                }}
              />
              <span style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                minWidth: 0
              }}>{group}</span>
            </div>
            
            {/* Days */}
            {getDaysInRange().map((day, dayIndex) => (
              <div 
                key={dayIndex} 
                className="grid-cell day-cell"
                onClick={() => handleDayCellClick(
                  day, 
                  groupBy === 'categories' ? group : null,
                  groupBy === 'locations' ? group : null
                )}
              >
                {/* Events for this group and day */}
                {(() => {
                  // Filter events for this group and day
                  let groupEvents;
                  if (groupBy === 'categories') {
                    // For categories, filter from filteredEvents
                    groupEvents = filteredEvents.filter(event => {
                      // Check calendarData.categories first (authoritative), then top-level, then graphData fallback
                      const categories = event.calendarData?.categories || event.categories || event.graphData?.categories || (event.category ? [event.category] : ['Uncategorized']);
                      const category = categories[0] || 'Uncategorized';
                      return category === group;
                    });
                  } else {
                    // For locations, use pre-computed locationGroups
                    const groupData = locationGroups[group];
                    groupEvents = groupData?.events || [];
                  }

                  // Filter to events for this specific day
                  const dayEvents = groupEvents.filter(event => {
                    return getEventPosition(event, day);
                  });

                  // Sort events by start time
                  const sortedEvents = sortEventsByStartTime(dayEvents);

                  // Calculate overlap counts for each event
                  const getOverlapInfo = (event, allEvents) => {
                    const eventStart = new Date(event.start?.dateTime || event.startDateTime);
                    const eventEnd = new Date(event.end?.dateTime || event.endDateTime);

                    const overlapping = allEvents.filter(other => {
                      if (other.eventId === event.eventId || other.id === event.id) return false;
                      const otherStart = new Date(other.start?.dateTime || other.startDateTime);
                      const otherEnd = new Date(other.end?.dateTime || other.endDateTime);
                      const timeOverlaps = eventStart < otherEnd && eventEnd > otherStart;

                      if (!timeOverlaps) return false;

                      // When grouped by categories, only same physical location = conflict
                      if (groupBy === 'categories') {
                        const eventLocation = event.location?.displayName || '';
                        const otherLocation = other.location?.displayName || '';

                        // Only consider it a conflict if both have the same specific physical location
                        const eventHasLocation = eventLocation && eventLocation !== 'Unspecified';
                        const otherHasLocation = otherLocation && otherLocation !== 'Unspecified';

                        // No conflict unless both have the same specific location
                        if (!eventHasLocation || !otherHasLocation || eventLocation !== otherLocation) {
                          return false;
                        }
                      }

                      return true;
                    });

                    const hasParentEvent = overlapping.some(e => e.isAllowedConcurrent);
                    const isParentEvent = event.isAllowedConcurrent ?? false;

                    return {
                      overlapCount: overlapping.length,
                      hasParentEvent,
                      isParentEvent
                    };
                  };

                  return (
                    <div className="event-container" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {sortedEvents.map((event) => {
                        const { overlapCount, hasParentEvent, isParentEvent } = getOverlapInfo(event, sortedEvents);
                        // Determine which times to use (registration vs actual event times)
                        let startDateTime, endDateTime;
                        if (showRegistrationTimes && event.hasRegistrationEvent && event.registrationStart && event.registrationEnd) {
                          startDateTime = event.registrationStart;
                          endDateTime = event.registrationEnd;
                        } else {
                          startDateTime = event.start.dateTime;
                          endDateTime = event.end.dateTime;
                        }

                        // Calculate duration using Date objects
                        const startDate = new Date(ensureUTCFormat(startDateTime));
                        const endDate = new Date(ensureUTCFormat(endDateTime));
                        const duration = Math.round((endDate - startDate) / (1000 * 60)); // duration in minutes

                        // Check if it's an all-day event (24 hours or more)
                        const isAllDay = duration >= 1440; // 24 hours = 1440 minutes

                        let timeDisplay;
                        if (isAllDay) {
                          timeDisplay = "All day";
                        } else {
                          // Use formatEventTime utility which properly handles timezone conversion
                          // Pass the source timezone from event data for correct interpretation
                          const sourceTimezone = event.start?.timeZone || event.graphData?.start?.timeZone;
                          const startTimeStr = formatEventTime(startDateTime, userTimezone, event.subject, sourceTimezone);
                          const endTimeStr = formatEventTime(endDateTime, userTimezone, event.subject, sourceTimezone);

                          // Format total duration - simplified to prevent overflow
                          const hours = Math.floor(duration / 60);
                          const minutes = duration % 60;
                          let durationStr;
                          if (hours > 0) {
                            // Only show hours for events longer than 1 hour
                            durationStr = `${hours}h`;
                          } else {
                            // Show minutes for short events
                            durationStr = `${minutes}m`;
                          }

                          timeDisplay = `${startTimeStr} - ${endTimeStr} (${durationStr})`;

                          // Add indicator if showing registration times
                          if (showRegistrationTimes && event.hasRegistrationEvent) {
                            timeDisplay = `⏱️ ${timeDisplay}`;
                          }
                        }
                        
                        // Get primary category for color
                        const eventCategories = event.calendarData?.categories || event.categories || event.graphData?.categories || (event.category ? [event.category] : ['Uncategorized']);
                        const primaryCategory = eventCategories[0] || 'Uncategorized';
                        const eventColor = groupBy === 'categories'
                          ? getCategoryColor(primaryCategory)
                          : getLocationColor(getEventDisplayLocation(event));
                        
                        // Convert hex color to rgba with transparency
                        const hexToRgba = (hex, alpha) => {
                          const r = parseInt(hex.slice(1, 3), 16);
                          const g = parseInt(hex.slice(3, 5), 16);
                          const b = parseInt(hex.slice(5, 7), 16);
                          return `rgba(${r}, ${g}, ${b}, ${alpha})`;
                        };
                        
                        // Use different styling if showing registration times
                        const isShowingRegistrationTime = showRegistrationTimes && event.hasRegistrationEvent;
                        // Check if event is pending approval
                        const isPending = event.status === 'pending';
                        // Check if event is a draft
                        const isDraft = event.status === 'draft';
                        // Check for pending edit request
                        const hasPendingEditRequest = event.pendingEditRequest?.status === 'pending';
                        const bgAlpha = isDraft ? 0.08 : isPending ? 0.12 : (isShowingRegistrationTime ? 0.1 : 0.15);
                        const transparentColor = hasPendingEditRequest
                          ? 'rgba(139, 92, 246, 0.12)' // Purple tint for pending edits
                          : hexToRgba(eventColor, bgAlpha);

                        return (
                          <div
                            key={event.eventId}
                            className={`event-item ${isDraft ? 'draft-event' : ''} ${isPending ? 'pending-event' : ''} ${hasPendingEditRequest ? 'has-pending-edit' : ''} ${isParentEvent ? 'parent-event' : ''}`}
                            style={{
                              position: 'relative',
                              backgroundColor: isParentEvent ? hexToRgba('#4aba6d', 0.12) : transparentColor,
                              borderLeft: `2px ${isDraft ? 'dotted' : isPending || hasPendingEditRequest ? 'dashed' : 'solid'} ${isParentEvent ? '#4aba6d' : (hasPendingEditRequest ? '#8b5cf6' : eventColor)}`,
                              padding: viewType === 'month' ? '4px 6px' : '6px 8px',
                              margin: 0,
                              cursor: 'pointer',
                              borderRadius: viewType === 'month' ? '6px' : '7px',
                              color: '#333',
                              opacity: isDraft ? 0.75 : isPending ? 0.85 : 1,
                              ...(isShowingRegistrationTime && !isPending && !isDraft && !hasPendingEditRequest && {
                                border: `1px dashed ${eventColor}`,
                                borderLeftWidth: '2px',
                                borderLeftStyle: 'solid'
                              }),
                              ...(hasPendingEditRequest && {
                                border: `1px dashed #a78bfa`,
                                borderLeftWidth: '2px',
                                borderLeftStyle: 'dashed',
                                borderLeftColor: '#8b5cf6'
                              })
                            }}
                            onClick={(e) => handleEventClick(event, e)}
                          >
                            {/* Recurring event indicator - check top-level (authoritative) then graphData (fallback) */}
                            {((event.eventType || event.graphData?.type) === 'seriesMaster' ||
                              (event.seriesMasterId || event.graphData?.seriesMasterId) ||
                              (event.recurrence || event.graphData?.recurrence)) && (
                              <div style={{
                                position: 'absolute',
                                top: '2px',
                                right: '3px',
                                fontSize: '12px',
                                color: '#444',
                                fontWeight: 'bold',
                                lineHeight: 1
                              }}>
                                ↻
                              </div>
                            )}
                            {/* Overlap badge - shows when multiple events at same time */}
                            {overlapCount > 0 && (
                              <div style={{
                                position: 'absolute',
                                top: '2px',
                                left: '2px',
                                fontSize: '8px',
                                fontWeight: '600',
                                color: hasParentEvent ? '#166534' : '#9a3412',
                                backgroundColor: hasParentEvent ? '#dcfce7' : '#ffedd5',
                                padding: '1px 4px',
                                borderRadius: '4px',
                                lineHeight: 1,
                                zIndex: 5
                              }}
                              title={hasParentEvent ? `Nested with ${overlapCount} event(s)` : `Overlaps with ${overlapCount} event(s)`}
                              >
                                {hasParentEvent ? `+${overlapCount}` : `⚠️${overlapCount + 1}`}
                              </div>
                            )}
                            {/* Parent event indicator */}
                            {isParentEvent && (
                              <div style={{
                                position: 'absolute',
                                top: '2px',
                                left: overlapCount > 0 ? '32px' : '2px',
                                fontSize: '9px',
                                lineHeight: 1
                              }}
                              title="Allows concurrent events"
                              >
                                🔄
                              </div>
                            )}
                            <div style={{ lineHeight: '1.3', marginTop: overlapCount > 0 || isParentEvent ? '10px' : '0' }}>
                              <div style={{
                                fontSize: viewType === 'month' ? '10px' : '11px',
                                color: '#555',
                                fontWeight: '500',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}>
                                {timeDisplay}
                              </div>
                              <div style={{
                                fontSize: viewType === 'month' ? '11px' : '12px',
                                fontWeight: '600',
                                marginTop: '2px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}>
                                {event.subject}
                              </div>
                            </div>
                            {event.calendarId && event.calendarId !== 'primary' && (
                              <div className="calendar-source" style={{
                                fontSize: '9px',
                                opacity: 0.8,
                                marginTop: '2px'
                              }}>
                                {event.calendarName}
                              </div>
                            )}
                            {isPending && (
                              <div style={{
                                fontSize: '7px',
                                fontWeight: '600',
                                color: '#b45309',
                                backgroundColor: '#fef3c7',
                                padding: '1px 4px',
                                borderRadius: '3px',
                                marginTop: '2px',
                                display: 'inline-block'
                              }}>
                                PENDING
                              </div>
                            )}
                            {isDraft && (
                              <div style={{
                                fontSize: '7px',
                                fontWeight: '600',
                                color: '#6b7280',
                                backgroundColor: '#f3f4f6',
                                padding: '1px 4px',
                                borderRadius: '3px',
                                marginTop: '2px',
                                display: 'inline-block'
                              }}>
                                DRAFT
                              </div>
                            )}
                            {/* Pending Edit Request indicator */}
                            {hasPendingEditRequest && (
                              <div style={{
                                position: 'absolute',
                                top: '1px',
                                right: '2px',
                                fontSize: '9px',
                                lineHeight: 1,
                                backgroundColor: '#ede9fe',
                                borderRadius: '3px',
                                padding: '1px 2px'
                              }}
                              title="Has pending edit request"
                              >
                                ✏️
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        ))
      ) : (
        // Show message when no events match the current filters
        <div className="grid-row">
          <div className="grid-cell" style={{ 
            gridColumn: `1 / ${getDaysInRange().length + 2}`,
            textAlign: 'center',
            padding: '20px',
            color: '#666',
            fontStyle: 'italic'
          }}>
            No events found for the selected filters and date range.
          </div>
        </div>
      )}
    </>
  );
});

export default WeekView;