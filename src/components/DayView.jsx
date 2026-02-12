// Fixed DayView.jsx with proper virtual location detection
import { logger } from '../utils/logger';
import React, { memo, useMemo } from 'react';
import { processEventsForOverlap, getOverlapType } from '../utils/eventOverlapUtils';
import { useTimezone } from '../context/TimezoneContext';
import { usePermissions } from '../hooks/usePermissions';
import { formatEventTime, ensureUTCFormat } from '../utils/timezoneUtils';
import { sortEventsByStartTime } from '../utils/eventTransformers';

const DayView = memo(({
  // Props
  groupBy,
  outlookCategories,
  selectedCategories,
  availableLocations,
  selectedLocations,
  formatDateHeader,
  getEventPosition,
  filteredEvents,
  getCategoryColor,
  getLocationColor,
  handleDayCellClick,
  handleEventClick,
  renderEventContent,
  viewType,
  dynamicCategories,
  dateRange,
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

  // Get permissions for role simulation
  const { canCreateEvents } = usePermissions();

  // For day view, we only need the current day
  const currentDay = dateRange.start;
  
  // DEBUG: Log the showRegistrationTimes prop
  logger.debug('DayView: showRegistrationTimes prop:', showRegistrationTimes);
  
  // DEBUG: Check if any filtered events have registration properties
  if (filteredEvents && filteredEvents.length > 0) {
    const eventsWithRegistration = filteredEvents.filter(event => 
      event.hasRegistrationEvent || event.registrationStart || event.registrationEnd
    );
    logger.debug('DayView: Events with registration properties:', eventsWithRegistration.length, 'out of', filteredEvents.length);
    if (eventsWithRegistration.length > 0) {
      logger.debug('DayView: Sample event with registration data:', eventsWithRegistration[0]);
    }
  }
  
  // Helper function to get the display location for an event
  const getEventDisplayLocation = (event) => {
    // Check for offsite events first
    if (event.isOffsite) {
      return 'Offsite';
    }

    if (isUnspecifiedLocation(event)) {
      return 'Unspecified';
    } else if (isEventVirtual(event)) {
      return 'Virtual';
    } else {
      // Return the first physical location
      const locationText = event.location?.displayName?.trim() || '';
      const eventLocations = locationText
        .split(/[;,]/)
        .map(loc => loc.trim())
        // Filter out empty strings and "Unspecified" placeholder
        .filter(loc => loc.length > 0 && loc !== 'Unspecified');

      // Find first non-virtual location
      for (const location of eventLocations) {
        if (!isVirtualLocation(location)) {
          return location;
        }
      }
      return 'Unspecified';
    }
  };
  
  // Get categories/locations that actually have events on this specific day
  const activeGroupsForDay = useMemo(() => {
    const dayEvents = filteredEvents.filter(event => 
      getEventPosition(event, currentDay)
    );
    
    if (groupBy === 'categories') {
      // Get categories that have events on this day and are selected
      const categoriesWithEvents = new Set();
      
      dayEvents.forEach(event => {
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
      // Get locations that have events on this day and are selected
      const locationsWithEvents = new Set();
      
      dayEvents.forEach(event => {
        const displayLocation = getEventDisplayLocation(event);
        if (selectedLocations.includes(displayLocation)) {
          locationsWithEvents.add(displayLocation);
        }
      });
      
      // Return sorted array of locations that have events
      return Array.from(locationsWithEvents).sort();
    }
  }, [groupBy, filteredEvents, selectedCategories, selectedLocations, currentDay, getEventPosition]);
  
  return (
    <>
      {/* Grid Header (Day) */}
      <div className="grid-header">
        <div className="grid-cell header-cell category-header">
          {groupBy === 'categories' ? 'Categories' : 'Locations'}
        </div>
        <div className="grid-cell header-cell">
          {formatDateHeader(currentDay)}
        </div>
      </div>

      {/* Dynamic Grid Rows (Only categories/locations with events on this day) */}
      {activeGroupsForDay.length > 0 ? (
        activeGroupsForDay.map(group => (
          <div key={group} className="grid-row">
            <div
              className="grid-cell category-cell"
              onClick={() => {
                // Only make clickable when grouping by locations
                if (groupBy === 'locations' && handleLocationRowClick) {
                  // Pass locationId from the group data
                  const groupData = locationGroups[group];
                  const locationId = groupData?.locationId;
                  handleLocationRowClick(group, currentDay, 'day', locationId);
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
            
            {/* One Day Cell */}
            <div 
              className="grid-cell day-cell"
              onClick={() => handleDayCellClick(
                currentDay, 
                groupBy === 'categories' ? group : null,
                groupBy === 'locations' ? group : null
              )}
            >
              {/* Events for this group on this day */}
              {(() => {
                // Filter events for this group and day
                const groupEvents = filteredEvents.filter(event => {
                  // Check if event is for this day
                  if (!getEventPosition(event, currentDay)) return false;
                  
                  if (groupBy === 'categories') {
                    // Check calendarData.categories first (authoritative), then top-level, then graphData fallback
                    const categories = event.calendarData?.categories || event.categories || event.graphData?.categories || (event.category ? [event.category] : ['Uncategorized']);
                    const category = categories[0] || 'Uncategorized';
                    return category === group;
                  } else {
                    // FIXED: Use proper location detection
                    const displayLocation = getEventDisplayLocation(event);
                    return displayLocation === group;
                  }
                });

                // Sort events by start time
                const sortedEvents = sortEventsByStartTime(groupEvents);

                // Calculate overlap counts for each event
                const getOverlapInfo = (event, allEvents) => {
                  // Timeless drafts should not participate in overlap detection
                  const isTimelessDraft = event.status === 'draft' &&
                    !event.calendarData?.startTime && !event.calendarData?.endTime;
                  if (isTimelessDraft) {
                    return { overlapCount: 0, hasParentEvent: false, isParentEvent: false };
                  }

                  const eventStart = new Date(event.start?.dateTime || event.startDateTime);
                  const eventEnd = new Date(event.end?.dateTime || event.endDateTime);

                  const overlapping = allEvents.filter(other => {
                    if (other.eventId === event.eventId || other.id === event.id) return false;
                    // Skip timeless drafts as overlap candidates
                    const otherIsTimelessDraft = other.status === 'draft' &&
                      !other.calendarData?.startTime && !other.calendarData?.endTime;
                    if (otherIsTimelessDraft) return false;
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
                  <div className="event-container" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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

                      // Detect drafts without specific times (defaulted to 00:00-23:59)
                      const isTimelessDraft = event.status === 'draft' &&
                        !event.calendarData?.startTime && !event.calendarData?.endTime;

                      let timeDisplay;
                      if (isTimelessDraft) {
                        timeDisplay = "All day (time TBD)";
                      } else if (isAllDay) {
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
                      const bgAlpha = isDraft ? 0.1 : isPending ? 0.15 : (isShowingRegistrationTime ? 0.15 : 0.2);

                      const transparentColor = hasPendingEditRequest
                        ? 'rgba(139, 92, 246, 0.15)' // Purple tint for pending edits
                        : hexToRgba(eventColor, bgAlpha);

                      return (
                        <div
                          key={event.eventId}
                          className={`event-item ${isDraft ? 'draft-event' : ''} ${isPending ? 'pending-event' : ''} ${hasPendingEditRequest ? 'has-pending-edit' : ''} ${isParentEvent ? 'parent-event' : ''}`}
                          style={{
                            position: 'relative',
                            backgroundColor: isParentEvent ? hexToRgba('#4aba6d', 0.15) : transparentColor,
                            borderLeft: `3px solid ${isParentEvent ? '#4aba6d' : (hasPendingEditRequest ? '#8b5cf6' : eventColor)}`,
                            padding: '8px 10px',
                            margin: 0,
                            cursor: 'pointer',
                            borderRadius: '8px',
                            color: '#333',
                            opacity: isDraft ? 0.8 : isPending ? 0.9 : 1,
                            ...(isShowingRegistrationTime && !isPending && !isDraft && !hasPendingEditRequest && {
                              borderRight: `1px dashed ${eventColor}`,
                              borderBottom: `1px dashed ${eventColor}`,
                            }),
                            ...(hasPendingEditRequest && {
                              borderRight: `1px dashed #a78bfa`,
                              borderBottom: `1px dashed #a78bfa`,
                            })
                          }}
                          onClick={(e) => handleEventClick(event, e)}
                        >
                          {/* Overlap badge */}
                          {overlapCount > 0 && (
                            <div style={{
                              position: 'absolute',
                              top: '4px',
                              left: '4px',
                              fontSize: '9px',
                              fontWeight: '600',
                              color: hasParentEvent ? '#166534' : '#9a3412',
                              backgroundColor: hasParentEvent ? '#dcfce7' : '#ffedd5',
                              padding: '2px 6px',
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
                              top: '4px',
                              left: overlapCount > 0 ? '45px' : '4px',
                              fontSize: '11px',
                              lineHeight: 1
                            }}
                            title="Allows concurrent events"
                            >
                              🔄
                            </div>
                          )}
                          <div style={{ lineHeight: '1.3', marginTop: overlapCount > 0 || isParentEvent ? '14px' : '0' }}>
                            <div style={{
                              fontSize: '11px',
                              color: '#555',
                              fontWeight: '500',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}>
                              {timeDisplay}
                            </div>
                            <div style={{ 
                              fontSize: '13px', 
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
                            <span className="event-status-badge badge-pending" style={{ fontSize: '9px', padding: '2px 6px' }}>
                              PENDING
                            </span>
                          )}
                          {isDraft && (
                            <span className="event-status-badge badge-draft" style={{ fontSize: '9px', padding: '2px 6px' }}>
                              DRAFT
                            </span>
                          )}
                          {/* Pending Edit Request indicator */}
                          {hasPendingEditRequest && (
                            <div style={{
                              position: 'absolute',
                              top: '4px',
                              right: '4px',
                              fontSize: '10px',
                              lineHeight: 1,
                              backgroundColor: '#ede9fe',
                              borderRadius: '3px',
                              padding: '2px 3px'
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
          </div>
        ))
      ) : (
        // Show message when no events on this day
        <div className="grid-row">
          <div className="grid-cell" style={{ 
            gridColumn: '1 / 3',
            textAlign: 'center',
            padding: '40px 20px',
            color: '#666'
          }}>
            <div style={{ fontSize: '16px', marginBottom: '10px' }}>
              No events found for {formatDateHeader(currentDay)}
            </div>
            {/* Add Event button - only show if user has create permission */}
            {canCreateEvents && (
              <button
                onClick={() => handleDayCellClick(currentDay)}
                style={{
                  backgroundColor: '#007bff',
                  color: 'white',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                + Add Event
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
});

export default DayView;