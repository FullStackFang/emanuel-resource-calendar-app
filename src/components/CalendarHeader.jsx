// src/components/CalendarHeader.jsx
import React from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { TimezoneSelector } from '../utils/timezoneUtils';
import CalendarSelector from './CalendarSelector';
import './CalendarHeader.css';

/**
 * Custom input component for DatePicker
 * Shows contextual date range text and a dropdown chevron
 */
const CustomDateInput = React.forwardRef(({ value, onClick, displayText, isOpen }, ref) => (
  <div className={`date-picker-input-group${isOpen ? ' open' : ''}`} onClick={onClick} ref={ref}>
    <span className="date-picker-display">{displayText || value}</span>
    <span className="date-picker-chevron" title="Open calendar picker">
      <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  </div>
));

CustomDateInput.displayName = 'CustomDateInput';

/**
 * DatePickerButton component for calendar date selection
 * Shows view-appropriate date range text as the trigger
 */
const DatePickerButton = ({ currentDate, onDateChange, displayText }) => {
  const [isOpen, setIsOpen] = React.useState(false);

  const handleDateSelect = (date) => {
    if (date) {
      onDateChange(date);
    }
  };

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const minYear = 2020;
  const maxYear = 2035;
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);

  return (
    <div className="date-picker-wrapper">
      <DatePicker
        selected={currentDate}
        onChange={handleDateSelect}
        onCalendarOpen={() => setIsOpen(true)}
        onCalendarClose={() => setIsOpen(false)}
        customInput={<CustomDateInput displayText={displayText} isOpen={isOpen} />}
        dateFormat="MMM d, yyyy"
        popperClassName="date-picker-popper"
        popperPlacement="bottom"
        showPopperArrow={false}
        renderCustomHeader={({
          date,
          changeYear,
          changeMonth,
        }) => (
          <div className="dp-custom-header">
            <div className="dp-custom-header__select-wrapper">
              <select
                className="dp-custom-header__select dp-custom-header__select--month"
                value={date.getMonth()}
                onChange={({ target: { value } }) => changeMonth(Number(value))}
              >
                {months.map((month, i) => (
                  <option key={month} value={i}>{month}</option>
                ))}
              </select>
              <svg className="dp-custom-header__chevron" width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="dp-custom-header__select-wrapper">
              <select
                className="dp-custom-header__select dp-custom-header__select--year"
                value={date.getFullYear()}
                onChange={({ target: { value } }) => changeYear(Number(value))}
              >
                {years.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
              <svg className="dp-custom-header__chevron" width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
        )}
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

  // Format contextual date display based on view type
  const getDateDisplayText = () => {
    if (viewType === 'day') {
      return currentDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
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

    // Week view - show range
    const startMonth = dateRange.start.toLocaleDateString('en-US', { month: 'short' });
    const endMonth = dateRange.end.toLocaleDateString('en-US', { month: 'short' });
    const startDay = dateRange.start.getDate();
    const endDay = dateRange.end.getDate();
    const year = dateRange.end.getFullYear();

    if (startMonth === endMonth) {
      return `${startMonth} ${startDay} – ${endDay}, ${year}`;
    }
    return `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${year}`;
  };

  return (
    <div className="calendar-header">
      <div className="calendar-controls">

        {/* TOP ROW - Navigation and View Selector */}
        <div className="header-top-row">
          <div className="navigation-group">
            <div className="navigation">
              <button
                onClick={() => onNavigate('previous')}
                className="nav-button nav-arrow"
                aria-label="Previous"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8.5 3L4.5 7L8.5 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              <DatePickerButton
                currentDate={currentDate}
                onDateChange={onDateChange}
                displayText={getDateDisplayText()}
              />

              <button
                onClick={() => onNavigate('next')}
                className="nav-button nav-arrow"
                aria-label="Next"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5.5 3L9.5 7L5.5 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              <button onClick={() => onNavigate('today')} className="nav-button nav-today">
                Today
              </button>
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
