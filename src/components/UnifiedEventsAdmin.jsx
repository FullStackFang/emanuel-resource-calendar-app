// src/components/UnifiedEventsAdmin.jsx
import React, { useState, useEffect, useCallback } from 'react';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';
import CSVImport from './CSVImport';
import './Admin.css';
import './UnifiedEventsAdmin.css';

export default function UnifiedEventsAdmin({ apiToken, graphToken }) {
  const API_BASE_URL = APP_CONFIG.API_BASE_URL;
  
  // Main state
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [availableCalendars, setAvailableCalendars] = useState([]);

  // Overview state
  const [overview, setOverview] = useState(null);
  
  // Events state
  const [events, setEvents] = useState([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState({
    search: '',
    status: 'all', // all, active, deleted, enriched
    calendarId: ''
  });

  // Auth headers
  const getAuthHeaders = useCallback(() => {
    if (!apiToken) {
      throw new Error('API token not set');
    }
    return {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    };
  }, [apiToken]);

  // Clear messages
  const clearMessages = () => {
    setError(null);
    setSuccessMessage('');
  };

  // Show success message
  const showSuccess = (message) => {
    clearMessages();
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(''), 5000);
  };

  // Show error message
  const showError = (message) => {
    clearMessages();
    setError(message);
    setTimeout(() => setError(''), 10000);
  };

  // Load overview data
  const loadOverview = useCallback(async () => {
    try {
      setLoading(true);
      
      // Get basic counts
      const countsResponse = await fetch(`${API_BASE_URL}/admin/unified/counts`, {
        headers: getAuthHeaders()
      });

      if (!countsResponse.ok) {
        throw new Error(`Failed to load counts: ${countsResponse.status}`);
      }

      const counts = await countsResponse.json();

      // Get delta tokens
      const deltaResponse = await fetch(`${API_BASE_URL}/admin/unified/delta-tokens`, {
        headers: getAuthHeaders()
      });

      if (!deltaResponse.ok) {
        throw new Error(`Failed to load delta tokens: ${deltaResponse.status}`);
      }

      const deltaTokens = await deltaResponse.json();

      setOverview({
        counts,
        deltaTokens: deltaTokens.tokens || []
      });

      logger.debug('Overview loaded:', { counts, deltaTokens });
    } catch (err) {
      logger.error('Error loading overview:', err);
      showError(`Failed to load overview: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [API_BASE_URL, getAuthHeaders]);

  // Load events
  const loadEvents = useCallback(async (page = 1) => {
    try {
      setLoading(true);
      
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        ...filters
      });

      const response = await fetch(`${API_BASE_URL}/admin/unified/events?${queryParams}`, {
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`Failed to load events: ${response.status}`);
      }

      const data = await response.json();
      setEvents(data.events || []);
      setTotalEvents(data.total || 0);
      setCurrentPage(page);
      
      logger.debug('Events loaded:', data);
    } catch (err) {
      logger.error('Error loading events:', err);
      showError(`Failed to load events: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [API_BASE_URL, getAuthHeaders, filters]);

  // Load available calendars for CSV import
  const loadAvailableCalendars = useCallback(async () => {
    try {
      if (!graphToken) {
        logger.warn('No graph token available for calendar loading');
        return;
      }

      const response = await fetch('https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,owner,isDefaultCalendar&$orderby=name', {
        headers: {
          Authorization: `Bearer ${graphToken}`
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Graph API error response:', errorText);
        throw new Error(`Failed to fetch calendars: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      logger.log('Calendar data received:', data.value);
      setAvailableCalendars(data.value || []);
      
    } catch (err) {
      logger.error('Error loading calendars:', err);
      // Don't show error to user, just log it
    }
  }, [graphToken]);

  // Force sync
  const forceSync = async (calendarId = null) => {
    if (!confirm('Are you sure you want to force a full sync? This will reset delta tokens.')) {
      return;
    }

    try {
      setLoading(true);
      
      const body = calendarId ? { calendarId } : {};
      
      const response = await fetch(`${API_BASE_URL}/admin/unified/force-sync`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`Force sync failed: ${response.status}`);
      }

      const result = await response.json();
      showSuccess(result.message || 'Force sync initiated');
      
      // Reload data
      if (activeTab === 'overview') {
        await loadOverview();
      } else {
        await loadEvents(currentPage);
      }
    } catch (err) {
      logger.error('Error during force sync:', err);
      showError(`Force sync failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Clean deleted events
  const cleanDeleted = async () => {
    if (!confirm('Are you sure you want to permanently remove all soft-deleted events?')) {
      return;
    }

    try {
      setLoading(true);
      
      const response = await fetch(`${API_BASE_URL}/admin/unified/clean-deleted`, {
        method: 'POST',
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`Clean deleted failed: ${response.status}`);
      }

      const result = await response.json();
      showSuccess(`Cleaned ${result.removed || 0} deleted events`);
      
      // Reload data
      if (activeTab === 'overview') {
        await loadOverview();
      } else {
        await loadEvents(currentPage);
      }
    } catch (err) {
      logger.error('Error cleaning deleted:', err);
      showError(`Clean deleted failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Handle filter changes
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  // Apply filters
  const applyFilters = () => {
    setCurrentPage(1);
    loadEvents(1);
  };

  // Load initial data when tab changes (but not when search filters change)
  useEffect(() => {
    if (!apiToken) {
      showError('API token not available');
      return;
    }

    if (activeTab === 'overview') {
      loadOverview();
    } else if (activeTab === 'events') {
      // Only load on initial tab switch, not on filter changes
      loadEvents(1);
      setCurrentPage(1);
    } else if (activeTab === 'csv-import') {
      loadAvailableCalendars();
    }
    // Removed loadEvents from dependencies to prevent double-firing
  }, [activeTab, apiToken, loadAvailableCalendars, loadOverview]);

  // Debounced search effect for filter changes
  useEffect(() => {
    if (activeTab !== 'events') return;
    
    const delayedSearch = setTimeout(() => {
      if (apiToken) {
        setCurrentPage(1);
        loadEvents(1);
      }
    }, 500); // 500ms delay

    return () => clearTimeout(delayedSearch);
    // Only trigger on filter changes, not on loadEvents function changes
  }, [filters.search, filters.status, filters.calendarId, activeTab, apiToken]);

  // Render overview tab
  const renderOverview = () => {
    if (!overview) {
      return <div className="loading">Loading overview...</div>;
    }

    const { counts, deltaTokens } = overview;

    return (
      <div className="unified-overview">
        <div className="overview-actions">
          <button 
            onClick={() => forceSync()}
            className="action-btn primary"
            disabled={loading}
          >
            🔄 Force Full Sync
          </button>
          <button 
            onClick={() => cleanDeleted()}
            className="action-btn danger"
            disabled={loading}
          >
            🗑️ Clean Deleted Events
          </button>
          <button 
            onClick={loadOverview}
            className="action-btn"
            disabled={loading}
          >
            🔄 Refresh
          </button>
        </div>

        <div className="overview-grid">
          {/* Event Counts */}
          <div className="stats-card">
            <h3>📊 Event Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-label">Total Events:</span>
                <span className="stat-value">{counts.total || 0}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Active Events:</span>
                <span className="stat-value">{counts.active || 0}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Deleted Events:</span>
                <span className="stat-value">{counts.deleted || 0}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Enriched Events:</span>
                <span className="stat-value">{counts.enriched || 0}</span>
              </div>
            </div>
          </div>

          {/* Delta Tokens */}
          <div className="stats-card">
            <h3>🔄 Delta Sync Status</h3>
            {deltaTokens.length > 0 ? (
              <div className="delta-tokens-list">
                {deltaTokens.map((token, index) => (
                  <div key={index} className="delta-token-item">
                    <div className="token-info">
                      <span className="calendar-id">{token.calendarId}</span>
                      <span className={`sync-status ${token.hasToken ? 'synced' : 'not-synced'}`}>
                        {token.hasToken ? '✅ Has Token' : '❌ No Token'}
                      </span>
                    </div>
                    <div className="token-actions">
                      {token.lastSync && (
                        <span className="last-sync">
                          Last: {new Date(token.lastSync).toLocaleString()}
                        </span>
                      )}
                      <button
                        onClick={() => forceSync(token.calendarId)}
                        className="mini-action-btn"
                        title="Force sync this calendar"
                      >
                        🔄
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="no-data">No delta tokens found</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Render events tab
  const renderEvents = () => {
    const totalPages = Math.ceil(totalEvents / 20);

    return (
      <div className="unified-events">
        {/* Filters */}
        <div className="events-filters">
          <input
            type="text"
            placeholder="🔍 Search events by subject, location, or content..."
            value={filters.search}
            onChange={(e) => handleFilterChange('search', e.target.value)}
            className="search-input"
          />
          <select
            value={filters.status}
            onChange={(e) => handleFilterChange('status', e.target.value)}
            className="filter-select"
          >
            <option value="all">All Events</option>
            <option value="active">Active Only</option>
            <option value="deleted">Deleted Only</option>
            <option value="enriched">Enriched Only</option>
          </select>
        </div>

        {/* Events Table */}
        <div className="events-table-container">
          {loading ? (
            <div className="loading">Loading events...</div>
          ) : events.length > 0 ? (
            <table className="unified-events-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>rsId</th>
                  <th>Start Time</th>
                  <th>Calendars</th>
                  <th>Status</th>
                  <th>Last Synced</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event._id}>
                    <td className="event-subject">
                      <div className="subject-cell">
                        <div className="subject-title">{event.subject || 'No Subject'}</div>
                        {event.internalData?.mecCategories?.length > 0 && (
                          <div className="mec-categories">
                            🏷️ {event.internalData.mecCategories.join(', ')}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="rsid-cell">
                      {event.internalData?.rsId !== undefined && event.internalData?.rsId !== null ? (
                        <span 
                          className="rsid-value" 
                          style={{ 
                            fontFamily: 'monospace', 
                            fontSize: '12px',
                            color: '#666',
                            backgroundColor: '#f5f5f5',
                            padding: '2px 4px',
                            borderRadius: '3px'
                          }}
                        >
                          {event.internalData.rsId}
                        </span>
                      ) : (
                        <span style={{ color: '#ccc', fontSize: '12px' }}>—</span>
                      )}
                    </td>
                    <td className="event-time">
                      {event.startTime ? new Date(event.startTime).toLocaleString() : 'N/A'}
                    </td>
                    <td className="calendars-info">
                      {(() => {
                        // Function to get meaningful calendar display name
                        const getCalendarDisplayName = (cal) => {
                          // First priority: Use calendarName if it exists and is meaningful
                          if (cal.calendarName && 
                              cal.calendarName !== 'Primary Calendar' && 
                              cal.calendarName !== 'Shared Calendar' &&
                              cal.calendarName !== 'Unknown Calendar') {
                            return cal.calendarName;
                          }
                          
                          // Second priority: If calendarId looks like an email, use it
                          if (cal.calendarId && cal.calendarId.includes('@')) {
                            return cal.calendarId;
                          }
                          
                          // Third priority: If calendar has owner email information, use it
                          if (cal.owner?.address) {
                            return cal.owner.address;
                          }
                          
                          // Fourth priority: Use calendarName even if it's generic
                          if (cal.calendarName) {
                            return cal.calendarName;
                          }
                          
                          // Last resort: Use calendarId (but truncate if it's very long)
                          if (cal.calendarId) {
                            return cal.calendarId.length > 20 ? 
                              cal.calendarId.substring(0, 20) + '...' : 
                              cal.calendarId;
                          }
                          
                          return 'Unknown Calendar';
                        };

                        // Deduplicate calendars using meaningful display name
                        const seen = new Set();
                        const uniqueCalendars = event.sourceCalendars?.filter(cal => {
                          const displayName = getCalendarDisplayName(cal);
                          if (seen.has(displayName)) {
                            return false;
                          }
                          seen.add(displayName);
                          return true;
                        }) || [];
                        
                        // Only log if we actually found and removed duplicates
                        if (event.sourceCalendars?.length > uniqueCalendars.length) {
                          logger.debug('Removed duplicate calendars for event:', {
                            eventSubject: event.subject,
                            originalCount: event.sourceCalendars.length,
                            uniqueCount: uniqueCalendars.length,
                            displayNames: uniqueCalendars.map(cal => getCalendarDisplayName(cal))
                          });
                        }
                        
                        if (uniqueCalendars.length === 0) {
                          return <span style={{ color: '#999', fontSize: '0.85rem' }}>No calendar info</span>;
                        }
                        
                        return uniqueCalendars.map((cal, idx) => {
                          const displayName = getCalendarDisplayName(cal);
                          return (
                            <span key={`${displayName}-${idx}`} className="calendar-badge">
                              {cal.role === 'shared' ? '👥' : '👤'} {displayName}
                            </span>
                          );
                        });
                      })()}
                    </td>
                    <td className="event-status">
                      {event.isDeleted ? (
                        <span className="status deleted">🗑️ Deleted</span>
                      ) : event.hasEnrichment ? (
                        <span className="status enriched">✨ Enriched</span>
                      ) : (
                        <span className="status active">✅ Active</span>
                      )}
                    </td>
                    <td className="sync-date">
                      {event.lastSyncedAt ? new Date(event.lastSyncedAt).toLocaleString() : 'Never'}
                    </td>
                    <td className="event-actions">
                      <button
                        onClick={() => {/* TODO: View details */}}
                        className="action-btn small"
                        title="View details"
                      >
                        🔍
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="no-data">No events found</div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="pagination">
            <button
              onClick={() => loadEvents(currentPage - 1)}
              disabled={currentPage <= 1 || loading}
              className="page-btn"
            >
              ← Previous
            </button>
            <span className="page-info">
              Page {currentPage} of {totalPages} ({totalEvents} total)
            </span>
            <button
              onClick={() => loadEvents(currentPage + 1)}
              disabled={currentPage >= totalPages || loading}
              className="page-btn"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    );
  };

  if (!apiToken) {
    return (
      <div className="unified-events-admin">
        <div className="error-message">
          API token is required to access unified events administration.
        </div>
      </div>
    );
  }

  return (
    <div className="unified-events-admin">
      <div className="admin-header">
        <h1>🔗 Unified Events Administration</h1>
        <p>Manage the unified events system with delta synchronization</p>
      </div>

      {/* Messages */}
      {error && (
        <div className="error-message">
          ❌ {error}
        </div>
      )}
      {successMessage && (
        <div className="success-message">
          ✅ {successMessage}
        </div>
      )}

      {/* Tabs */}
      <div className="admin-tabs">
        <button
          className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          📊 Overview
        </button>
        <button
          className={`tab ${activeTab === 'events' ? 'active' : ''}`}
          onClick={() => setActiveTab('events')}
        >
          📅 Events Browser
        </button>
        <button
          className={`tab ${activeTab === 'csv-import' ? 'active' : ''}`}
          onClick={() => setActiveTab('csv-import')}
        >
          📁 CSV Import
        </button>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {loading && <div className="loading-overlay">Loading...</div>}
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'events' && renderEvents()}
        {activeTab === 'csv-import' && <CSVImport apiToken={apiToken} availableCalendars={availableCalendars} />}
      </div>
    </div>
  );
}