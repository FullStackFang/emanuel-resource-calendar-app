import React, { memo } from 'react';

const MonthView = memo(({ 
  // Props this component needs
  getMonthWeeks,
  getWeekdayHeaders,
  selectedFilter,
  handleDayCellClick,
  handleEventClick,
  getEventContentStyle,
  formatEventTime,
  getCategoryColor,
  getLocationColor,
  groupBy,
  filteredEvents,
  outlookCategories,
  availableLocations,
  getFilteredMonthEvents,
  getMonthDayEventPosition
}) => {
  return (
    <div className="month-view-container">
      <div className="month-header">
        <div className="weekday-header">
          {getWeekdayHeaders().map((day, index) => (
            <div key={index} className="weekday">{day}</div>
          ))}
        </div>
      </div>
      <div className="month-days">
        {getMonthWeeks().map((week, weekIndex) => (
          <div key={weekIndex} className="week-row">
            {week.map((day, dayIndex) => (
              <div 
                key={dayIndex}
                className={`day-cell ${!day.isCurrentMonth ? 'outside-month' : ''}`}
                onClick={() => handleDayCellClick(day.date)}
              >
                <div className="day-number">{day.date.getDate()}</div>
                
                {/* Events for this day */}
                <div className="day-events">
                  {!selectedFilter ? (
                    // No filter selected - show summary by category/location
                    groupBy === 'categories' ? (
                      // Group by categories
                      <>
                        {/* Regular categories */}
                        {(outlookCategories.length > 0 
                          ? ['Uncategorized', ...outlookCategories.map(cat => cat.name)]
                          : categories)
                          .map(category => {
                            const categoryEvents = filteredEvents.filter(event => 
                              event.category === category && 
                              getMonthDayEventPosition(event, day.date)
                            );
                            
                            return categoryEvents.length > 0 ? (
                              <div key={category} className="day-category-group">
                                <div className="category-label">
                                  <div 
                                    className="category-color"
                                    style={{ 
                                      width: '8px',
                                      height: '8px',
                                      borderRadius: '50%',
                                      marginRight: '4px',
                                      backgroundColor: getCategoryColor(category)
                                    }}
                                  />
                                  <span>{category}</span>
                                </div>
                                <div className="events-count">{categoryEvents.length}</div>
                              </div>
                            ) : null;
                          })
                        }
                        
                        {/* Other categories */}
                        {(() => {
                          // Find events with non-standard categories for this day
                          const otherEvents = filteredEvents.filter(event => {
                            if (!getMonthDayEventPosition(event, day.date)) return false;
                            
                            // Not uncategorized
                            if (!event.category || event.category.trim() === '' || event.category === 'Uncategorized') {
                              return false;
                            }
                            
                            // Not in our standard categories
                            return !outlookCategories.some(cat => cat.name === event.category);
                          });
                          
                          return otherEvents.length > 0 ? (
                            <div key="other-categories" className="day-category-group">
                              <div className="category-label">
                                <div 
                                  className="category-color"
                                  style={{ 
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    marginRight: '4px',
                                    backgroundColor: '#888888'
                                  }}
                                />
                                <span>Other Categories</span>
                              </div>
                              <div className="events-count">{otherEvents.length}</div>
                            </div>
                          ) : null;
                        })()}
                      </>
                    ) : (
                      // Group by locations
                      availableLocations
                        .map(location => {
                          const locationEvents = filteredEvents.filter(event => {
                            if (!getMonthDayEventPosition(event, day.date)) return false;
                            
                            const eventLocations = event.location?.displayName 
                              ? event.location.displayName.split('; ').map(loc => loc.trim())
                              : [];
                            
                            if (location === 'Unspecified') {
                              if (eventLocations.length === 0 || eventLocations.every(loc => loc === '')) {
                                return true;
                              }
                              
                              const validLocations = availableLocations.filter(loc => loc !== 'Unspecified');
                              return !eventLocations.some(loc => validLocations.includes(loc));
                            } else {
                              return eventLocations.includes(location);
                            }
                          });
                          
                          return locationEvents.length > 0 ? (
                            <div key={location} className="day-location-group">
                              <div className="location-label">
                                <div 
                                  className="location-color"
                                  style={{ 
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    marginRight: '4px',
                                    backgroundColor: getLocationColor(location)
                                  }}
                                />
                                <span>{location}</span>
                              </div>
                              <div className="events-count">{locationEvents.length}</div>
                            </div>
                          ) : null;
                        })
                    )
                  ) : (
                    // Filter is selected - show actual events
                    selectedFilter === 'Other Categories' ? (
                      // Show non-standard category events
                      filteredEvents
                        .filter(event => {
                          if (!getMonthDayEventPosition(event, day.date)) return false;
                          
                          // Not uncategorized
                          if (!event.category || event.category.trim() === '' || event.category === 'Uncategorized') {
                            return false;
                          }
                          
                          // Not in our standard categories
                          return !outlookCategories.some(cat => cat.name === event.category);
                        })
                        .map(event => (
                          <div 
                            key={event.id} 
                            className="event-item"
                            style={{
                              borderLeft: `4px solid ${(() => {
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
                                
                                return colors[Math.abs(hash) % colors.length];
                              })()}`,
                              padding: '2px 4px',
                              margin: '1px 0',
                              backgroundColor: event.isShared ? 'rgba(0, 0, 0, 0.05)' : 'transparent'
                            }}
                            onClick={(e) => handleEventClick(event, e)}
                          >
                            <div className="event-title" style={getEventContentStyle('month')}>
                              {formatEventTime(event.start.dateTime, event.subject)} {event.subject}
                            </div>
                            <div style={{ fontSize: '9px', fontStyle: 'italic' }}>
                              {event.category}
                            </div>
                          </div>
                        ))
                    ) : (
                      // Regular category filtering
                      getFilteredMonthEvents(day.date).map(event => (
                        <div 
                          key={event.id} 
                          className="event-item"
                          style={{
                            borderLeft: `4px solid ${groupBy === 'categories' 
                              ? getCategoryColor(event.category) 
                              : getLocationColor(event.location?.displayName || 'Unspecified')}`,
                            padding: '2px 4px',
                            margin: '1px 0',
                            backgroundColor: event.isShared ? 'rgba(0, 0, 0, 0.05)' : 'transparent'
                          }}
                          onClick={(e) => handleEventClick(event, e)}
                        >
                          <div className="event-title" style={getEventContentStyle('month')}>
                            {formatEventTime(event.start.dateTime, event.subject)} {event.subject}
                          </div>
                        </div>
                      ))
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

export default MonthView;