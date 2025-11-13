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
 */
const MultiDatePicker = ({ selectedDates = [], onDatesChange, disabled = false }) => {

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

  return (
    <div className="multi-date-picker-container">
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

      {selectedDates.length === 0 && (
        <div className="no-dates-message">
          Click dates on the calendar to add them to your event series
        </div>
      )}
    </div>
  );
};

export default MultiDatePicker;
