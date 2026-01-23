// src/components/EventLocationAssignment.jsx
import React, { useState, useEffect } from 'react';
import { logger } from '../utils/logger';
import { useNotification } from '../context/NotificationContext';
import APP_CONFIG from '../config/config';
import LoadingSpinner from './shared/LoadingSpinner';
import './EventLocationAssignment.css';

const EventLocationAssignment = ({ apiToken }) => {
  const { showError, showSuccess, showWarning } = useNotification();
  const [unassignedStrings, setUnassignedStrings] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [assigningString, setAssigningString] = useState(null);
  const [selectedLocations, setSelectedLocations] = useState({}); // Map of normalizedString -> locationId
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMinEvents, setFilterMinEvents] = useState(1);

  // Fetch unassigned location strings
  const fetchUnassignedStrings = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/locations/unassigned-strings`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch unassigned strings: ${response.statusText}`);
      }

      const data = await response.json();
      setUnassignedStrings(data);
      logger.log(`Loaded ${data.length} unassigned location strings`);
    } catch (err) {
      logger.error('Error fetching unassigned strings:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Fetch all locations
  const fetchLocations = async () => {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/locations`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch locations: ${response.statusText}`);
      }

      const data = await response.json();
      setLocations(data);
      logger.log(`Loaded ${data.length} locations`);
    } catch (err) {
      logger.error('Error fetching locations:', err);
      setError(err.message);
    }
  };

  // Initial load
  useEffect(() => {
    if (apiToken) {
      fetchUnassignedStrings();
      fetchLocations();
    }
  }, [apiToken]);

  // Assign location string to a location
  const handleAssign = async (locationString, locationId) => {
    try {
      setAssigningString(locationString);

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/locations/assign-string`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          locationString,
          locationId
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to assign location: ${response.statusText}`);
      }

      const result = await response.json();
      logger.log(`Assigned "${locationString}" to ${result.locationName}, updated ${result.eventsUpdated} events`);

      // Show success message
      showSuccess(`Assigned "${locationString}" to ${result.locationName}. ${result.eventsUpdated} events updated`);

      // Refresh the list
      await fetchUnassignedStrings();

      // Clear the selected location for this string
      setSelectedLocations(prev => {
        const newState = { ...prev };
        delete newState[locationString];
        return newState;
      });
    } catch (err) {
      logger.error('Error assigning location:', err);
      showError(err, { context: 'EventLocationAssignment.assignLocationString' });
    } finally {
      setAssigningString(null);
    }
  };

  // Filter unassigned strings
  const filteredStrings = unassignedStrings.filter(item => {
    const matchesSearch = searchTerm === '' ||
      item.locationString.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.normalizedString.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesMinEvents = item.eventCount >= filterMinEvents;

    return matchesSearch && matchesMinEvents;
  });

  // Filter locations for dropdown
  const filteredLocations = locations.filter(loc =>
    searchTerm === '' || loc.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading && unassignedStrings.length === 0) {
    return (
      <div className="event-location-assignment">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="event-location-assignment">
        <div className="error-container">
          <h3>❌ Error</h3>
          <p>{error}</p>
          <button onClick={() => {
            setError(null);
            fetchUnassignedStrings();
            fetchLocations();
          }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="event-location-assignment">
      <div className="assignment-header">
        <h2>📍 Location Assignment</h2>
        <p className="description">
          Assign location strings from events to physical or virtual locations.
          Each assignment creates an alias for automatic matching of future events.
        </p>
      </div>

      <div className="assignment-stats">
        <div className="stat-card">
          <div className="stat-value">{unassignedStrings.length}</div>
          <div className="stat-label">Unassigned Strings</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{locations.length}</div>
          <div className="stat-label">Total Locations</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {unassignedStrings.reduce((sum, item) => sum + item.eventCount, 0)}
          </div>
          <div className="stat-label">Events to Process</div>
        </div>
      </div>

      <div className="assignment-filters">
        <div className="filter-group">
          <label>Search Location Strings:</label>
          <input
            type="text"
            placeholder="Search by location name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="filter-group">
          <label>Minimum Events:</label>
          <input
            type="number"
            min="1"
            value={filterMinEvents}
            onChange={(e) => setFilterMinEvents(Number(e.target.value))}
            className="number-input"
          />
        </div>
        <button
          onClick={() => {
            setSearchTerm('');
            setFilterMinEvents(1);
          }}
          className="clear-filters-btn"
        >
          Clear Filters
        </button>
      </div>

      {filteredStrings.length === 0 ? (
        <div className="no-results">
          <p>✨ All location strings have been assigned!</p>
          <p className="sub-text">New events will automatically match based on existing aliases.</p>
        </div>
      ) : (
        <div className="assignment-list">
          <div className="list-header">
            <span className="col-location">Location String</span>
            <span className="col-events">Events</span>
            <span className="col-action">Assign To</span>
          </div>

          {filteredStrings.map((item) => (
            <div key={item.normalizedString} className="assignment-row">
              <div className="location-info">
                <div className="location-string">
                  {item.locationString}
                </div>
                <div className="normalized-string">
                  normalized: {item.normalizedString}
                </div>
              </div>

              <div className="event-count">
                <span className="count-badge">{item.eventCount}</span>
                <span className="count-label">events</span>
              </div>

              <div className="assignment-action">
                <select
                  value={selectedLocations[item.normalizedString] || ''}
                  onChange={(e) => {
                    setSelectedLocations(prev => ({
                      ...prev,
                      [item.normalizedString]: e.target.value
                    }));
                  }}
                  disabled={assigningString === item.locationString}
                  className="location-select"
                >
                  <option value="">Select location...</option>
                  <optgroup label="Physical Locations">
                    {filteredLocations
                      .filter(loc => loc.name !== 'Non-Physical Location')
                      .map(loc => (
                        <option key={loc._id} value={loc._id}>
                          {loc.displayName || loc.name}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Virtual/Non-Physical">
                    {filteredLocations
                      .filter(loc => loc.name === 'Non-Physical Location')
                      .map(loc => (
                        <option key={loc._id} value={loc._id}>
                          {loc.displayName || loc.name}
                        </option>
                      ))}
                  </optgroup>
                </select>

                <button
                  onClick={() => {
                    const locationId = selectedLocations[item.normalizedString];

                    if (!locationId) {
                      showWarning('Please select a location first');
                      return;
                    }

                    if (confirm(`Assign "${item.locationString}" to the selected location?\n\nThis will update ${item.eventCount} events.`)) {
                      handleAssign(item.locationString, locationId);
                    }
                  }}
                  disabled={assigningString === item.locationString || !selectedLocations[item.normalizedString]}
                  className="assign-btn"
                >
                  {assigningString === item.locationString ? (
                    <span>Assigning...</span>
                  ) : (
                    <span>Assign</span>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="assignment-footer">
        <button onClick={fetchUnassignedStrings} disabled={loading} className="refresh-btn">
          {loading ? 'Refreshing...' : '🔄 Refresh List'}
        </button>
      </div>
    </div>
  );
};

export default EventLocationAssignment;
