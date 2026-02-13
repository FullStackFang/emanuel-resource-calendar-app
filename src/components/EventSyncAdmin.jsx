// src/components/EventSyncAdmin.jsx
import React, { useState, useEffect } from 'react';
import eventDataService from '../services/eventDataService';
import './EventSyncAdmin.css';
import './Admin.css';
import CalendarSelector from './CalendarSelector';
import APP_CONFIG from '../config/config';
import LoadingSpinner from './shared/LoadingSpinner';

export default function EventSyncAdmin({ 
  graphToken, 
  apiToken, 
  selectedCalendarId,
  availableCalendars,
  onCalendarChange,
  changingCalendar
}) {
  const API_BASE_URL = APP_CONFIG.API_BASE_URL;
  
  const [syncStatus, setSyncStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [dateRange, setDateRange] = useState({
    start: new Date().toISOString().split('T')[0], // Today
    end: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] // 90 days from now
  });
  const [syncResult, setSyncResult] = useState(null);
  const [mounted, setMounted] = useState(false);

  const [viewEvents, setViewEvents] = useState(false);
  const [syncedEvents, setSyncedEvents] = useState([]);

  // Load sync status when component mounts
  useEffect(() => {
    if (apiToken && !mounted) {
      setMounted(true);
      eventDataService.setApiToken(apiToken);
      loadSyncStatus();
    }
  }, [apiToken, mounted]);

  const loadSyncStatus = async () => {
    if (loading) return; // Prevent multiple simultaneous loads
    
    try {
      setLoading(true);
      const status = await eventDataService.getSyncStatus();
      setSyncStatus(status);
      setError(null);
    } catch (err) {
      console.error('Error loading sync status:', err);
      // Set a default status instead of leaving it null
      setSyncStatus({
        totalEvents: 0,
        activeEvents: 0,
        deletedEvents: 0,
        lastSyncedAt: null
      });
      // Don't set error state to prevent re-render loops
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    if (!apiToken) {
      setError('Authentication required to sync events.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMessage('');
    setSyncResult(null);

    try {
      // Format dates for API
      const startDate = new Date(dateRange.start);
      const endDate = new Date(dateRange.end);
      endDate.setHours(23, 59, 59, 999);

      // Fetch events via backend (uses app-only auth)
      const userId = APP_CONFIG.DEFAULT_DISPLAY_CALENDAR;
      const params = new URLSearchParams({
        userId,
        startDateTime: startDate.toISOString(),
        endDateTime: endDate.toISOString()
      });
      if (selectedCalendarId) {
        params.append('calendarId', selectedCalendarId);
      }

      const response = await fetch(`${API_BASE_URL}/graph/events?${params}`, {
        headers: { Authorization: `Bearer ${apiToken}` }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch events from Microsoft Graph');
      }

      const data = await response.json();
      const allEvents = data.value || [];

      // Sync to internal database
      const result = await eventDataService.syncEvents(allEvents, selectedCalendarId);
      setSyncResult(result.results);
      setSuccessMessage(`Sync completed: ${result.results.created} created, ${result.results.updated} updated`);

      // Reload sync status
      await loadSyncStatus();

    } catch (err) {
      console.error('Sync error:', err);
      setError(`Failed to sync events: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadSyncedEvents = async () => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/internal-events?calendarId=${selectedCalendarId}`,
        {
          headers: {
            'Authorization': `Bearer ${apiToken}`
          }
        }
      );
      
      if (response.ok) {
        const events = await response.json();
        setSyncedEvents(events);
      }
    } catch (error) {
      console.error('Error loading synced events:', error);
    }
  };

  return (
    <div className="admin-container">
      <h2>Event Sync Management</h2>

      {/* Calendar selector */}
      <div style={{ marginBottom: '20px' }}>
        <CalendarSelector
          selectedCalendarId={selectedCalendarId}
          availableCalendars={availableCalendars}
          onCalendarChange={onCalendarChange}
          changingCalendar={changingCalendar}
        />
      </div>
      
      {error && <div className="error-message">{error}</div>}
      {successMessage && <div className="success-message">{successMessage}</div>}
      
      {/* Loading spinner for initial load */}
      {loading && !syncStatus && (
        <LoadingSpinner />
      )}
      
      {/* Sync Status */}
      {syncStatus && (
        <div className="sync-status-card">
          <h3>Sync Status</h3>
          <div className="status-grid">
            <div className="status-item">
              <span className="status-label">Total Events:</span>
              <span className="status-value">{syncStatus.totalEvents}</span>
            </div>
            <div className="status-item">
              <span className="status-label">Active Events:</span>
              <span className="status-value">{syncStatus.activeEvents}</span>
            </div>
            <div className="status-item">
              <span className="status-label">Deleted Events:</span>
              <span className="status-value">{syncStatus.deletedEvents}</span>
            </div>
            <div className="status-item">
              <span className="status-label">Last Sync:</span>
              <span className="status-value">
                {syncStatus.lastSyncedAt ? 
                  new Date(syncStatus.lastSyncedAt).toLocaleString() : 
                  'Never'
                }
              </span>
            </div>
          </div>
        </div>
      )}
      
      {/* Sync Form */}
      <div className="sync-form">
        <h3>Sync Events from Microsoft Graph</h3>
        <p className="sync-description">
          This will sync events from Microsoft Graph to the internal database, 
          preserving any custom fields like MEC categories and setup times.
        </p>
        
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="syncStartDate">Start Date:</label>
            <input
              id="syncStartDate"
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              disabled={loading}
            />
          </div>
          <div className="form-group">
            <label htmlFor="syncEndDate">End Date:</label>
            <input
              id="syncEndDate"
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              disabled={loading}
            />
          </div>
        </div>
        
        <button
          className="sync-button"
          onClick={handleSync}
          disabled={loading || !apiToken}
        >
          {loading ? (
            <>
              <span className="button-spinner"></span>
              Syncing...
            </>
          ) : (
            'Sync Events'
          )}
        </button>
      </div>
      
      {/* Sync Results */}
      {syncResult && (
        <div className="sync-results">
          <h3>Sync Results</h3>
          <div className="results-grid">
            <div className="result-item success">
              <span className="result-label">Created:</span>
              <span className="result-value">{syncResult.created}</span>
            </div>
            <div className="result-item info">
              <span className="result-label">Updated:</span>
              <span className="result-value">{syncResult.updated}</span>
            </div>
            {syncResult.skipped !== undefined && (
              <div className="result-item info">
                <span className="result-label">Skipped:</span>
                <span className="result-value">{syncResult.skipped}</span>
              </div>
            )}
            {syncResult.errors && syncResult.errors.length > 0 && (
              <div className="result-item error">
                <span className="result-label">Errors:</span>
                <span className="result-value">{syncResult.errors.length}</span>
              </div>
            )}
          </div>
          
          {syncResult.errors && syncResult.errors.length > 0 && (
            <div className="sync-errors">
              <h4>Errors:</h4>
              <ul>
                {syncResult.errors.map((err, index) => (
                  <li key={index}>
                    Event {err.eventId}: {err.error}
                  </li>
                ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Add after sync results */}
      <div style={{ marginTop: '20px' }}>
        <button 
          onClick={() => {
            setViewEvents(!viewEvents);
            if (!viewEvents) loadSyncedEvents();
          }}
          className="view-events-button"
        >
          {viewEvents ? 'Hide' : 'View'} Synced Events
        </button>
      </div>

      {viewEvents && (
        <div className="synced-events-table">
          <h3>Synced Events ({syncedEvents.length})</h3>
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Start</th>
                <th>End</th>
                <th>Status</th>
                <th>MEC Categories</th>
                <th>Setup Status</th>
                <th>Last Synced</th>
              </tr>
            </thead>
            <tbody>
              {syncedEvents.map(event => (
                <tr key={event._id} className={event.isDeleted ? 'deleted-event' : ''}>
                  <td>{event.externalData.subject}</td>
                  <td>{new Date(event.externalData.start.dateTime).toLocaleString()}</td>
                  <td>{new Date(event.externalData.end.dateTime).toLocaleString()}</td>
                  <td>{event.isDeleted ? 'Deleted' : 'Active'}</td>
                  <td>{(event.calendarData?.categories || event.categories || []).join(', ') || '-'}</td>
                  <td>{event.calendarData?.setupStatus || event.setupStatus || '-'}</td>
                  <td>{new Date(event.lastSyncedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}