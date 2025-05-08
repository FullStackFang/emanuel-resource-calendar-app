// src/components/CalendarSelector.jsx
import React from 'react';

function CalendarSelector({ selectedCalendarId, availableCalendars, onCalendarChange, changingCalendar }) {
  if (!availableCalendars || availableCalendars.length === 0) {
    return null;
  }
  
  return (
    <div className="nav-calendar-selector-container">
      <select
        value={selectedCalendarId || ''}
        onChange={(e) => onCalendarChange(e.target.value)}
        className="nav-calendar-selector"
      >
        {availableCalendars.map(calendar => (
          <option key={calendar.id} value={calendar.id}>
            {calendar.isDefault ? `${calendar.name} (Default)` : `${calendar.name} (${calendar.owner})`}
          </option>
        ))}
      </select>
    </div>
  );
}

export default CalendarSelector;