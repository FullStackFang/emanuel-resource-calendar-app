// src/components/CalendarConfigAdmin.jsx
import React, { useState, useEffect } from 'react';
import { RotatingLines } from 'react-loader-spinner';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';
import './CalendarConfigAdmin.css';

export default function CalendarConfigAdmin({ apiToken }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [defaultCalendar, setDefaultCalendar] = useState('');
  const [availableCalendars, setAvailableCalendars] = useState([]);
  const [calendarIds, setCalendarIds] = useState({});
  const [lastModifiedBy, setLastModifiedBy] = useState('');
  const [lastModifiedAt, setLastModifiedAt] = useState(null);
  const [selectedCalendar, setSelectedCalendar] = useState('');

  useEffect(() => {
    loadCalendarSettings();
  }, []);

  const loadCalendarSettings = async () => {
    try {
      setLoading(true);
      setError('');

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/calendar-settings`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to load calendar settings: ${response.status}`);
      }

      const data = await response.json();
      setDefaultCalendar(data.defaultCalendar);
      setSelectedCalendar(data.defaultCalendar);
      setAvailableCalendars(data.availableCalendars);
      setCalendarIds(data.calendarIds);
      setLastModifiedBy(data.lastModifiedBy);
      setLastModifiedAt(data.lastModifiedAt);

    } catch (err) {
      logger.error('Error loading calendar settings:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setError('');
      setSuccess('');

      if (!selectedCalendar || !selectedCalendar.trim()) {
        setError('Please select a calendar');
        return;
      }

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/calendar-settings`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          defaultCalendar: selectedCalendar
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Failed to update calendar settings: ${response.status}`);
      }

      const data = await response.json();
      setDefaultCalendar(data.settings.defaultCalendar);
      setLastModifiedBy(data.settings.lastModifiedBy);
      setLastModifiedAt(data.settings.lastModifiedAt);
      setSuccess('Calendar settings updated successfully!');

      logger.info('Calendar settings updated:', data.settings);

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(''), 3000);

    } catch (err) {
      logger.error('Error updating calendar settings:', err);
      setError(err.message);
    }
  };

  const handleCancel = () => {
    setSelectedCalendar(defaultCalendar);
    setError('');
    setSuccess('');
  };

  if (loading) {
    return (
      <div className="calendar-config-admin">
        <div className="calendar-config-loading">
          <RotatingLines
            strokeColor="#007bff"
            strokeWidth="5"
            animationDuration="0.75"
            width="64"
            visible={true}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="calendar-config-admin">
      <div className="admin-header">
        <h2>Calendar Configuration</h2>
        <p className="admin-subtitle">
          Configure the default calendar for room reservation approvals
        </p>
      </div>

      {error && (
        <div className="error-message">
          <span className="error-icon">⚠️</span>
          {error}
        </div>
      )}

      {success && (
        <div className="success-message">
          <span className="success-icon">✓</span>
          {success}
        </div>
      )}

      <div className="settings-panel">
        <div className="setting-group">
          <h3>Default Calendar for Room Reservations</h3>
          <p className="setting-description">
            All approved room reservations will be created in this calendar by default.
            Admins can override this on a per-approval basis.
          </p>

          <div className="calendar-config-row">
            <div className="current-setting">
              <strong>Current Default:</strong>
              <span className="calendar-badge">{defaultCalendar}</span>
            </div>

            <div className="calendar-selector">
              <label htmlFor="calendar-select">Select Default Calendar:</label>
              <select
                id="calendar-select"
                value={selectedCalendar}
                onChange={(e) => setSelectedCalendar(e.target.value)}
                className="calendar-dropdown"
              >
                <option value="">-- Select a calendar --</option>
                {availableCalendars.map((calendar) => (
                  <option key={calendar} value={calendar}>
                    {calendar}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedCalendar && calendarIds[selectedCalendar] && (
            <div className="calendar-details">
              <strong>Calendar ID:</strong>
              <code className="calendar-id">{calendarIds[selectedCalendar]}</code>
            </div>
          )}
        </div>

        <div className="action-buttons">
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={selectedCalendar === defaultCalendar}
          >
            Save Changes
          </button>
          <button
            className="btn-secondary"
            onClick={handleCancel}
            disabled={selectedCalendar === defaultCalendar}
          >
            Cancel
          </button>
        </div>

        {lastModifiedBy && lastModifiedAt && (
          <div className="last-modified">
            Last updated by <strong>{lastModifiedBy}</strong> on{' '}
            {new Date(lastModifiedAt).toLocaleString()}
          </div>
        )}
      </div>

      <div className="info-panel">
        <h3>Available Calendars</h3>
        <p>These calendars are configured in <code>backend/calendar-config.json</code></p>
        <ul className="calendar-list">
          {availableCalendars.map((calendar) => (
            <li key={calendar} className={calendar === defaultCalendar ? 'is-default' : ''}>
              <span className="calendar-name">{calendar}</span>
              {calendar === defaultCalendar && (
                <span className="default-badge">Default</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
