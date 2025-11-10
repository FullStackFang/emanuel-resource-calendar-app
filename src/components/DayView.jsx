// Fixed DayView.jsx with proper virtual location detection
import { logger } from '../utils/logger';
import React, { memo, useMemo } from 'react';
import { processEventsForOverlap, getOverlapType } from '../utils/eventOverlapUtils';
import { useTimezone } from '../context/TimezoneContext';
import { formatEventTime, ensureUTCFormat } from '../utils/timezoneUtils';

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
  dynamicLocations,
  showRegistrationTimes,
  handleLocationRowClick // New prop for location timeline modal
}) => {
  // Get user's timezone preference from context
  const { userTimezone } = useTimezone();

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
        .filter(loc => loc.length > 0);
      
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
        const category = event.category || 'Uncategorized';
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
                  handleLocationRowClick(group, currentDay, 'day');
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
                    const category = event.category || 'Uncategorized';
                    return category === group;
                  } else {
                    // FIXED: Use proper location detection
                    const displayLocation = getEventDisplayLocation(event);
                    return displayLocation === group;
                  }
                });

                // Sort events by start time
                const sortedEvents = groupEvents.sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime));

                return (
                  <div className="event-container">
                    {sortedEvents.map((event) => {
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
                        const startTimeStr = formatEventTime(startDateTime, userTimezone, event.subject);
                        const endTimeStr = formatEventTime(endDateTime, userTimezone, event.subject);
                        
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
                      
                      const eventColor = groupBy === 'categories' 
                        ? getCategoryColor(event.category || 'Uncategorized') 
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
                      const bgAlpha = isShowingRegistrationTime ? 0.15 : 0.2;
                      
                      const transparentColor = hexToRgba(eventColor, bgAlpha);
                      
                      return (
                        <div
                          key={event.eventId} 
                          className="event-item"
                          style={{
                            backgroundColor: transparentColor,
                            borderLeft: `3px solid ${eventColor}`,
                            padding: '8px 10px',
                            margin: '2px 0',
                            cursor: 'pointer',
                            borderRadius: '8px',
                            color: '#333',
                            ...(isShowingRegistrationTime && {
                              border: `1px dashed ${eventColor}`,
                              borderLeftWidth: '3px',
                              borderLeftStyle: 'solid'
                            })
                          }}
                          onClick={(e) => handleEventClick(event, e)}
                        >
                          <div style={{ lineHeight: '1.3' }}>
                            <div style={{ 
                              fontSize: '11px',
                              color: '#666',
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
          </div>
        </div>
      )}
    </>
  );
});

export default DayView;