// src/components/CalendarHeader.jsx
import React from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { TimezoneSelector } from '../utils/timezoneUtils';
import CalendarSelector from './CalendarSelector';
import './CalendarHeader.css';

/**
 * Custom input component for DatePicker
 * Shows the date and calendar icon, clicking opens the picker
 */
const CustomDateInput = React.forwardRef(({ value, onClick }, ref) => (
  <div className="date-picker-input-group" onClick={onClick} ref={ref}>
    <span className="date-picker-display">{value}</span>
    <span className="date-picker-calendar-btn" title="Open calendar picker">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12.667 2.667H3.333C2.597 2.667 2 3.264 2 4v9.333c0 .737.597 1.334 1.333 1.334h9.334c.736 0 1.333-.597 1.333-1.334V4c0-.736-.597-1.333-1.333-1.333z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M10.667 1.333v2.667M5.333 1.333v2.667M2 6.667h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  </div>
));

CustomDateInput.displayName = 'CustomDateInput';

/**
 * DatePickerButton component for calendar date selection
 * Uses react-datepicker with text input mode for proper date validation
 */
const DatePickerButton = ({ currentDate, onDateChange }) => {
  const [isOpen, setIsOpen] = React.useState(false);

  const handleDateSelect = (date) => {
    if (date) {
      onDateChange(date);
    }
  };

  return (
    <div className="date-picker-wrapper">
      <DatePicker
        selected={currentDate}
        onChange={handleDateSelect}
        onCalendarOpen={() => setIsOpen(true)}
        onCalendarClose={() => setIsOpen(false)}
        customInput={<CustomDateInput />}
        dateFormat="MMM d, yyyy"
        showMonthDropdown
        showYearDropdown
        dropdownMode="select"
        popperClassName="date-picker-popper"
        popperPlacement="bottom-start"
        showPopperArrow={false}
      />
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
