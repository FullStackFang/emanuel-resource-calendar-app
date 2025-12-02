// src/components/Navigation.jsx
import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions';
import './Navigation.css';

export default function Navigation() {
  const {
    canSubmitReservation,
    canApproveReservations,
    isAdmin
  } = usePermissions();
  const [adminExpanded, setAdminExpanded] = useState(false);
  const location = useLocation();
  const dropdownRef = useRef(null);

  // Close dropdowns when location changes (user navigates to a new page)
  useEffect(() => {
    setAdminExpanded(false);
  }, [location]);

  // Add click outside handler for admin dropdown
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

  return (
    <nav className="main-navigation">
      <ul className="nav-list">
        <li>
          <NavLink to="/" className={({ isActive }) => isActive ? 'active' : ''}>
            Calendar
          </NavLink>
        </li>

        {/* My Reservations - visible for Requester, Approver, Admin */}
        {canSubmitReservation && (
          <li>
            <NavLink to="/my-reservations" className={({ isActive }) => isActive ? 'active' : ''}>
              My Reservations
            </NavLink>
          </li>
        )}

        {/* Reservation Requests - visible for Approver (when not full Admin) */}
        {canApproveReservations && !isAdmin && (
          <li>
            <NavLink to="/admin/reservation-requests" className={({ isActive }) => isActive ? 'active' : ''}>
              Reservation Requests
            </NavLink>
          </li>
        )}

        <li>
          <NavLink to="/my-settings" className={({ isActive }) => isActive ? 'active' : ''}>
            My Profile
          </NavLink>
        </li>

        {/* Admin dropdown - only visible for Admin role */}
        {isAdmin && (
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
                    to="/admin/users"
                    className={({ isActive }) => isActive ? 'active' : ''}
                    onClick={handleDropdownLinkClick}
                  >
                    User Management
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/admin/events"
                    className={({ isActive }) => isActive ? 'active' : ''}
                    onClick={handleDropdownLinkClick}
                  >
                    Unified Events Admin
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/admin/locations"
                    className={({ isActive }) => isActive ? 'active' : ''}
                    onClick={handleDropdownLinkClick}
                  >
                    Location Management
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/booking"
                    className={({ isActive }) => isActive ? 'active' : ''}
                    onClick={handleDropdownLinkClick}
                  >
                    ✨ External Form (Unified)
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/room-reservation"
                    className={({ isActive }) => isActive ? 'active' : ''}
                    onClick={handleDropdownLinkClick}
                  >
                    📋 Legacy Form
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/admin/reservation-requests"
                    className={({ isActive }) => isActive ? 'active' : ''}
                    onClick={handleDropdownLinkClick}
                  >
                    Reservation Requests
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/admin/feature-management"
                    className={({ isActive }) => isActive ? 'active' : ''}
                    onClick={handleDropdownLinkClick}
                  >
                    Feature Management
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/admin/categories"
                    className={({ isActive }) => isActive ? 'active' : ''}
                    onClick={handleDropdownLinkClick}
                  >
                    Category Management
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/admin/calendar-config"
                    className={({ isActive }) => isActive ? 'active' : ''}
                    onClick={handleDropdownLinkClick}
                  >
                    Calendar Configuration
                  </NavLink>
                </li>
              </ul>
            )}
          </li>
        )}

      </ul>
    </nav>
  );
}