import React, { memo, useState, useCallback, useEffect } from 'react';
import DayEventPanel from './DayEventPanel';
import SimpleMultiSelect from './SimpleMultiSelect';
import './MonthView.css';

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
  getFilteredMonthEvents,
  getMonthDayEventPosition,
  allEvents,
  userTimeZone,
  handleMonthFilterChange,
  // UNIFIED: Use same filter state as Day/Week views
  selectedCategories,           
  selectedLocations,            
  setSelectedCategories,        
  setSelectedLocations,         
  dynamicCategories,
  dynamicLocations,
  // Helper functions from Calendar.jsx
  isEventVirtual,
  isUnspecifiedLocation,
  hasPhysicalLocation,
  isVirtualLocation,
  updateUserProfilePreferences  
}) => {
  const [selectedDay, setSelectedDay] = useState(null);
  
  // DEBUG: Add console logs to see what data we're getting
  useEffect(() => {
    console.log('=== MONTHVIEW DEBUG ===');
    console.log('allEvents:', allEvents?.length || 0);
    console.log('filteredEvents:', filteredEvents?.length || 0);
    console.log('dynamicCategories:', dynamicCategories);
    console.log('dynamicLocations:', dynamicLocations);
    console.log('selectedCategories:', selectedCategories);
    console.log('selectedLocations:', selectedLocations);
    console.log('========================');
  }, [allEvents, filteredEvents, dynamicCategories, dynamicLocations, selectedCategories, selectedLocations]);
  
  const handleDayClick = useCallback((day) => {
    setSelectedDay(day.date);
  }, []);

  // Use the dynamic categories/locations passed as props from Calendar
  const getAvailableCategoriesInRange = useCallback(() => {
    console.log('Getting available categories...');
    
    if (dynamicCategories && dynamicCategories.length > 0) {
      console.log('Using dynamicCategories prop:', dynamicCategories);
      return dynamicCategories;
    }
    
    // Fallback: extract from all events
    if (!allEvents || !Array.isArray(allEvents) || allEvents.length === 0) {
      console.log('No events available for categories');
      return [];
    }
    
    const categoriesInRange = new Set();
    allEvents.forEach(event => {
      const category = event.category || 'Uncategorized';
      categoriesInRange.add(category);
    });
    
    const result = Array.from(categoriesInRange).sort();
    console.log('Manual categories result:', result);
    return result;
  }, [dynamicCategories, allEvents]);

  const getAvailableLocationsInRange = useCallback(() => {
    console.log('Getting available locations...');
    
    if (dynamicLocations && dynamicLocations.length > 0) {
      console.log('Using dynamicLocations prop:', dynamicLocations);
      return dynamicLocations;
    }
    
    // Fallback: extract from all events
    if (!allEvents || !Array.isArray(allEvents) || allEvents.length === 0) {
      console.log('No events available for locations');
      return [];
    }
    
    const locationsInRange = new Set();
    allEvents.forEach(event => {
      const locationText = event.location?.displayName?.trim() || '';
      
      if (!locationText) {
        locationsInRange.add('Unspecified');
      } else if (locationText.toLowerCase().includes('virtual') || 
                 locationText.toLowerCase().includes('teams') ||
                 locationText.toLowerCase().includes('zoom') ||
                 locationText.includes('http')) {
        locationsInRange.add('Virtual');
      } else {
        locationsInRange.add(locationText);
      }
    });
    
    const result = Array.from(locationsInRange).sort();
    console.log('Manual locations result:', result);
    return result;
  }, [dynamicLocations, allEvents]);

  // Use filteredEvents for selected day instead of re-filtering
  const getEventsForSelectedDay = useCallback(() => {
    if (!selectedDay) return [];
    
    return filteredEvents.filter(event => {
      const eventDate = new Date(event.start.dateTime);
      
      return (
        eventDate.getFullYear() === selectedDay.getFullYear() &&
        eventDate.getMonth() === selectedDay.getMonth() &&
        eventDate.getDate() === selectedDay.getDate()
      );
    });
  }, [selectedDay, filteredEvents]);

  // Get the actual options for the dropdowns
  const availableCategories = getAvailableCategoriesInRange();
  const availableLocations = getAvailableLocationsInRange();

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
                    
                    <div className="day-events">
                      {(() => {
                        // Use filteredEvents from Calendar's main filtering system
                        const dayFilteredEvents = filteredEvents.filter(event => {
                          const eventDate = new Date(event.start.dateTime);
                          return (
                            eventDate.getFullYear() === day.date.getFullYear() &&
                            eventDate.getMonth() === day.date.getMonth() &&
                            eventDate.getDate() === day.date.getDate()
                          );
                        });

                        // Show event count circle if there are filtered events
                        if (dayFilteredEvents.length > 0) {
                          const size = Math.min(20 + (dayFilteredEvents.length * 3), 50);
                          
                          return (
                            <div 
                              className="event-count-circle"
                              style={{
                                width: `${size}px`,
                                height: `${size}px`,
                                fontSize: `${Math.min(14 + (dayFilteredEvents.length * 0.5), 20)}px`,
                                backgroundColor: '#4caf50' // Green for visible events
                              }}
                              title={`${dayFilteredEvents.length} events visible`}
                            >
                              {dayFilteredEvents.length}
                            </div>
                          );
                        }

                        // Don't show anything if no events pass the filter
                        // This removes the flattened gray dot issue
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
            
            <SimpleMultiSelect
              options={availableCategories}
              selected={selectedCategories || []}
              onChange={(val) => {
                console.log('Category selection changed to:', val);
                if (setSelectedCategories && typeof setSelectedCategories === 'function') {
                  setSelectedCategories(val);
                  if (updateUserProfilePreferences && typeof updateUserProfilePreferences === 'function') {
                    updateUserProfilePreferences({ selectedCategories: val });
                  }
                } else {
                  console.error('setSelectedCategories is not a function:', typeof setSelectedCategories);
                }
              }}
              label="categories"
              maxHeight={200}
            />
          </div>
          
          <div className="filter-section">
            <h3>Filter by Location</h3>
            
            <SimpleMultiSelect
              options={availableLocations}
              selected={selectedLocations || []}
              onChange={(val) => {
                console.log('Location selection changed to:', val);
                if (setSelectedLocations && typeof setSelectedLocations === 'function') {
                  setSelectedLocations(val);
                  if (updateUserProfilePreferences && typeof updateUserProfilePreferences === 'function') {
                    updateUserProfilePreferences({ selectedLocations: val });
                  }
                } else {
                  console.error('setSelectedLocations is not a function:', typeof setSelectedLocations);
                }
              }}
              label="locations"
              maxHeight={200}
            />
          </div>
        </div>
        
        {/* Filter Status Display - Moved below the filter dropdowns */}
        <div style={{
          background: '#e3f2fd',
          border: '1px solid #2196f3',
          borderRadius: '4px',
          padding: '12px',
          margin: '15px',
          fontSize: '13px',
          width: 'calc(100% - 30px)',
          boxSizing: 'border-box'
        }}>
          <div><strong>Active Filters:</strong></div>
          <div>Categories ({selectedCategories?.length || 0}): {(selectedCategories || []).join(', ') || 'None'}</div>
          <div>Locations ({selectedLocations?.length || 0}): {(selectedLocations || []).join(', ') || 'None'}</div>
          <div><strong>Events: {filteredEvents?.length || 0} visible / {allEvents?.length || 0} total</strong></div>
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