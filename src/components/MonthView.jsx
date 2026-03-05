import React, { memo, useState, useCallback } from 'react';
import DayEventsPopup from './DayEventsPopup';
import { useTimezone } from '../context/TimezoneContext';
import { sortEventsByStartTime } from '../utils/eventTransformers';
import './MonthView.css';

const MAX_VISIBLE_EVENTS = 3;

// Convert hex color to rgba with transparency (same pattern as WeekView/DayView)
const hexToRgba = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

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
  handleMonthFilterChange,
  selectedCategories,
  selectedLocations,
  setSelectedCategories,
  setSelectedLocations,
  dynamicCategories,
  dynamicLocations,
  isEventVirtual,
  isUnspecifiedLocation,
  hasPhysicalLocation,
  isVirtualLocation,
  updateUserProfilePreferences,
  showRegistrationTimes,
  onRequestEdit,
  canAddEvent,
  // Lifted state from Calendar.jsx
  selectedDay,
  onDaySelect
}) => {
  const [overflowPopup, setOverflowPopup] = useState(null);

  // USE TIMEZONE CONTEXT INSTEAD OF PROP
  const { userTimezone } = useTimezone();

  // Clicking a day cell selects it (Calendar.jsx shows events in sidebar panel)
  const handleDayClick = useCallback((day) => {
    if (onDaySelect) {
      onDaySelect(day.date);
    }
  }, [onDaySelect]);

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

  // Get filtered events for a specific day cell
  const getDayFilteredEvents = useCallback((day) => {
    return filteredEvents.filter(event => {
      const year = day.date.getFullYear();
      const month = String(day.date.getMonth() + 1).padStart(2, '0');
      const dayNum = String(day.date.getDate()).padStart(2, '0');
      const dayDateStr = `${year}-${month}-${dayNum}`;

      let startDateStr, endDateStr;
      if (showRegistrationTimes && event.hasRegistrationEvent && event.registrationStart) {
        const regDate = new Date(event.registrationStart);
        startDateStr = regDate.toISOString().split('T')[0];
        endDateStr = startDateStr;
      } else {
        startDateStr = event.start.dateTime.split('T')[0];
        endDateStr = (event.end?.dateTime || event.start.dateTime).split('T')[0];
      }

      return dayDateStr >= startDateStr && dayDateStr <= endDateStr;
    });
  }, [filteredEvents, showRegistrationTimes]);

  // Handle overflow click - open popup near the clicked element
  const handleOverflowClick = useCallback((e, day, sorted) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setOverflowPopup({ day, events: sorted, anchorRect: rect });
  }, []);

  const handleClosePopup = useCallback(() => {
    setOverflowPopup(null);
  }, []);

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
                const dayFilteredEvents = getDayFilteredEvents(day);
                const sorted = sortEventsByStartTime(dayFilteredEvents);
                const visible = sorted.slice(0, MAX_VISIBLE_EVENTS);
                const overflowCount = sorted.length - MAX_VISIBLE_EVENTS;

                return (
                  <div
                    key={dayIndex}
                    className={`day-cell ${!day.isCurrentMonth ? 'outside-month' : ''} ${isSelected ? 'selected' : ''} ${isTodayDate ? 'current-day' : ''}`}
                    onClick={() => handleDayClick(day)}
                  >
                    <div className="day-cell-header">
                      <div className={`day-number ${isTodayDate ? 'today-number' : ''}`}>{day.date.getDate()}</div>
                    </div>
                    {canAddEvent && (
                      <button
                        className="cell-add-event-btn"
                        onClick={(e) => handleAddEventClick(e, day)}
                        title="Add new event"
                      >
                        +
                      </button>
                    )}

                    {/* Event snippets */}
                    <div className="day-cell-events">
                      {visible.map((event) => {
                        const categories = event.calendarData?.categories || event.categories || event.graphData?.categories || [];
                        const primaryCategory = categories[0] || 'Uncategorized';
                        const eventColor = getCategoryColor(primaryCategory);
                        const isPending = event.status === 'pending';
                        const isDraft = event.status === 'draft';
                        const bgAlpha = isDraft ? 0.08 : isPending ? 0.12 : 0.15;
                        const sourceTimezone = event.start?.timeZone || event.graphData?.start?.timeZone;
                        const startDateTime = event.start?.dateTime;
                        const shortTime = startDateTime
                          ? formatEventTime(startDateTime, userTimezone, event.subject, sourceTimezone)
                          : '';

                        return (
                          <div
                            key={event.eventId || event.id}
                            className={`month-event-snippet ${isPending ? 'snippet-pending' : ''} ${isDraft ? 'snippet-draft' : ''}`}
                            style={{
                              borderLeftColor: eventColor,
                              backgroundColor: hexToRgba(eventColor, bgAlpha)
                            }}
                            onClick={(e) => { e.stopPropagation(); handleEventClick(event, e); }}
                            title={`${shortTime ? shortTime + ' - ' : ''}${event.subject}`}
                          >
                            {shortTime && <span className="snippet-time">{shortTime}</span>}
                            <span className="snippet-title">{event.subject}</span>
                          </div>
                        );
                      })}
                      {overflowCount > 0 && (
                        <div
                          className="month-event-overflow"
                          onClick={(e) => handleOverflowClick(e, day, sorted)}
                        >
                          +{overflowCount} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Overflow popup (portal-based, Outlook-style) */}
      {overflowPopup && (
        <DayEventsPopup
          day={overflowPopup.day}
          events={overflowPopup.events}
          anchorRect={overflowPopup.anchorRect}
          onClose={handleClosePopup}
          onEventClick={handleEventClick}
          formatEventTime={formatEventTime}
          getCategoryColor={getCategoryColor}
          getLocationColor={getLocationColor}
          groupBy={groupBy}
          onRequestEdit={onRequestEdit}
        />
      )}
    </div>
  );
});

export default MonthView;
