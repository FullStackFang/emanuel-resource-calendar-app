// src/components/SharedCalendarSearch.jsx
// Updated to use backend proxy for Graph API calls (app-only authentication)
import React, { useState } from 'react';
import APP_CONFIG from '../config/config';
import './SharedCalendarSearch.css';

const API_BASE_URL = APP_CONFIG.API_BASE_URL;

function SharedCalendarSearch({ apiToken, onCalendarAdded }) {
  const [searchEmail, setSearchEmail] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [foundCalendars, setFoundCalendars] = useState([]);
  const [showSearch, setShowSearch] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchEmail.trim()) return;

    setSearching(true);
    setError(null);
    setFoundCalendars([]);

    try {
      // Search for calendars via backend (uses app-only auth)
      const params = new URLSearchParams({ email: searchEmail.trim() });
      const response = await fetch(
        `${API_BASE_URL}/graph/calendars/search?${params}`,
        {
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 404) {
          throw new Error('No calendars found for this email address');
        }
        throw new Error(errorData.error || 'Failed to search for calendars');
      }

      const data = await response.json();

      // Filter to only show calendars that can be shared
      const shareableCalendars = (data.value || []).filter(cal =>
        cal.canShare || cal.owner?.address === searchEmail
      );

      if (shareableCalendars.length === 0) {
        setError('No shareable calendars found for this user');
      } else {
        setFoundCalendars(shareableCalendars);
      }
    } catch (err) {
      console.error('Error searching for calendars:', err);
      setError(err.message || 'Failed to search for calendars');
    } finally {
      setSearching(false);
    }
  };

  const handleAddCalendar = async (calendar) => {
    try {
      // The calendar should already be accessible if it appeared in the search
      // Just notify parent to refresh the calendar list
      if (onCalendarAdded) {
        onCalendarAdded();
      }
      setShowSearch(false);
      setSearchEmail('');
      setFoundCalendars([]);
    } catch (err) {
      console.error('Error adding calendar:', err);
      setError('Failed to add calendar');
    }
  };

  return (
    <div className="shared-calendar-search">
      {!showSearch ? (
        <button
          className="add-shared-calendar-btn"
          onClick={() => setShowSearch(true)}
          title="Add a shared calendar"
        >
          + Add Shared Calendar
        </button>
      ) : (
        <div className="search-container">
          <form onSubmit={handleSearch}>
            <input
              type="email"
              placeholder="Enter email address of calendar owner"
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
              className="search-input"
              disabled={searching}
            />
            <button
              type="submit"
              disabled={searching || !searchEmail.trim()}
              className="search-btn"
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowSearch(false);
                setSearchEmail('');
                setFoundCalendars([]);
                setError(null);
              }}
              className="cancel-btn"
            >
              Cancel
            </button>
          </form>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          {foundCalendars.length > 0 && (
            <div className="found-calendars">
              <h4>Available Calendars:</h4>
              {foundCalendars.map(calendar => (
                <div key={calendar.id} className="calendar-item">
                  <div className="calendar-info">
                    <strong>{calendar.name}</strong>
                    <span className="calendar-owner">
                      {calendar.owner?.name || calendar.owner?.address || 'Unknown owner'}
                    </span>
                  </div>
                  <button
                    onClick={() => handleAddCalendar(calendar)}
                    className="add-btn"
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SharedCalendarSearch;
