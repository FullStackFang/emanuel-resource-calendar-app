// src/components/Navigation.jsx
import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions';
import APP_CONFIG from '../config/config';
import './Navigation.css';

export default function Navigation({ apiToken }) {
  const {
    canSubmitReservation,
    canApproveReservations,
    isAdmin
  } = usePermissions();
  const [adminExpanded, setAdminExpanded] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const location = useLocation();
  const dropdownRef = useRef(null);

  // Fetch pending reservations count
  useEffect(() => {
    if (apiToken && canSubmitReservation) {
      fetchPendingCount();
    }
  }, [apiToken, canSubmitReservation]);

  // Refresh count when navigating away from my-reservations (user may have taken action)
  useEffect(() => {
    if (apiToken && canSubmitReservation && !location.pathname.includes('my-reservations')) {
      fetchPendingCount();
    }
  }, [location.pathname]);

  const fetchPendingCount = async () => {
    try {
      // Use pagination endpoint with limit=1 to efficiently get just the count
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/room-reservations?status=pending&limit=1`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        // Use totalCount from pagination metadata if available, otherwise count from array
        const pending = data.pagination?.totalCount ?? (data.reservations || []).length;
        setPendingCount(pending);
      }
    } catch (err) {
      // Silently fail - badge just won't show
    }
  };

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
              {pendingCount > 0 && (
                <span className="nav-badge pending">{pendingCount}</span>
              )}
            </NavLink>
          </li>
        )}

        {/* Approval Queue - visible for Approvers and Admins */}
        {canApproveReservations && (
          <li>
            <NavLink to="/admin/reservation-requests" className={({ isActive }) => isActive ? 'active' : ''}>
              Approval Queue
            </NavLink>
          </li>
        )}

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
                    to="/admin/locations"
                    className={({ isActive }) => isActive ? 'active' : ''}
                    onClick={handleDropdownLinkClick}
                  >
                    Location Management
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
                <li>
                  <NavLink
                    to="/admin/email-test"
                    className={({ isActive }) => isActive ? 'active' : ''}
                    onClick={handleDropdownLinkClick}
                  >
                    Email Management
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/admin/error-logs"
                    className={({ isActive }) => isActive ? 'active' : ''}
                    onClick={handleDropdownLinkClick}
                  >
                    Error Logs
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/admin/events"
                    className={({ isActive }) => isActive ? 'active' : ''}
                    onClick={handleDropdownLinkClick}
                  >
                    Event Management
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