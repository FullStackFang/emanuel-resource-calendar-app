import React, { memo, useState, useCallback } from 'react';
import DayEventPanel from './DayEventPanel';
import MultiSelect from './MultiSelect';
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
  availableLocations,
  getFilteredMonthEvents,
  getMonthDayEventPosition,
  allEvents,
  userTimeZone,
  handleMonthFilterChange,
  // UNIFIED: Use same filter state as Day/Week views
  selectedCategories,           // Instead of selectedCategoryFilter
  selectedLocations,            // Instead of selectedLocationFilter
  setSelectedCategories,        // Instead of handleCategoryFilterChange
  setSelectedLocations,         // Instead of handleLocationFilterChange
  dynamicCategories,
  dynamicLocations,
  // Helper functions from Calendar.jsx
  isEventVirtual,
  isUnspecifiedLocation,
  hasPhysicalLocation,
  isVirtualLocation,
  updateUserProfilePreferences  // For saving preferences
}) => {
  const [selectedDay, setSelectedDay] = useState(null);
  
  const handleDayClick = useCallback((day) => {
    setSelectedDay(day.date);
  }, []);

  // Step 5: Get categories/locations that exist in current MONTH (not just specific days)
  const getAvailableCategoriesInRange = useCallback(() => {
    const categoriesInRange = new Set();
    
    // Get the current month and year from dateRange
    const currentYear = getMonthWeeks()[0][0].date.getFullYear();
    const currentMonth = getMonthWeeks()[0][0].date.getMonth();
    
    allEvents.forEach(event => {
      // Parse event date
      const eventDate = new Date(event.start.dateTime);
      const eventYear = eventDate.getFullYear();
      const eventMonth = eventDate.getMonth();
      
      // Check if event is in the current month (regardless of which days are visible)
      if (eventYear === currentYear && eventMonth === currentMonth) {
        const category = event.category || 'Uncategorized';
        categoriesInRange.add(category);
      }
    });
    
    return Array.from(categoriesInRange).sort();
  }, [allEvents, getMonthWeeks]);

  const getAvailableLocationsInRange = useCallback(() => {
    const locationsInRange = new Set();
    
    // Get the current month and year from dateRange
    const currentYear = getMonthWeeks()[0][0].date.getFullYear();
    const currentMonth = getMonthWeeks()[0][0].date.getMonth();
    
    allEvents.forEach(event => {
      // Parse event date
      const eventDate = new Date(event.start.dateTime);
      const eventYear = eventDate.getFullYear();
      const eventMonth = eventDate.getMonth();
      
      // Check if event is in the current month (regardless of which days are visible)
      if (eventYear === currentYear && eventMonth === currentMonth) {
        // Use the helper functions from Calendar.jsx instead of manual string checking
        if (isUnspecifiedLocation(event)) {
          locationsInRange.add('Unspecified');
        } else if (isEventVirtual(event)) {
          locationsInRange.add('Virtual');
        } else {
          // Handle physical locations - get the first physical location
          const locationText = event.location?.displayName?.trim() || '';
          const eventLocations = locationText
            .split(/[;,]/)
            .map(loc => loc.trim())
            .filter(loc => loc.length > 0);
          
          // Find first non-virtual location
          for (const location of eventLocations) {
            if (!isVirtualLocation(location)) {
              locationsInRange.add(location);
              break; // Only add the first physical location
            }
          }
        }
      }
    });
    
    return Array.from(locationsInRange).sort((a, b) => {
      // Sort with Virtual first, then Unspecified last
      if (a === 'Virtual' && b !== 'Virtual') return -1;
      if (b === 'Virtual' && a !== 'Virtual') return 1;
      if (a === 'Unspecified' && b !== 'Unspecified') return 1;
      if (b === 'Unspecified' && a !== 'Unspecified') return -1;
      return a.localeCompare(b);
    });
  }, [allEvents, getMonthWeeks, isEventVirtual, isUnspecifiedLocation, isVirtualLocation]);

  // Step 6: Use unified filter state - same as Day/Week views
  const handleCategoryToggleAll = useCallback(() => {
    const availableCategories = getAvailableCategoriesInRange();
    setSelectedCategories(availableCategories);
    updateUserProfilePreferences({ selectedCategories: availableCategories });
  }, [setSelectedCategories, getAvailableCategoriesInRange, updateUserProfilePreferences]);

  const handleCategoryToggleNone = useCallback(() => {
    setSelectedCategories([]);
    updateUserProfilePreferences({ selectedCategories: [] });
  }, [setSelectedCategories, updateUserProfilePreferences]);

  const handleLocationToggleAll = useCallback(() => {
    const availableLocations = getAvailableLocationsInRange();
    setSelectedLocations(availableLocations);
    updateUserProfilePreferences({ selectedLocations: availableLocations });
  }, [setSelectedLocations, getAvailableLocationsInRange, updateUserProfilePreferences]);

  const handleLocationToggleNone = useCallback(() => {
    setSelectedLocations([]);
    updateUserProfilePreferences({ selectedLocations: [] });
  }, [setSelectedLocations, updateUserProfilePreferences]);

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
      
      // UNIFIED: Use same filter logic as Day/Week views
      // Check category filter
      if (selectedCategories.length === 0) {
        return false; // No categories selected = show no events
      }
      
      let categoryMatch = false;
      const eventCategory = event.category || 'Uncategorized';
      
      for (const filterCategory of selectedCategories) {
        if (filterCategory === 'Other Categories') {
          if (!event.category || event.category.trim() === '' || event.category === 'Uncategorized') {
            continue;
          }
          if (outlookCategories.some(cat => cat.name === event.category)) {
            continue;
          }
          categoryMatch = true;
          break;
        } else if (eventCategory === filterCategory) {
          categoryMatch = true;
          break;
        }
      }
      
      if (!categoryMatch) {
        return false;
      }
      
      // Check location filter
      if (selectedLocations.length === 0) {
        return false; // No locations selected = show no events
      }
      
      let locationMatch = false;
      
      for (const filterLocation of selectedLocations) {
        if (filterLocation === 'Unspecified') {
          if (isUnspecifiedLocation(event)) {
            locationMatch = true;
            break;
          }
        } else if (filterLocation === 'Virtual') {
          if (isEventVirtual(event)) {
            locationMatch = true;
            break;
          }
        } else {
          if (hasPhysicalLocation(event, filterLocation)) {
            locationMatch = true;
            break;
          }
        }
      }
      
      return locationMatch;
    });
  }, [selectedDay, allEvents, outlookCategories, hasPhysicalLocation, isEventVirtual, isUnspecifiedLocation, selectedCategories, selectedLocations]);

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
                        // UNIFIED: Use same filter logic as Day/Week views
                        const dayEvents = allEvents.filter(event => {
                          // First check if event is on this day
                          if (!getMonthDayEventPosition(event, day.date)) return false;
                          
                          // Check category filter
                          if (selectedCategories.length === 0) {
                            return false; // No categories selected = show no events
                          }
                          
                          let categoryMatch = false;
                          const eventCategory = event.category || 'Uncategorized';
                          
                          for (const filterCategory of selectedCategories) {
                            if (filterCategory === 'Other Categories') {
                              if (!event.category || event.category.trim() === '' || event.category === 'Uncategorized') {
                                continue;
                              }
                              if (outlookCategories.some(cat => cat.name === event.category)) {
                                continue;
                              }
                              categoryMatch = true;
                              break;
                            } else if (eventCategory === filterCategory) {
                              categoryMatch = true;
                              break;
                            }
                          }
                          
                          if (!categoryMatch) {
                            return false;
                          }
                          
                          // Check location filter
                          if (selectedLocations.length === 0) {
                            return false; // No locations selected = show no events
                          }
                          
                          let locationMatch = false;
                          
                          for (const filterLocation of selectedLocations) {
                            if (filterLocation === 'Unspecified') {
                              if (isUnspecifiedLocation(event)) {
                                locationMatch = true;
                                break;
                              }
                            } else if (filterLocation === 'Virtual') {
                              if (isEventVirtual(event)) {
                                locationMatch = true;
                                break;
                              }
                            } else {
                              if (hasPhysicalLocation(event, filterLocation)) {
                                locationMatch = true;
                                break;
                              }
                            }
                          }
                          
                          return locationMatch;
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
            
            {/* NEW: Toggle buttons for Category */}
            <div className="toggle-buttons">
              <button 
                style={{
                  padding: '6px 12px',
                  backgroundColor: 'transparent',
                  color: 'var(--primary-color)',
                  border: '1px solid var(--primary-color)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s ease 0s',
                  flex: '1 1 0%',
                  whiteSpace: 'nowrap',
                  fontSize: '13px'
                }}
                onClick={handleCategoryToggleAll}
              >
                All
              </button>
              <button 
                style={{
                  padding: '6px 12px',
                  backgroundColor: 'transparent',
                  color: 'var(--primary-color)',
                  border: '1px solid var(--primary-color)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s ease 0s',
                  flex: '1 1 0%',
                  whiteSpace: 'nowrap',
                  fontSize: '13px'
                }}
                onClick={handleCategoryToggleNone}
              >
                None
              </button>
            </div>
            
            <select 
              value=""
              onChange={() => {}}
              className="month-filter-select"
              style={{ display: 'none' }} // Hide the old dropdown - kept for backward compatibility
            ></select>
            
            {/* NEW: MultiSelect for categories */}
            <MultiSelect 
              options={getAvailableCategoriesInRange()}
              selected={selectedCategories}
              onChange={(val) => {
                setSelectedCategories(val);
                updateUserProfilePreferences({ selectedCategories: val });
              }}
              label="Filter by categories"
              dropdownDirection="up"
              maxHeight={200}
              usePortal={true}
            />
          </div>
          
          <div className="filter-section">
            <h3>Filter by Location</h3>
            
            {/* NEW: Toggle buttons for Location */}
            <div className="toggle-buttons">
              <button 
                style={{
                  padding: '6px 12px',
                  backgroundColor: 'transparent',
                  color: 'var(--primary-color)',
                  border: '1px solid var(--primary-color)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s ease 0s',
                  flex: '1 1 0%',
                  whiteSpace: 'nowrap',
                  fontSize: '13px'
                }}
                onClick={handleLocationToggleAll}
              >
                All
              </button>
              <button 
                style={{
                  padding: '6px 12px',
                  backgroundColor: 'transparent',
                  color: 'var(--primary-color)',
                  border: '1px solid var(--primary-color)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s ease 0s',
                  flex: '1 1 0%',
                  whiteSpace: 'nowrap',
                  fontSize: '13px'
                }}
                onClick={handleLocationToggleNone}
              >
                None
              </button>
            </div>
            
            <select 
              value=""
              onChange={() => {}}
              className="month-filter-select"
              style={{ display: 'none' }} // Hide the old dropdown - kept for backward compatibility
            ></select>
            
            {/* NEW: MultiSelect for locations */}
            <MultiSelect 
              options={getAvailableLocationsInRange()}
              selected={selectedLocations}
              onChange={(val) => {
                setSelectedLocations(val);
                updateUserProfilePreferences({ selectedLocations: val });
              }}
              label="Filter by locations"
              dropdownDirection="up"
              maxHeight={200}
              usePortal={true}
            />
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