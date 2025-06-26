// src/components/SharedCalendarToggle.jsx
import React, { useState, useEffect } from 'react';
import './SharedCalendarToggle.css';

function SharedCalendarToggle({ 
  graphToken, 
  availableCalendars, 
  onSharedCalendarToggle, 
  isSharedCalendarEnabled = false 
}) {
  const [templeRegistrationsCalendar, setTempleRegistrationsCalendar] = useState(null);

  // Find the TempleRegistrations calendar
  useEffect(() => {
    if (availableCalendars) {
      const registrationsCalendar = availableCalendars.find(cal => 
        cal.name.toLowerCase().includes('templeregistrations') ||
        (cal.owner && cal.owner.address && cal.owner.address.includes('templeregistrations'))
      );
      setTempleRegistrationsCalendar(registrationsCalendar);
    }
  }, [availableCalendars]);

  // Don't show the toggle if we can't find the TempleRegistrations calendar
  if (!templeRegistrationsCalendar) {
    return null;
  }

  const handleToggle = () => {
    const newState = !isSharedCalendarEnabled;
    onSharedCalendarToggle(newState, templeRegistrationsCalendar);
  };

  return (
    <div className="shared-calendar-toggle">
      <label className="toggle-label">
        <input
          type="checkbox"
          checked={isSharedCalendarEnabled}
          onChange={handleToggle}
          className="toggle-checkbox"
        />
        <span className="toggle-slider"></span>
        <span className="toggle-text">
          Show Temple Registrations
        </span>
      </label>
    </div>
  );
}

export default SharedCalendarToggle;