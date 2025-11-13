// src/components/MultiDatePicker.jsx
import React from 'react';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import './MultiDatePicker.css';

/**
 * MultiDatePicker - Allows selection of multiple non-sequential dates for event series
 * @param {Array} selectedDates - Array of date strings in YYYY-MM-DD format
 * @param {Function} onDatesChange - Callback when dates are added/removed
 * @param {Boolean} disabled - Whether the picker is disabled
 * @param {Array} seriesEvents - Array of events in the series for navigation
 * @param {String} currentEventId - ID of currently open event
 * @param {Function} onSeriesEventClick - Callback when series event button is clicked
 */
const MultiDatePicker = ({
  selectedDates = [],
  onDatesChange,
  disabled = false,
  seriesEvents = [],
  currentEventId = null,
  onSeriesEventClick = null
}) => {

  console.log('📅 MultiDatePicker Render:', {
    selectedDatesCount: selectedDates.length,
    seriesEventsCount: seriesEvents?.length || 0,
    hasSeriesEvents: !!(seriesEvents && seriesEvents.length > 0),
    currentEventId,
    seriesEvents
  });

  // Convert YYYY-MM-DD strings to Date objects for highlighting
  const selectedDateObjects = selectedDates.map(dateStr => new Date(dateStr + 'T00:00:00'));

  // Handle date selection from calendar
  const handleDateSelect = (date) => {
    if (disabled) return;

    // Convert to YYYY-MM-DD format
    const dateStr = date.toISOString().split('T')[0];

    // Check if date is already selected
    if (selectedDates.includes(dateStr)) {
      // Remove it if already selected (toggle behavior)
      const newDates = selectedDates.filter(d => d !== dateStr);
      onDatesChange(newDates);
    } else {
      // Add it if not selected
      const newDates = [...selectedDates, dateStr];
      onDatesChange(newDates);
    }
  };

  // Handle removing a specific date
  const handleRemoveDate = (dateStr) => {
    if (disabled) return;
    const newDates = selectedDates.filter(d => d !== dateStr);
    onDatesChange(newDates);
  };

  // Format date for display (e.g., "Mon, Nov 11, 2025")
  const formatDate = (dateStr) => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Sort dates chronologically
  const sortedDates = [...selectedDates].sort();

  // Handle series event navigation click
  const handleSeriesEventClick = (event) => {
    if (onSeriesEventClick && !disabled) {
      onSeriesEventClick(event);
    }
  };

  return (
    <div className="multi-date-picker-container">
      <div className="multi-date-picker-two-column">
        {/* Left Column: Calendar Picker */}
        <div className="multi-date-picker-calendar-column">
          <div className="multi-date-picker-calendar">
            <DatePicker
              inline
              selected={null}
              onChange={handleDateSelect}
              highlightDates={selectedDateObjects}
              disabled={disabled}
              calendarClassName="multi-date-calendar"
            />
          </div>

          {selectedDates.length === 0 && (
            <div className="no-dates-message">
              Click dates on the calendar to add them to your event series
            </div>
          )}
        </div>

        {/* Right Column: Series Navigation */}
        {seriesEvents && seriesEvents.length > 0 && (
          <div className="series-navigation-column">
            <div className="series-navigation-header">
              <h4>Events in Series ({seriesEvents.length})</h4>
            </div>
            <div className="series-navigation-list">
              {seriesEvents.map(event => {
                const isCurrent = event.eventId === currentEventId;
                return (
                  <button
                    key={event.eventId}
                    type="button"
                    className={`series-event-btn ${isCurrent ? 'current' : ''}`}
                    onClick={() => handleSeriesEventClick(event)}
                    disabled={disabled || isCurrent}
                  >
                    {formatDate(event.startDate)}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Selected dates section - spans full width below calendar and series */}
      {selectedDates.length > 0 && (
        <div className="selected-dates-section">
          <div className="selected-dates-header">
            <span className="selected-count">{selectedDates.length} date{selectedDates.length !== 1 ? 's' : ''} selected</span>
          </div>

          <div className="selected-dates-list">
            {sortedDates.map(dateStr => (
              <div key={dateStr} className="date-chip">
                <span className="date-text">{formatDate(dateStr)}</span>
                <button
                  type="button"
                  className="remove-date-btn"
                  onClick={() => handleRemoveDate(dateStr)}
                  disabled={disabled}
                  aria-label={`Remove ${formatDate(dateStr)}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiDatePicker;
