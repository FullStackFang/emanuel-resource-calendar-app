import React, { memo, useMemo } from 'react';
import { processEventsForOverlap } from '../utils/eventOverlapUtils';
import { logger } from '../utils/logger';

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
    // Check if event has no location
    if (isUnspecifiedLocation(event)) {
      return 'Unspecified';
    }

    // Get location text and parse it
    const locationText = event.location?.displayName?.trim() || '';
    const eventLocations = locationText
      .split(/[;,]/)
      .map(loc => loc.trim())
      .filter(loc => loc.length > 0);

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
        const category = event.category || 'Uncategorized';
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
        return locationGroups[groupName] && locationGroups[groupName].length > 0;
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
                    handleLocationRowClick(group, days, 'week');
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
                      const category = event.category || 'Uncategorized';
                      return category === group;
                    });
                  } else {
                    // For locations, use pre-computed locationGroups
                    groupEvents = locationGroups[group] || [];
                  }

                  // Filter to events for this specific day
                  const dayEvents = groupEvents.filter(event => {
                    return getEventPosition(event, day);
                  });

                  // Sort events by start time
                  const sortedEvents = dayEvents.sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime));

                  return (
                    <div className="event-container">
                      {sortedEvents.map((event) => {
                        // Use registration times if available and toggle is enabled
                        let displayStartTime, displayEndTime;
                        if (showRegistrationTimes && event.hasRegistrationEvent && event.registrationStart && event.registrationEnd) {
                          displayStartTime = new Date(event.registrationStart);
                          displayEndTime = new Date(event.registrationEnd);
                        } else {
                          displayStartTime = new Date(event.start.dateTime);
                          displayEndTime = new Date(event.end.dateTime);
                        }
                        
                        const duration = Math.round((displayEndTime - displayStartTime) / (1000 * 60)); // duration in minutes
                        
                        // Check if it's an all-day event (24 hours or more)
                        const isAllDay = duration >= 1440; // 24 hours = 1440 minutes
                        
                        let timeDisplay;
                        if (isAllDay) {
                          timeDisplay = "All day";
                        } else {
                          // Format start and end times (e.g., "9:30 AM", "10:30 AM")
                          const startTimeStr = displayStartTime.toLocaleTimeString([], { 
                            hour: 'numeric', 
                            minute: '2-digit',
                            hour12: true 
                          });
                          const endTimeStr = displayEndTime.toLocaleTimeString([], { 
                            hour: 'numeric', 
                            minute: '2-digit',
                            hour12: true 
                          });
                          
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
                        const bgAlpha = isShowingRegistrationTime ? 0.1 : 0.15;
                        const transparentColor = hexToRgba(eventColor, bgAlpha);
                        
                        return (
                          <div
                            key={event.eventId} 
                            className="event-item"
                            style={{
                              backgroundColor: transparentColor,
                              borderLeft: `2px solid ${eventColor}`,
                              padding: viewType === 'month' ? '4px 6px' : '6px 8px',
                              margin: '1px 0',
                              cursor: 'pointer',
                              borderRadius: viewType === 'month' ? '6px' : '7px',
                              color: '#333',
                              ...(isShowingRegistrationTime && {
                                border: `1px dashed ${eventColor}`,
                                borderLeftWidth: '2px',
                                borderLeftStyle: 'solid'
                              })
                            }}
                            onClick={(e) => handleEventClick(event, e)}
                          >
                            <div style={{ lineHeight: '1.2' }}>
                              <div style={{ 
                                fontSize: viewType === 'month' ? '8px' : '9px',
                                color: '#666',
                                fontWeight: '500',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}>
                                {timeDisplay}
                              </div>
                              <div style={{ 
                                fontSize: viewType === 'month' ? '9px' : '10px',
                                fontWeight: '600',
                                marginTop: '1px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}>
                                {event.subject}
                              </div>
                            </div>
                            {event.calendarId && event.calendarId !== 'primary' && (
                              <div className="calendar-source" style={{ 
                                fontSize: '7px', 
                                opacity: 0.8,
                                marginTop: '1px'
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