// src/components/Navigation.jsx
import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import CalendarSelector from './CalendarSelector';
import SharedCalendarToggle from './SharedCalendarToggle';
import RegistrationTimesToggle from './RegistrationTimesToggle';
import './Navigation.css';

export default function Navigation({
  selectedCalendarId,
  availableCalendars,
  onCalendarChange,
  changingCalendar,
  graphToken,
  onSharedCalendarToggle,
  isSharedCalendarEnabled,
  showRegistrationTimes,
  onRegistrationTimesToggle
}) {
  const [adminExpanded, setAdminExpanded] = useState(false);
  const location = useLocation();
  const dropdownRef = useRef(null);

  // Close dropdown when location changes (user navigates to a new page)
  useEffect(() => {
    setAdminExpanded(false);
  }, [location]);

  // Add click outside handler
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setAdminExpanded(false);
      }
    }

    // Add event listener when dropdown is open
    if (adminExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    // Cleanup event listener
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [adminExpanded]);

  // Function to handle dropdown link clicks
  const handleDropdownLinkClick = () => {
    setAdminExpanded(false);
  };

  // Only render calendar selector when on the main calendar page
  const showCalendarSelector = location.pathname === '/';

  return (
    <nav className="main-navigation">
      <ul className="nav-list">
        <li>
          <NavLink to="/" className={({ isActive }) => isActive ? 'active' : ''}>
            Calendar
          </NavLink>
        </li>

        {/* Add calendar selector as a new list item */}
        {showCalendarSelector && availableCalendars && availableCalendars.length > 0 && (
          <li className="calendar-select-item">
            <CalendarSelector
              selectedCalendarId={selectedCalendarId}
              availableCalendars={availableCalendars}
              onCalendarChange={onCalendarChange}
              changingCalendar={changingCalendar}
            />
          </li>
        )}
        
        {/* Add shared calendar toggle */}
        {showCalendarSelector && (
          <li className="shared-calendar-toggle-item">
            <SharedCalendarToggle
              graphToken={graphToken}
              availableCalendars={availableCalendars}
              onSharedCalendarToggle={onSharedCalendarToggle}
              isSharedCalendarEnabled={isSharedCalendarEnabled}
            />
          </li>
        )}
        
        {/* Add registration times toggle */}
        {showCalendarSelector && (
          <li className="shared-calendar-toggle-item">
            <RegistrationTimesToggle
              showRegistrationTimes={showRegistrationTimes}
              onToggle={onRegistrationTimesToggle}
            />
          </li>
        )}

        <li>
          <NavLink to="/my-settings" className={({ isActive }) => isActive ? 'active' : ''}>
            My Profile
          </NavLink>
        </li>
        <li className="has-dropdown" ref={dropdownRef}>
          <div 
            className="dropdown-toggle"
            onClick={() => setAdminExpanded(!adminExpanded)}
          >
            Admin
            <span className={`dropdown-arrow ${adminExpanded ? 'expanded' : ''}`}>▼</span>
          </div>
          {adminExpanded && (
            <ul className="dropdown-menu">
              <li>
                <NavLink 
                  to="/admin" 
                  className={({ isActive }) => isActive ? 'active' : ''}
                  onClick={handleDropdownLinkClick}
                >
                  Schema Extensions
                </NavLink>
              </li>
              <li>
                <NavLink 
                  to="/admin/users" 
                  className={({ isActive }) => isActive ? 'active' : ''}
                  onClick={handleDropdownLinkClick}
                >
                  User Management
                </NavLink>
              </li>
              <li>
              <NavLink 
                to="/admin/event-sync" 
                className={({ isActive }) => isActive ? 'active' : ''}
                onClick={handleDropdownLinkClick}
              >
                Event Sync
              </NavLink>
            </li>
            </ul>
          )}
        </li>
      </ul>
    </nav>
  );
}