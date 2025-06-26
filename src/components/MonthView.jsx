import React, { memo, useState, useCallback, useEffect } from 'react';
import DayEventPanel from './DayEventPanel';
import MultiSelect from './MultiSelect';
import { useTimezone } from '../context/TimezoneContext';
import { formatDateTimeWithTimezone } from '../utils/timezoneUtils';
import './MonthView.css';

const MonthView = memo(({ 
  // Props this component needs
  getMonthWeeks,
  getWeekdayHeaders,
  selectedFilter,
  handleEventClick,
  handleDayCellClick,
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
  // REMOVED: userTimeZone prop - now using context
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
  const [showSetupTeardown, setShowSetupTeardown] = useState(false);
  
  // USE TIMEZONE CONTEXT INSTEAD OF PROP
  const { userTimezone } = useTimezone();
  
  // DEBUG: Add console logs to see what data we're getting
  useEffect(() => {
    console.log('=== MONTHVIEW DEBUG ===');
    console.log('allEvents:', allEvents?.length || 0);
    console.log('filteredEvents:', filteredEvents?.length || 0);
    console.log('dynamicCategories:', dynamicCategories);
    console.log('dynamicLocations:', dynamicLocations);
    console.log('selectedCategories:', selectedCategories);
    console.log('selectedLocations:', selectedLocations);
    console.log('userTimezone from context:', userTimezone);
    console.log('========================');
  }, [allEvents, filteredEvents, dynamicCategories, dynamicLocations, selectedCategories, selectedLocations, userTimezone]);
  
  const handleDayClick = useCallback((day) => {
    setSelectedDay(day.date);
    // Also trigger the add event functionality
    if (handleDayCellClick) {
      handleDayCellClick(day.date);
    }
  }, [handleDayCellClick]);

  // Memoize category calculation to prevent unnecessary re-renders
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

  // Memoize location calculation to prevent unnecessary re-renders
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

  // Force re-calculation of events when timezone changes
  const getEventsForSelectedDay = useCallback(() => {
    if (!selectedDay) return [];
    
    const eventsForDay = filteredEvents.filter(event => {
      const eventDate = new Date(event.start.dateTime);
      
      return (
        eventDate.getFullYear() === selectedDay.getFullYear() &&
        eventDate.getMonth() === selectedDay.getMonth() &&
        eventDate.getDate() === selectedDay.getDate()
      );
    });

    // Add timezone to each event for proper formatting
    return eventsForDay.map(event => ({
      ...event,
      _timezone: userTimezone // Add timezone info for formatting
    }));
  }, [selectedDay, filteredEvents, userTimezone]);

  // Memoize the available options to prevent unnecessary re-renders
  const availableCategories = useCallback(() => getAvailableCategoriesInRange(), [getAvailableCategoriesInRange]);
  const availableLocations = useCallback(() => getAvailableLocationsInRange(), [getAvailableLocationsInRange]);

  // Memoize category change handler
  const handleCategoryChange = useCallback((val) => {
    console.log('Category selection changed to:', val);
    if (setSelectedCategories && typeof setSelectedCategories === 'function') {
      setSelectedCategories(val);
      if (updateUserProfilePreferences && typeof updateUserProfilePreferences === 'function') {
        updateUserProfilePreferences({ selectedCategories: val });
      }
    } else {
      console.error('setSelectedCategories is not a function:', typeof setSelectedCategories);
    }
  }, [setSelectedCategories, updateUserProfilePreferences]);

  // Memoize location change handler
  const handleLocationChange = useCallback((val) => {
    console.log('Location selection changed to:', val);
    if (setSelectedLocations && typeof setSelectedLocations === 'function') {
      setSelectedLocations(val);
      if (updateUserProfilePreferences && typeof updateUserProfilePreferences === 'function') {
        updateUserProfilePreferences({ selectedLocations: val });
      }
    } else {
      console.error('setSelectedLocations is not a function:', typeof setSelectedLocations);
    }
  }, [setSelectedLocations, updateUserProfilePreferences]);

  // Create a custom formatEventTime function that uses the timezone context
  const formatEventTimeWithTimezone = useCallback((event) => {
    if (formatEventTime && typeof formatEventTime === 'function') {
      // Use the original formatEventTime if it exists and handles timezone properly
      return formatEventTime(event, userTimezone); // Pass timezone explicitly
    }
    
    // Fallback: format using timezone context
    try {
      const startTime = formatDateTimeWithTimezone(event.start.dateTime, userTimezone);
      const endTime = formatDateTimeWithTimezone(event.end.dateTime, userTimezone);
      return `${startTime} - ${endTime}`;
    } catch (error) {
      console.error('Error formatting event time:', error);
      return 'Time unavailable';
    }
  }, [formatEventTime, userTimezone]);

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
                          
                          // Check if any events have setup/teardown times
                          const hasSetupTeardown = dayFilteredEvents.some(event => 
                            (event.setupMinutes && event.setupMinutes > 0) || 
                            (event.teardownMinutes && event.teardownMinutes > 0)
                          );
                          
                          // Calculate total setup/teardown time for tooltip
                          const totalSetupTeardown = dayFilteredEvents.reduce((total, event) => {
                            return total + (event.setupMinutes || 0) + (event.teardownMinutes || 0);
                          }, 0);
                          
                          const backgroundColor = showSetupTeardown && hasSetupTeardown 
                            ? '#f59e0b' // Orange when showing setup/teardown times
                            : hasSetupTeardown 
                              ? '#10b981' // Green with slight blue tint when has setup/teardown but not showing
                              : '#4caf50'; // Standard green for regular events
                          
                          const tooltipText = showSetupTeardown && hasSetupTeardown
                            ? `${dayFilteredEvents.length} events (${totalSetupTeardown}min setup/teardown)`
                            : hasSetupTeardown
                              ? `${dayFilteredEvents.length} events (with setup/teardown times)`
                              : `${dayFilteredEvents.length} events visible`;
                          
                          return (
                            <div 
                              className="event-count-circle"
                              style={{
                                width: `${size}px`,
                                height: `${size}px`,
                                fontSize: `${Math.min(14 + (dayFilteredEvents.length * 0.5), 20)}px`,
                                backgroundColor,
                                border: showSetupTeardown && hasSetupTeardown ? '2px solid #d97706' : 'none'
                              }}
                              title={tooltipText}
                            >
                              {dayFilteredEvents.length}
                              {showSetupTeardown && hasSetupTeardown && (
                                <div style={{
                                  position: 'absolute',
                                  bottom: '-2px',
                                  right: '-2px',
                                  width: '8px',
                                  height: '8px',
                                  backgroundColor: '#dc2626',
                                  borderRadius: '50%',
                                  fontSize: '8px',
                                  color: 'white',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center'
                                }}>
                                  ⏱
                                </div>
                              )}
                            </div>
                          );
                        }

                        // Don't show anything if no events pass the filter
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
            
            <MultiSelect
              options={availableCategories()}
              selected={selectedCategories || []}
              onChange={handleCategoryChange}
              label="categories"
              maxHeight={200}
            />
          </div>
          
          <div className="filter-section">
            <h3>Filter by Location</h3>
            
            <MultiSelect
              options={availableLocations()}
              selected={selectedLocations || []}
              onChange={handleLocationChange}
              label="locations"
              maxHeight={200}
            />
          </div>
          
          <div className="filter-section">
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '8px',
              background: '#f8f9fa',
              borderRadius: '4px',
              border: '1px solid #e5e7eb'
            }}>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer',
                margin: 0
              }}>
                <input
                  type="checkbox"
                  checked={showSetupTeardown}
                  onChange={(e) => setShowSetupTeardown(e.target.checked)}
                  style={{ margin: 0 }}
                />
                📋 Show Setup/Teardown
              </label>
            </div>
          </div>
        </div>
      
        <DayEventPanel
          selectedDay={selectedDay}
          events={getEventsForSelectedDay()}
          onEventClick={handleEventClick}
          onEventEdit={handleEventClick} // Reuse existing click handler for edit
          onEventDelete={handleEventClick} // Reuse existing click handler for delete
          formatEventTime={formatEventTimeWithTimezone} // Use timezone-aware formatter
          getCategoryColor={getCategoryColor}
          getLocationColor={getLocationColor}
          groupBy={groupBy}
          key={`${selectedDay?.toISOString()}-${userTimezone}`} // Force re-render on timezone change
          // REMOVED: userTimeZone prop - DayEventPanel now uses context directly
        />

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
          <div>Categories ({selectedCategories?.length || 0}), Locations ({selectedLocations?.length || 0})</div>
          <div><strong>Events: {filteredEvents?.length || 0} visible / {allEvents?.length || 0} total</strong></div>
          <div><strong>Setup/Teardown: {showSetupTeardown ? 'Visible' : 'Hidden'}</strong></div>
          <div><strong>Timezone: {userTimezone}</strong></div>
        </div>
      </div>
    </div>
  );
});

export default MonthView;