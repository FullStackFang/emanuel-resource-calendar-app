// src/components/CalendarSelector.jsx
import React from 'react';
import './CalendarSelector.css';

/**
 * CalendarSelector - Dropdown for selecting which calendar to display
 * Now integrated into CalendarHeader toolbar styling
 */
function CalendarSelector({ selectedCalendarId, availableCalendars, onCalendarChange, changingCalendar, accessError }) {
  // Show error message if user has no access to any allowed calendars
  if (accessError) {
    return (
      <div className="calendar-selector-error" title={accessError}>
        <span className="error-icon">!</span>
        <span className="error-text">No calendar access</span>
      </div>
    );
  }

  if (!availableCalendars || availableCalendars.length === 0) {
    return null;
  }

  return (
    <select
      value={selectedCalendarId || ''}
      onChange={(e) => {
        console.log('[CalendarSelector] onChange:', {
          currentValue: selectedCalendarId,
          newValue: e.target.value,
          changingCalendar
        });
        onCalendarChange(e.target.value);
      }}
      className={`calendar-selector ${changingCalendar ? 'loading' : ''}`}
      disabled={changingCalendar}
      title={changingCalendar ? 'Loading calendar events...' : 'Select a calendar'}
    >
      {availableCalendars.map(calendar => (
        <option key={calendar.id} value={calendar.id}>
          {calendar.isDefaultCalendar
            ? `${calendar.name} (Default)`
            : `${calendar.name}${calendar.isShared ? ` (${calendar.owner?.name || 'Shared'})` : ''}`}
        </option>
      ))}
    </select>
  );
}

export default CalendarSelector;