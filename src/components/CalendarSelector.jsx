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
        disabled={changingCalendar}
      >
        {availableCalendars.map(calendar => (
          <option key={calendar.id} value={calendar.id}>
            {calendar.isDefaultCalendar ? `${calendar.name} (Default)` : `${calendar.name}${calendar.isShared ? ` (${calendar.owner?.name || 'Shared'})` : ''}`}
          </option>
        ))}
      </select>
    </div>
  );
}

export default CalendarSelector;