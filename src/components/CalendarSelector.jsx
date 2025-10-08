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
        onChange={(e) => {
          console.log('[CalendarSelector] onChange:', {
            currentValue: selectedCalendarId,
            newValue: e.target.value,
            changingCalendar
          });
          onCalendarChange(e.target.value);
        }}
        className={`nav-calendar-selector ${changingCalendar ? 'loading' : ''}`}
        disabled={changingCalendar}
        title={changingCalendar ? 'Loading calendar events...' : 'Select a calendar'}
      >
        {availableCalendars.map(calendar => (
          <option key={calendar.id} value={calendar.id}>
            {calendar.isDefaultCalendar ? `${calendar.name} (Default)` : `${calendar.name}${calendar.isShared ? ` (${calendar.owner?.name || 'Shared'})` : ''}`}
          </option>
        ))}
      </select>
      {changingCalendar && <span className="calendar-loading-indicator">Loading...</span>}
    </div>
  );
}

export default CalendarSelector;