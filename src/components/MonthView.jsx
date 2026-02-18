import React, { memo, useState, useCallback } from 'react';
import DayEventPanel from './DayEventPanel';
import MultiSelect from './MultiSelect';
import { useTimezone } from '../context/TimezoneContext';
import { formatDateTimeWithTimezone } from '../utils/timezoneUtils';
import { sortEventsByStartTime } from '../utils/eventTransformers';
import { logger } from '../utils/logger';
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
  updateUserProfilePreferences,
  showRegistrationTimes,
  // Request edit handler (passed from Calendar.jsx)
  onRequestEdit
}) => {
  const [selectedDay, setSelectedDay] = useState(null);
  const [showSetupTeardown, setShowSetupTeardown] = useState(false);

  // USE TIMEZONE CONTEXT INSTEAD OF PROP
  const { userTimezone } = useTimezone();
  
  // Clicking a day cell just selects it (shows events in panel)
  const handleDayClick = useCallback((day) => {
    setSelectedDay(day.date);
  }, []);

  // Clicking the + button opens the add event modal
  const handleAddEventClick = useCallback((e, day) => {
    e.stopPropagation(); // Don't trigger day selection
    if (handleDayCellClick) {
      handleDayCellClick(day.date);
    }
  }, [handleDayCellClick]);

  // Check if a date is today
  const isToday = useCallback((date) => {
    const today = new Date();
    return date.getFullYear() === today.getFullYear() &&
           date.getMonth() === today.getMonth() &&
           date.getDate() === today.getDate();
  }, []);

  // Memoize category calculation to prevent unnecessary re-renders
  const getAvailableCategoriesInRange = useCallback(() => {
    if (dynamicCategories && dynamicCategories.length > 0) {
      return dynamicCategories;
    }

    // Fallback: extract from all events
    if (!allEvents || !Array.isArray(allEvents) || allEvents.length === 0) {
      return [];
    }

    const categoriesInRange = new Set();
    allEvents.forEach(event => {
      // Check calendarData.categories first (authoritative), then top-level, then graphData fallback
      const categories = event.calendarData?.categories || event.categories || event.graphData?.categories || (event.category ? [event.category] : ['Uncategorized']);
      const category = categories[0] || 'Uncategorized';
      categoriesInRange.add(category);
    });

    return Array.from(categoriesInRange).sort();
  }, [dynamicCategories, allEvents]);

  // Memoize location calculation to prevent unnecessary re-renders
  const getAvailableLocationsInRange = useCallback(() => {
    if (dynamicLocations && dynamicLocations.length > 0) {
      return dynamicLocations;
    }

    // Fallback: extract from all events
    if (!allEvents || !Array.isArray(allEvents) || allEvents.length === 0) {
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

    return Array.from(locationsInRange).sort();
  }, [dynamicLocations, allEvents]);

  // Force re-calculation of events when timezone changes
  const getEventsForSelectedDay = useCallback(() => {
    if (!selectedDay) return [];

    // Set up day boundaries for range comparison
    const dayStart = new Date(selectedDay);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(selectedDay);
    dayEnd.setHours(23, 59, 59, 999);

    const eventsForDay = filteredEvents.filter(event => {
      const startDate = new Date(event.start.dateTime);
      const endDate = new Date(event.end?.dateTime || event.start.dateTime);

      // Event overlaps with this day if it starts before day ends AND ends after day starts
      return startDate <= dayEnd && endDate >= dayStart;
    });

    // Sort events by start time and add timezone for proper formatting
    return sortEventsByStartTime(eventsForDay).map(event => ({
      ...event,
      _timezone: userTimezone // Add timezone info for formatting
    }));
  }, [selectedDay, filteredEvents, userTimezone]);

  // Memoize the available options to prevent unnecessary re-renders
  const availableCategories = useCallback(() => getAvailableCategoriesInRange(), [getAvailableCategoriesInRange]);
  const availableLocations = useCallback(() => getAvailableLocationsInRange(), [getAvailableLocationsInRange]);

  // Memoize category change handler
  const handleCategoryChange = useCallback((val) => {
    if (setSelectedCategories && typeof setSelectedCategories === 'function') {
      setSelectedCategories(val);
      if (updateUserProfilePreferences && typeof updateUserProfilePreferences === 'function') {
        updateUserProfilePreferences({ selectedCategories: val });
      }
    } else {
      logger.error('setSelectedCategories is not a function:', typeof setSelectedCategories);
    }
  }, [setSelectedCategories, updateUserProfilePreferences]);

  // Memoize location change handler
  const handleLocationChange = useCallback((val) => {
    if (setSelectedLocations && typeof setSelectedLocations === 'function') {
      setSelectedLocations(val);
      if (updateUserProfilePreferences && typeof updateUserProfilePreferences === 'function') {
        updateUserProfilePreferences({ selectedLocations: val });
      }
    } else {
      logger.error('setSelectedLocations is not a function:', typeof setSelectedLocations);
    }
  }, [setSelectedLocations, updateUserProfilePreferences]);

  // Create a custom formatEventTime function that matches DayEventPanel's expected signature
  // DayEventPanel calls: formatEventTime(dateTimeString, eventSubject, sourceTimezone)
  const formatEventTimeForPanel = useCallback((dateTimeString, eventSubject, sourceTimezone) => {
    if (!dateTimeString) {
      return 'Time unavailable';
    }

    if (formatEventTime && typeof formatEventTime === 'function') {
      return formatEventTime(dateTimeString, userTimezone, eventSubject, sourceTimezone);
    }

    // Fallback: format using timezone context
    try {
      return formatDateTimeWithTimezone(dateTimeString, userTimezone);
    } catch (error) {
      logger.error('Error formatting event time:', error);
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
                const isTodayDate = isToday(day.date);

                return (
                  <div
                    key={dayIndex}
                    className={`day-cell ${!day.isCurrentMonth ? 'outside-month' : ''} ${isSelected ? 'selected' : ''} ${isTodayDate ? 'current-day' : ''}`}
                    onClick={() => handleDayClick(day)}
                  >
                    {/* Add event button in top-left */}
                    {day.isCurrentMonth && (
                      <button
                        className="add-event-btn"
                        onClick={(e) => handleAddEventClick(e, day)}
                        title="Add new event"
                      >
                        +
                      </button>
                    )}
                    <div className={`day-number ${isTodayDate ? 'today-number' : ''}`}>{day.date.getDate()}</div>
                    
                    <div className="day-events">
                      {(() => {
                        // Use filteredEvents from Calendar's main filtering system
                        const dayFilteredEvents = filteredEvents.filter(event => {
                          // Compare date strings directly (YYYY-MM-DD format)
                          const year = day.date.getFullYear();
                          const month = String(day.date.getMonth() + 1).padStart(2, '0');
                          const dayNum = String(day.date.getDate()).padStart(2, '0');
                          const dayDateStr = `${year}-${month}-${dayNum}`;

                          let startDateStr, endDateStr;
                          if (showRegistrationTimes && event.hasRegistrationEvent && event.registrationStart) {
                            const regDate = new Date(event.registrationStart);
                            startDateStr = regDate.toISOString().split('T')[0];
                            endDateStr = startDateStr; // Registration times are single-day
                          } else {
                            startDateStr = event.start.dateTime.split('T')[0];
                            endDateStr = (event.end?.dateTime || event.start.dateTime).split('T')[0];
                          }

                          return dayDateStr >= startDateStr && dayDateStr <= endDateStr;
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
                          
                          const backgroundColor = showRegistrationTimes && hasSetupTeardown 
                            ? '#f59e0b' // Orange when showing setup/teardown times
                            : hasSetupTeardown 
                              ? '#10b981' // Green with slight blue tint when has setup/teardown but not showing
                              : '#4caf50'; // Standard green for regular events
                          
                          const tooltipText = showRegistrationTimes && hasSetupTeardown
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
                                border: showRegistrationTimes && hasSetupTeardown ? '2px solid #d97706' : 'none'
                              }}
                              title={tooltipText}
                            >
                              {dayFilteredEvents.length}
                              {showRegistrationTimes && hasSetupTeardown && (
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
          
        </div>
      
        <DayEventPanel
          selectedDay={selectedDay}
          events={getEventsForSelectedDay()}
          onEventClick={handleEventClick}
          onEventEdit={handleEventClick} // Reuse existing click handler for edit
          onEventDelete={handleEventClick} // Reuse existing click handler for delete
          onRequestEdit={onRequestEdit} // Handler for edit request button (from Calendar.jsx)
          formatEventTime={formatEventTimeForPanel} // Use timezone-aware formatter with correct signature
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
          <div><strong>Setup/Teardown: {showRegistrationTimes ? 'Visible' : 'Hidden'}</strong></div>
          <div><strong>Timezone: {userTimezone}</strong></div>
        </div>
      </div>
    </div>
  );
});

export default MonthView;