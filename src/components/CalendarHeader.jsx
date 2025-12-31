// src/components/CalendarHeader.jsx
import React from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { TimezoneSelector } from '../utils/timezoneUtils';
import CalendarSelector from './CalendarSelector';
import './CalendarHeader.css';

/**
 * DatePickerButton component for calendar date selection
 */
const DatePickerButton = ({ currentDate, onDateChange, viewType }) => {
  const [showPicker, setShowPicker] = React.useState(false);
  const wrapperRef = React.useRef(null);

  // Close picker when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setShowPicker(false);
      }
    };
    if (showPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPicker]);

  const handleDateSelect = (date) => {
    onDateChange(date);
    setShowPicker(false);
  };

  const formattedDate = currentDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  return (
    <div className="date-picker-wrapper" ref={wrapperRef}>
      <button
        className="date-picker-input"
        onClick={() => setShowPicker(!showPicker)}
        title="Select date"
      >
        📅 {formattedDate}
      </button>
      {showPicker && (
        <div className="date-picker-dropdown">
          <DatePicker
            selected={currentDate}
            onChange={handleDateSelect}
            inline
            showMonthDropdown
            showYearDropdown
            dropdownMode="select"
          />
        </div>
      )}
    </div>
  );
};

/**
 * CalendarHeader - Minimalist toolbar-style header for calendar controls
 *
 * Contains two rows:
 * - Top row: Navigation controls (prev/next/today) and view selector (day/week/month)
 * - Bottom row: Calendar selector, timezone, week start, and grouping mode
 */
const CalendarHeader = ({
  // View and navigation
  viewType,
  currentDate,
  dateRange,
  onViewChange,
  onDateChange,
  onNavigate,

  // Settings
  timezone,
  weekStart,
  onTimezoneChange,
  onWeekStartChange,

  // Grouping (only shown in week/day view)
  groupBy,
  onGroupByChange,

  // Calendar selection
  selectedCalendarId,
  availableCalendars,
  onCalendarChange,
  changingCalendar,
  calendarAccessError,

  // User preferences update
  updateUserProfilePreferences
}) => {

  // Format date range display
  const formatDateRange = () => {
    if (viewType === 'day') {
      return currentDate.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });
    }

    if (viewType === 'month') {
      return currentDate.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric'
      });
    }

    // Week view
    return `${dateRange.start.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    })} - ${dateRange.end.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })}`;
  };

  return (
    <div className="calendar-header">
      <div className="calendar-controls">

        {/* TOP ROW - Navigation and View Selector */}
        <div className="header-top-row">
          <div className="navigation-group">
            <div className="navigation">
              <button onClick={() => onNavigate('previous')} className="nav-button">
                Previous
              </button>
              <button onClick={() => onNavigate('today')} className="nav-button">
                Today
              </button>
              <DatePickerButton
                currentDate={currentDate}
                onDateChange={onDateChange}
                viewType={viewType}
              />
              <button onClick={() => onNavigate('next')} className="nav-button">
                Next
              </button>
            </div>

            <div className="current-range">
              {formatDateRange()}
            </div>
          </div>

          <div className="view-selector">
            <button
              className={viewType === 'day' ? 'active' : ''}
              onClick={() => onViewChange('day')}
            >
              Day
            </button>
            <button
              className={viewType === 'week' ? 'active' : ''}
              onClick={() => onViewChange('week')}
            >
              Week
            </button>
            <button
              className={viewType === 'month' ? 'active' : ''}
              onClick={() => onViewChange('month')}
            >
              Month
            </button>
          </div>
        </div>

        {/* BOTTOM ROW - Settings and Grouping */}
        <div className="header-bottom-row">
          <div className="settings-group">
            {/* Calendar Selector */}
            <div className="calendar-selector-wrapper">
              <CalendarSelector
                selectedCalendarId={selectedCalendarId}
                availableCalendars={availableCalendars}
                onCalendarChange={onCalendarChange}
                changingCalendar={changingCalendar}
                accessError={calendarAccessError}
              />
            </div>

            {/* Timezone Selector */}
            <div className="time-zone-selector">
              <TimezoneSelector
                value={timezone}
                onChange={onTimezoneChange}
                showLabel={false}
                className="timezone-select"
              />
            </div>

            {/* Week Start Selector */}
            <div className="week-start-selector">
              <select
                value={weekStart}
                onChange={onWeekStartChange}
                className="week-start-select"
              >
                <option value="Sunday">Sunday start of Week</option>
                <option value="Monday">Monday start of Week</option>
              </select>
            </div>
          </div>

          {/* Group By Selector - Only show in week/day views */}
          {viewType !== 'month' && (
            <div className="view-mode-selector">
              <button
                className={groupBy === 'categories' ? 'active' : ''}
                onClick={() => onGroupByChange('categories')}
              >
                Group by Category
              </button>
              <button
                className={groupBy === 'locations' ? 'active' : ''}
                onClick={() => onGroupByChange('locations')}
              >
                Group by Location
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CalendarHeader;
