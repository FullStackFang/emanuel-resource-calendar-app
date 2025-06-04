// Updated WeekView.jsx - Dynamic categories only
import React, { memo, useMemo } from 'react';

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
  getCategoryColor,
  getLocationColor,
  handleDayCellClick,
  handleEventClick,
  renderEventContent,
  viewType,
  dynamicCategories // Use this instead of static categories
}) => {
  
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
      // Get locations that have events and are selected
      const locationsWithEvents = new Set();
      
      filteredEvents.forEach(event => {
        const eventLocations = event.location?.displayName 
          ? event.location.displayName.split('; ').map(loc => loc.trim())
          : ['Unspecified'];
        
        eventLocations.forEach(location => {
          const targetLocation = location || 'Unspecified';
          if (selectedLocations.includes(targetLocation)) {
            locationsWithEvents.add(targetLocation);
          }
        });
      });
      
      // Return sorted array of locations that have events
      return Array.from(locationsWithEvents).sort();
    }
  }, [groupBy, filteredEvents, selectedCategories, selectedLocations]);

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
            <div className="grid-cell category-cell">
              {/* Add color indicator */}
              <div 
                className="category-color" 
                style={{ 
                  display: 'inline-block',
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  marginRight: '5px',
                  backgroundColor: groupBy === 'categories' 
                    ? getCategoryColor(group) 
                    : getLocationColor(group)
                }}
              />
              {group}
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
                {filteredEvents
                  .filter(event => {
                    // Check if event is for this day
                    if (!getEventPosition(event, day)) return false;
                    
                    if (groupBy === 'categories') {
                      const category = event.category || 'Uncategorized';
                      return category === group;
                    } else {
                      // For locations
                      const eventLocations = event.location?.displayName 
                        ? event.location.displayName.split('; ').map(loc => loc.trim())
                        : [];
                      
                      if (group === 'Unspecified') {
                        return eventLocations.length === 0 || eventLocations.every(loc => loc === '');
                      } else {
                        return eventLocations.includes(group);
                      }
                    }
                  })
                  .map(event => (
                    <div 
                      key={event.id} 
                      className="event-item"
                      style={{
                        borderLeft: `4px solid ${groupBy === 'categories' 
                          ? getCategoryColor(event.category || 'Uncategorized') 
                          : getLocationColor(event.location?.displayName || 'Unspecified')}`,
                        padding: viewType === 'month' ? '2px 4px' : '4px 8px',
                        margin: viewType === 'month' ? '1px 0' : '2px 0'
                      }}
                      onClick={(e) => handleEventClick(event, e)}
                    >
                      {renderEventContent(event, viewType)}
                      {event.calendarId && event.calendarId !== 'primary' && (
                        <div className="calendar-source" style={{ 
                          fontSize: '10px', 
                          opacity: 0.8,
                          marginTop: '2px'
                        }}>
                          {event.calendarName}
                        </div>
                      )}
                    </div>
                  ))
                }
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