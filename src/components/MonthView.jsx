import React, { memo, useState, useCallback } from 'react';
import DayEventPanel from './DayEventPanel';

const MonthView = memo(({ 
  // Props this component needs
  getMonthWeeks,
  getWeekdayHeaders,
  selectedFilter,
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
  getMonthDayEventPosition,
  allEvents,
  userTimeZone,
  handleMonthFilterChange,
  selectedCategoryFilter,
  selectedLocationFilter,
  handleCategoryFilterChange,
  handleLocationFilterChange
}) => {
  const [selectedDay, setSelectedDay] = useState(null);
  
  const handleDayClick = useCallback((day) => {
    setSelectedDay(day.date);
  }, []);

  const getEventsForSelectedDay = useCallback(() => {
    if (!selectedDay) return [];
    
    return allEvents.filter(event => {
      const eventDate = new Date(event.start.dateTime);
      
      // Check if event is on selected day
      if (!(
        eventDate.getFullYear() === selectedDay.getFullYear() &&
        eventDate.getMonth() === selectedDay.getMonth() &&
        eventDate.getDate() === selectedDay.getDate()
      )) {
        return false;
      }
      
      // Check category filter
      if (selectedCategoryFilter) {
        if (selectedCategoryFilter === 'Other Categories') {
          if (!event.category || event.category.trim() === '' || event.category === 'Uncategorized') {
            return false;
          }
          if (outlookCategories.some(cat => cat.name === event.category)) {
            return false;
          }
        } else if (event.category !== selectedCategoryFilter) {
          return false;
        }
      }
      
      // Check location filter
      if (selectedLocationFilter) {
        const eventLocations = event.location?.displayName 
          ? event.location.displayName.split('; ').map(loc => loc.trim())
          : [];
        
        if (selectedLocationFilter === 'Unspecified') {
          if (eventLocations.length > 0 && eventLocations.some(loc => loc !== '')) {
            return false;
          }
        } else {
          if (!eventLocations.includes(selectedLocationFilter)) {
            return false;
          }
        }
      }
      
      return true;
    });
  }, [selectedDay, allEvents, selectedCategoryFilter, selectedLocationFilter, outlookCategories]);

  return (
    <div className="month-view-wrapper">
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
              {week.map((day, dayIndex) => {
                const isSelected = selectedDay && 
                  day.date.getFullYear() === selectedDay.getFullYear() &&
                  day.date.getMonth() === selectedDay.getMonth() &&
                  day.date.getDate() === selectedDay.getDate();
                
                return (
                  <div 
                    key={dayIndex}
                    className={`day-cell ${!day.isCurrentMonth ? 'outside-month' : ''} ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleDayClick(day)}
                  >
                    <div className="day-number">{day.date.getDate()}</div>
                    
                    {/* Events for this day */}
                    <div className="day-events">
                      {(() => {
                        // Count events for this day based on both filters
                        const dayEvents = allEvents.filter(event => {
                          // First check if event is on this day
                          if (!getMonthDayEventPosition(event, day.date)) return false;
                          
                          // Check category filter
                          if (selectedCategoryFilter) {
                            if (selectedCategoryFilter === 'Other Categories') {
                              if (!event.category || event.category.trim() === '' || event.category === 'Uncategorized') {
                                return false;
                              }
                              if (outlookCategories.some(cat => cat.name === event.category)) {
                                return false;
                              }
                            } else if (event.category !== selectedCategoryFilter) {
                              return false;
                            }
                          }
                          
                          // Check location filter
                          if (selectedLocationFilter) {
                            const eventLocations = event.location?.displayName 
                              ? event.location.displayName.split('; ').map(loc => loc.trim())
                              : [];
                            
                            if (selectedLocationFilter === 'Unspecified') {
                              if (eventLocations.length > 0 && eventLocations.some(loc => loc !== '')) {
                                return false;
                              }
                            } else {
                              if (!eventLocations.includes(selectedLocationFilter)) {
                                return false;
                              }
                            }
                          }
                          
                          return true;
                        });

                        // Show event count circle if there are any events
                        if (dayEvents.length > 0) {
                          // Calculate circle size based on event count
                          const size = Math.min(20 + (dayEvents.length * 3), 50); // Min 20px, max 50px
                          
                          return (
                            <div 
                              className="event-count-circle"
                              style={{
                                width: `${size}px`,
                                height: `${size}px`,
                                fontSize: `${Math.min(14 + (dayEvents.length * 0.5), 20)}px`
                              }}
                            >
                              {dayEvents.length}
                            </div>
                          );
                        }
                        
                        return null;
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      
      <div className="month-right-panel">
        <div className="month-filter-container">
          <div className="filter-section">
            <h3>Filter by Category</h3>
            <select 
              value={selectedCategoryFilter || ''}
              onChange={(e) => handleCategoryFilterChange(e.target.value)}
              className="month-filter-select"
            >
              <option value="">All Categories</option>
              {outlookCategories.length > 0 ? (
                <>
                  <option value="Uncategorized">Uncategorized</option>
                  {outlookCategories.map(cat => cat.name).filter(name => name !== 'Uncategorized').map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                  <option value="Other Categories">Other Categories</option>
                </>
              ) : (
                <option value="Uncategorized">Uncategorized</option>
              )}
            </select>
          </div>
          
          <div className="filter-section">
            <h3>Filter by Location</h3>
            <select 
              value={selectedLocationFilter || ''}
              onChange={(e) => handleLocationFilterChange(e.target.value)}
              className="month-filter-select"
            >
              <option value="">All Locations</option>
              {availableLocations.map(loc => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
          </div>
        </div>
        
        <DayEventPanel
          selectedDay={selectedDay}
          events={getEventsForSelectedDay()}
          onEventClick={handleEventClick}
          formatEventTime={formatEventTime}
          getCategoryColor={getCategoryColor}
          getLocationColor={getLocationColor}
          groupBy={groupBy}
          userTimeZone={userTimeZone}
        />
      </div>
    </div>
  );
});

export default MonthView;