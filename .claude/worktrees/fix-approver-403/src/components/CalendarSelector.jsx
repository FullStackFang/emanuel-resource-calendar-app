// src/components/CalendarSelector.jsx
import React from 'react';
import { logger } from '../utils/logger';
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
        logger.log('[CalendarSelector] onChange:', {
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
      {availableCalendars.map(calendar => {
        // Extract owner name from email (e.g., "templeeventssandbox@emanuelnyc.org" -> "TempleEventsSandbox")
        const ownerEmail = calendar.owner?.address || '';
        const ownerName = calendar.owner?.name || ownerEmail.split('@')[0] || 'Unknown';

        // Format display name - use owner name for default calendar, otherwise show calendar name with owner
        const displayName = calendar.isDefaultCalendar
          ? ownerName
          : `${calendar.name} (${ownerName})`;

        return (
          <option key={calendar.id} value={calendar.id}>
            {displayName}
          </option>
        );
      })}
    </select>
  );
}

export default CalendarSelector;