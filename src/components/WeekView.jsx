import React, { memo } from 'react';

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
  categories // For fallback if outlookCategories not loaded
}) => {
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

      {/* Grid Rows (Categories or Locations) */}
      {groupBy === 'categories' ? (
        <>
          {/* Regular known categories */}
          {(outlookCategories.length > 0 
            ? ['Uncategorized', ...outlookCategories.map(cat => cat.name).filter(name => name !== 'Uncategorized')]
            : categories // Fall back to predefined categories if Outlook categories aren't loaded yet
          ).filter(category => selectedCategories.includes(category))
            .map(category => (
              <div key={category} className="grid-row">
                <div className="grid-cell category-cell">
                  {/* Add color indicator if it's an Outlook category */}
                  {outlookCategories.find(cat => cat.name === category) && (
                    <div 
                      className="category-color" 
                      style={{ 
                        display: 'inline-block',
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        marginRight: '5px',
                        backgroundColor: getCategoryColor(category)
                      }}
                    />
                  )}
                  {category}
                </div>
                
                {/* Days */}
                {getDaysInRange().map((day, dayIndex) => (
                  <div 
                    key={dayIndex} 
                    className="grid-cell day-cell"
                    onClick={() => handleDayCellClick(day, category)}
                  >
                    {/* Events for this category and day */}
                    {filteredEvents
                      .filter(event => 
                        event.category === category && 
                        getEventPosition(event, day)
                      )
                      .map(event => (
                        <div 
                          key={event.id} 
                          className="event-item"
                          style={{
                            borderLeft: `4px solid ${groupBy === 'locations' 
                              ? getLocationColor(event.location?.displayName) 
                              : getCategoryColor(event.category)}`,
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
          }
          
          {/* Other Categories Row */}
          <div key="other-categories" className="grid-row">
            <div className="grid-cell category-cell">
              <div 
                className="category-color" 
                style={{ 
                  display: 'inline-block',
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  marginRight: '5px',
                  backgroundColor: '#888888' // Gray for Other categories
                }}
              />
              Other
            </div>
            
            {/* Days */}
            {getDaysInRange().map((day, dayIndex) => (
              <div 
                key={dayIndex} 
                className="grid-cell day-cell"
                onClick={() => handleDayCellClick(day, 'Uncategorized')}
              >
                {/* Events for non-standard categories on this day */}
                {filteredEvents
                  .filter(event => {
                    // Check if event is for this day
                    if (!getEventPosition(event, day)) return false;
                    
                    // Not uncategorized
                    if (!event.category || event.category.trim() === '' || event.category === 'Uncategorized') {
                      return false;
                    }
                    
                    // Not in our standard categories
                    return !outlookCategories.some(cat => cat.name === event.category);
                  })
                  .map(event => {
                    // Generate a consistent color for this non-standard category
                    const categoryName = event.category;
                    const hash = categoryName.split('').reduce((a, b) => {
                      a = ((a << 5) - a) + b.charCodeAt(0);
                      return a & a;
                    }, 0);
                    
                    const colors = [
                      '#FF6B6B', '#4ECDC4', '#556270', '#C7F464', '#FF8C94',
                      '#9DE0AD', '#45ADA8', '#547980', '#594F4F', '#FE4365',
                      '#83AF9B', '#FC9D9A', '#F18D9E', '#3A89C9', '#F9CDAD'
                    ];
                    
                    const categoryColor = colors[Math.abs(hash) % colors.length];
                    
                    return (
                      <div 
                        key={event.id} 
                        className="event-item"
                        style={{
                          borderLeft: `4px solid ${categoryColor}`,
                          padding: viewType === 'month' ? '2px 4px' : '4px 8px',
                          margin: viewType === 'month' ? '1px 0' : '2px 0'
                        }}
                        onClick={(e) => handleEventClick(event, e)}
                      >
                        {renderEventContent(event, viewType)}
                        <div style={{ 
                          fontSize: '10px', 
                          opacity: 0.8,
                          fontStyle: 'italic',
                          marginTop: '2px'
                        }}>
                          Category: {event.category}
                        </div>
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
                    );
                  })
                }
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* Regular location rows */}
          {availableLocations
            .filter(location => 
              selectedLocations.includes(location))
            .map(location => (
              <div key={location} className="grid-row">
                {/* Add color indicator for locations */}
                <div className="grid-cell location-cell">
                <div 
                    className="location-color" 
                    style={{ 
                      display: 'inline-block',
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      marginRight: '5px',
                      backgroundColor: getLocationColor(location)
                    }}
                  />
                  {location}
                </div>
                
                {/* Days */}
                {getDaysInRange().map((day, dayIndex) => (
                  <div 
                    key={dayIndex} 
                    className="grid-cell day-cell"
                    onClick={() => handleDayCellClick(day, null, location)}
                  >
                    {filteredEvents
                      .filter(event => {
                        // Check if event is for this day
                        if (!getEventPosition(event, day)) return false;
                        
                        // Get event locations
                        const eventLocations = event.location?.displayName 
                          ? event.location.displayName.split('; ').map(loc => loc.trim())
                          : [];
                        
                        if (location === 'Unspecified') {
                          // For Unspecified, show events with:
                          // 1. No location/empty location, OR
                          // 2. Locations not in availableLocations
                          
                          // Check for empty locations
                          if (eventLocations.length === 0 || eventLocations.every(loc => loc === '')) {
                            return true;
                          }
                          
                          // Check if NONE of the locations are in availableLocations
                          // (excluding 'Unspecified' itself)
                          const validLocations = availableLocations.filter(loc => loc !== 'Unspecified');
                          return !eventLocations.some(loc => validLocations.includes(loc));
                        } else {
                          // For regular locations, check if this specific location is included
                          return eventLocations.includes(location);
                        }
                      })
                      .map(event => (
                        <div 
                          key={event.id} 
                          className="event-item"
                          style={{
                            borderLeft: `4px solid ${groupBy === 'locations' 
                              ? getLocationColor(event.location?.displayName) 
                              : getCategoryColor(event.category)}`,
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
          }
        </>
      )}
    </>
  );
});

export default WeekView;