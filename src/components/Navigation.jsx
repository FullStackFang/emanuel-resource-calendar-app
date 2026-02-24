// src/components/Navigation.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions';
import { usePolling } from '../hooks/usePolling';
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
  const [approvalCount, setApprovalCount] = useState(0);
  const location = useLocation();
  const dropdownRef = useRef(null);

  // Fetch pending reservations count (My Reservations badge)
  const fetchPendingCount = useCallback(async () => {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/list/counts?view=my-events`, {
        headers: { 'Authorization': `Bearer ${apiToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        setPendingCount(data.pending || 0);
      }
    } catch (err) {
      // Silently fail - badge just won't show
    }
  }, [apiToken]);

  // Fetch approval queue count (Approval Queue badge)
  const fetchApprovalCount = useCallback(async () => {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/list/counts?view=approval-queue`, {
        headers: { 'Authorization': `Bearer ${apiToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        // Items needing action: pending requests + published events with pending edit requests
        setApprovalCount((data.pending || 0) + (data.published_edit || 0));
      }
    } catch (err) {
      // Silently fail - badge just won't show
    }
  }, [apiToken]);

  // Initial fetch on mount
  useEffect(() => {
    if (apiToken && canSubmitReservation) fetchPendingCount();
  }, [apiToken, canSubmitReservation, fetchPendingCount]);

  useEffect(() => {
    if (apiToken && canApproveReservations) fetchApprovalCount();
  }, [apiToken, canApproveReservations, fetchApprovalCount]);

  // Refresh counts on navigation (user may have taken action)
  useEffect(() => {
    if (apiToken && canSubmitReservation && !location.pathname.includes('my-reservations')) {
      fetchPendingCount();
    }
    if (apiToken && canApproveReservations && !location.pathname.includes('reservation-requests')) {
      fetchApprovalCount();
    }
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll both badges every 60s
  usePolling(fetchPendingCount, 60_000, !!apiToken && canSubmitReservation);
  usePolling(fetchApprovalCount, 60_000, !!apiToken && canApproveReservations);

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
              {approvalCount > 0 && (
                <span className="nav-badge approval">{approvalCount}</span>
              )}
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