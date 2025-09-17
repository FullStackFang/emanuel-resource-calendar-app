// src/components/UnifiedEventsAdmin.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';
import CSVImport from './CSVImport';
import CSVImportWithMapping from './CSVImportWithMapping';
import EventDetailsModal from './EventDetailsModal';
import './Admin.css';
import './UnifiedEventsAdmin.css';

export default function UnifiedEventsAdmin({ apiToken, graphToken }) {
  const API_BASE_URL = APP_CONFIG.API_BASE_URL;
  const { accounts } = useMsal();
  const currentUser = accounts && accounts.length > 0 ? accounts[0] : null;
  
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

  // Migration state
  const [migrationConfig, setMigrationConfig] = useState({
    startDate: '',
    endDate: '',
    calendarIds: [],
    options: {
      skipDuplicates: true,
      preserveEnrichments: true,
      forceOverwrite: false,
      skipLimitedAccessCalendars: true,
      skipEventsWithoutSubjects: false
    }
  });
  const [migrationPreview, setMigrationPreview] = useState(null);
  const [migrationSession, setMigrationSession] = useState(null);
  const [migrationProgress, setMigrationProgress] = useState(null);
  const [showUserGuide, setShowUserGuide] = useState(false);
  const [showLocationDetails, setShowLocationDetails] = useState(false);

  // Event details modal state
  const [eventDetailsModal, setEventDetailsModal] = useState({
    isOpen: false,
    events: [],
    title: '',
    type: null
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
      
      // Filter out system calendars we don't need
      const systemCalendarNames = [
        'Birthdays',
        'United States Holidays', 
        'Holiday Calendar',
        'Holidays in United States',
        'US Holidays',
        'United States holidays',  // lowercase variant
        'US holidays',             // lowercase variant
        'Holidays'                 // generic holidays
      ];
      
      // Debug: Log all calendar names first
      logger.log('All available calendar names before filtering:', (data.value || []).map(cal => `"${cal.name}"`));
      
      const filteredCalendars = (data.value || []).filter(calendar => {
        const name = calendar.name || '';
        const shouldFilter = systemCalendarNames.includes(name);
        if (shouldFilter) {
          logger.log(`Filtering out system calendar: "${name}"`);
        }
        return !shouldFilter;
      });
      
      logger.log(`Filtered ${data.value?.length || 0} calendars down to ${filteredCalendars.length}`);
      if (filteredCalendars.length !== (data.value?.length || 0)) {
        const removedCalendars = (data.value || []).filter(cal => systemCalendarNames.includes(cal.name || ''));
        logger.log('Removed system calendars:', removedCalendars.map(cal => `"${cal.name}"`));
      }
      
      setAvailableCalendars(filteredCalendars);
      
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
    } else if (activeTab === 'migration') {
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

  // Migration functions
  const getAuthHeadersWithGraph = useCallback(() => {
    const headers = getAuthHeaders();
    if (graphToken) {
      headers['X-Graph-Token'] = graphToken;
    }
    return headers;
  }, [getAuthHeaders, graphToken]);

  // Preview migration
  const previewMigration = async () => {
    if (!migrationConfig.startDate || !migrationConfig.endDate || migrationConfig.calendarIds.length === 0) {
      showError('Please fill in all required fields');
      return;
    }

    try {
      setLoading(true);
      
      const response = await fetch(`${API_BASE_URL}/admin/migration/preview`, {
        method: 'POST',
        headers: getAuthHeadersWithGraph(),
        body: JSON.stringify({
          startDate: migrationConfig.startDate,
          endDate: migrationConfig.endDate,
          calendarIds: migrationConfig.calendarIds,
          options: migrationConfig.options
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const preview = await response.json();
      setMigrationPreview(preview);
      showSuccess('Migration preview generated successfully');
      
      // Automatically analyze locations in background for console export and UI display
      setTimeout(() => analyzeLocationsInPreview(preview), 1000);
      
      // Scroll to the migration preview section
      setTimeout(() => {
        const previewElement = document.querySelector('.migration-preview');
        if (previewElement) {
          previewElement.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start'
          });
        }
      }, 100);

    } catch (err) {
      logger.error('Error previewing migration:', err);
      showError(`Failed to preview migration: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Analyze locations in migration preview (console export)
  const analyzeLocationsInPreview = async (previewData = null) => {
    console.log('🔄 Starting location analysis...');
    
    const currentPreview = previewData || migrationPreview;
    if (!currentPreview) {
      console.log('❌ No migration preview available');
      return;
    }

    try {
      console.log('📡 Fetching location analysis with includeEvents: true');
      const response = await fetch(`${API_BASE_URL}/admin/migration/preview`, {
        method: 'POST',
        headers: getAuthHeadersWithGraph(),
        body: JSON.stringify({
          startDate: migrationConfig.startDate,
          endDate: migrationConfig.endDate,
          calendarIds: migrationConfig.calendarIds,
          options: migrationConfig.options,
          includeEvents: true
        })
      });

      if (!response.ok) {
        console.error('❌ Failed to fetch location analysis:', response.status);
        return;
      }

      const previewWithLocations = await response.json();
      console.log('📥 Received preview response:', previewWithLocations);
      
      if (previewWithLocations.locationAnalysis) {
        console.log('✅ Location analysis found, exporting to console');
        
        // Export detailed analysis to console only
        console.log('📍 LOCATION ANALYSIS FOR MIGRATION:', previewWithLocations.locationAnalysis);
        console.table(previewWithLocations.locationAnalysis.summary);
        if (previewWithLocations.locationAnalysis.locations.new.length > 0) {
          console.log('🆕 NEW LOCATIONS:', previewWithLocations.locationAnalysis.locations.new);
        }
        if (previewWithLocations.locationAnalysis.locations.ambiguous.length > 0) {
          console.log('❓ AMBIGUOUS LOCATIONS:', previewWithLocations.locationAnalysis.locations.ambiguous);
        }
        if (previewWithLocations.locationAnalysis.locations.existing.length > 0) {
          console.log('✅ EXISTING LOCATIONS:', previewWithLocations.locationAnalysis.locations.existing);
        }
      } else {
        console.log('❌ No locationAnalysis property in response');
      }
      
    } catch (err) {
      console.error('💥 Error analyzing locations:', err);
    }
  };

  // Log detailed events for a specific category to console
  const fetchEventDetails = async (type) => {
    if (!migrationConfig.startDate || !migrationConfig.endDate || migrationConfig.calendarIds.length === 0) {
      showError('Please ensure migration configuration is complete');
      return;
    }

    try {
      setLoading(true);
      
      const response = await fetch(`${API_BASE_URL}/admin/migration/preview`, {
        method: 'POST',
        headers: getAuthHeadersWithGraph(),
        body: JSON.stringify({
          startDate: migrationConfig.startDate,
          endDate: migrationConfig.endDate,
          calendarIds: migrationConfig.calendarIds,
          options: migrationConfig.options,
          includeEvents: true
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const preview = await response.json();
      
      if (preview.eventDetailsError) {
        throw new Error(preview.eventDetailsError);
      }

      const events = type === 'imported' 
        ? preview.eventDetails?.alreadyImported || []
        : preview.eventDetails?.newEvents || [];

      // Show events in modal instead of console
      const categoryTitle = type === 'imported' ? 'Already Imported Events' : 'New Events to Import';
      
      setEventDetailsModal({
        isOpen: true,
        events: events,
        title: categoryTitle,
        type: type
      });

    } catch (err) {
      logger.error('Error fetching event details:', err);
      showError(`Failed to fetch event details: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Close event details modal
  const closeEventDetailsModal = () => {
    setEventDetailsModal({
      isOpen: false,
      events: [],
      title: '',
      type: null
    });
  };

  // Start migration
  const startMigration = async () => {
    if (!migrationPreview) {
      showError('Please generate a preview first');
      return;
    }

    if (!confirm('Are you sure you want to start the migration? This will import events from Outlook into the database.')) {
      return;
    }

    try {
      setLoading(true);
      
      const response = await fetch(`${API_BASE_URL}/admin/migration/start`, {
        method: 'POST',
        headers: getAuthHeadersWithGraph(),
        body: JSON.stringify({
          startDate: migrationConfig.startDate,
          endDate: migrationConfig.endDate,
          calendarIds: migrationConfig.calendarIds,
          options: migrationConfig.options
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      setMigrationSession(result);
      showSuccess('Migration started successfully');
      
      // Start polling for progress
      pollMigrationProgress(result.sessionId);

    } catch (err) {
      logger.error('Error starting migration:', err);
      showError(`Failed to start migration: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Poll migration progress
  const pollMigrationProgress = useCallback(async (sessionId) => {
    if (!sessionId) return;

    try {
      const response = await fetch(`${API_BASE_URL}/admin/migration/status/${sessionId}`, {
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const progress = await response.json();
      setMigrationProgress(progress);

      // Continue polling if still running
      if (progress.status === 'running') {
        setTimeout(() => pollMigrationProgress(sessionId), 2000);
      }

    } catch (err) {
      logger.error('Error polling migration progress:', err);
    }
  }, [API_BASE_URL, getAuthHeaders]);

  // Cancel migration
  const cancelMigration = async () => {
    if (!migrationSession?.sessionId) return;

    try {
      const response = await fetch(`${API_BASE_URL}/admin/migration/cancel/${migrationSession.sessionId}`, {
        method: 'POST',
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      showSuccess(`Migration cancelled. Processed ${result.processed} events.`);
      setMigrationSession(null);
      setMigrationProgress(null);

    } catch (err) {
      logger.error('Error cancelling migration:', err);
      showError(`Failed to cancel migration: ${err.message}`);
    }
  };

  // Render migration tab
  const renderMigration = () => {
    return (
      <div className="migration-container">
        <div className="migration-header">
          <h2>📦 Data Migration</h2>
          <p>Import historical events from Outlook into the local database for improved performance</p>
          
          <div className="user-guide-toggle">
            <button
              onClick={() => setShowUserGuide(!showUserGuide)}
              className="guide-toggle-btn"
            >
              📖 {showUserGuide ? 'Hide User Guide' : 'Show User Guide'}
            </button>
          </div>
        </div>

        {/* User Guide */}
        {showUserGuide && (
          <div className="user-guide">
            <div className="guide-overview">
              <h3>🎯 What This Tool Does</h3>
              <p>This tool imports historical events from your Outlook calendars into the local database for faster access and the ability to add internal enrichments (notes, categories, etc.).</p>
              <div className="important-note">
                <strong>⚠️ Important:</strong> This is a <strong>ONE-TIME import tool</strong>, not a sync tool. Your regular calendar sync will continue to handle ongoing changes.
              </div>
            </div>

            <div className="guide-steps">
              <h3>📋 Step-by-Step Guide</h3>
              
              <div className="guide-step">
                <div className="step-number">1️⃣</div>
                <div className="step-content">
                  <h4>Set Date Range</h4>
                  <ul>
                    <li>Choose start and end dates for the events you want to import</li>
                    <li><strong>Recommendation:</strong> Start with a smaller range (1-4 weeks) for your first migration</li>
                    <li><strong>Example:</strong> Import last month's events first, then expand to historical data</li>
                  </ul>
                </div>
              </div>

              <div className="guide-step">
                <div className="step-number">2️⃣</div>
                <div className="step-content">
                  <h4>Select Calendars</h4>
                  <ul>
                    <li>Choose which calendars to import from:</li>
                    <li>✓ <strong>Primary Calendar</strong> - Your personal calendar</li>
                    <li>✓ <strong>Shared Mailboxes</strong> - Team calendars you have access to</li>
                    <li>✓ <strong>Room Calendars</strong> - Meeting room bookings</li>
                    <li><strong>Tip:</strong> Start with just your primary calendar for the first test</li>
                  </ul>
                </div>
              </div>

              <div className="guide-step">
                <div className="step-number">3️⃣</div>
                <div className="step-content">
                  <h4>Configure Options</h4>
                  <ul>
                    <li>✓ <strong>Skip Duplicates</strong> (Recommended) - Avoids importing events already in database</li>
                    <li>✓ <strong>Preserve Enrichments</strong> - Keeps any internal notes you've already added</li>
                    <li>⚠️ <strong>Force Overwrite</strong> - Only use if you want to replace existing data</li>
                  </ul>
                </div>
              </div>

              <div className="guide-step">
                <div className="step-number">4️⃣</div>
                <div className="step-content">
                  <h4>Preview Before Importing</h4>
                  <ul>
                    <li>Always click <strong>"Preview"</strong> first to see what will be imported</li>
                    <li>Review the statistics: events found, already imported, new to import</li>
                    <li>Check for any calendar errors before proceeding</li>
                  </ul>
                </div>
              </div>

              <div className="guide-step">
                <div className="step-number">5️⃣</div>
                <div className="step-content">
                  <h4>Start Migration</h4>
                  <ul>
                    <li>Monitor progress in real-time</li>
                    <li>You can cancel safely at any time</li>
                    <li>Migration runs in the background - you can use other parts of the app</li>
                  </ul>
                </div>
              </div>

              <div className="guide-step">
                <div className="step-number">6️⃣</div>
                <div className="step-content">
                  <h4>Review Results</h4>
                  <ul>
                    <li>Check final statistics for created/updated/skipped events</li>
                    <li>Review any errors and their details</li>
                    <li>Errors don't stop the migration - other events continue processing</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="guide-section">
              <h3>💡 Best Practices</h3>
              <div className="best-practices">
                <div className="practice-item">
                  <h4>🎯 Start Small</h4>
                  <p>Test with 1-2 weeks first before importing large date ranges. Verify everything works as expected with your data.</p>
                </div>
                
                <div className="practice-item">
                  <h4>📅 Date Range Strategy</h4>
                  <p>Import recent events first (last 1-3 months), then expand to historical data as needed. Very old events may have different data structures.</p>
                </div>
                
                <div className="practice-item">
                  <h4>🗂️ Calendar Selection</h4>
                  <p>Import your primary calendar first. Add shared calendars one at a time to identify any issues. Room calendars often have many events - expect longer processing times.</p>
                </div>
                
                <div className="practice-item">
                  <h4>⏱️ Timing Considerations</h4>
                  <p>Large imports (&gt;1000 events) can take 10-30 minutes. Run during off-hours if importing large amounts of data. Migration continues running even if you close the browser.</p>
                </div>
              </div>
            </div>

            <div className="guide-section">
              <h3>❓ Frequently Asked Questions</h3>
              <div className="faq-section">
                <div className="faq-item">
                  <h4>Will this create duplicate events?</h4>
                  <p>No, if "Skip Duplicates" is enabled (recommended), existing events are skipped.</p>
                </div>
                
                <div className="faq-item">
                  <h4>What happens to my internal notes and categories?</h4>
                  <p>They're preserved if "Preserve Enrichments" is enabled (recommended).</p>
                </div>
                
                <div className="faq-item">
                  <h4>Can I stop the migration if something goes wrong?</h4>
                  <p>Yes, click "Cancel Migration" to safely stop at any time.</p>
                </div>
                
                <div className="faq-item">
                  <h4>How long does migration take?</h4>
                  <p>Depends on the number of events:</p>
                  <ul>
                    <li>100 events: ~2-3 minutes</li>
                    <li>1,000 events: ~10-15 minutes</li>
                    <li>5,000+ events: ~30-60 minutes</li>
                  </ul>
                </div>
                
                <div className="faq-item">
                  <h4>What if some events fail to import?</h4>
                  <p>The migration continues with other events. Failed events are listed in the error report.</p>
                </div>
                
                <div className="faq-item">
                  <h4>Do I need to run this regularly?</h4>
                  <p>No, this is a one-time import. Your regular calendar sync handles ongoing changes.</p>
                </div>
                
                <div className="faq-item">
                  <h4>Can I import the same date range multiple times?</h4>
                  <p>Yes, but with "Skip Duplicates" enabled, it will only import new/changed events.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Migration Configuration */}
        <div className="migration-config">
          <h3>Migration Configuration</h3>
          
          <div className="config-row">
            <div className="form-group">
              <label htmlFor="startDate">Start Date <span className="required">*</span></label>
              <input
                type="date"
                id="startDate"
                value={migrationConfig.startDate}
                onChange={(e) => setMigrationConfig(prev => ({ ...prev, startDate: e.target.value }))}
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="endDate">End Date <span className="required">*</span></label>
              <input
                type="date"
                id="endDate"
                value={migrationConfig.endDate}
                onChange={(e) => setMigrationConfig(prev => ({ ...prev, endDate: e.target.value }))}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Select Calendars to Import</label>
            
            <div className="calendar-selection">
              {availableCalendars.length === 0 ? (
                <div className="no-calendars-message">
                  <p>Loading available calendars...</p>
                  <p className="calendar-hint">If calendars don't appear, ensure you're signed in and have the necessary permissions.</p>
                </div>
              ) : (
                availableCalendars.map(calendar => {
                  const isSelected = migrationConfig.calendarIds.includes(calendar.id);
                  return (
                    <div 
                      key={calendar.id} 
                      className={`calendar-checkbox ${isSelected ? 'selected' : ''}`}
                      onClick={() => {
                        setMigrationConfig(prev => ({
                          ...prev,
                          calendarIds: isSelected
                            ? prev.calendarIds.filter(id => id !== calendar.id)
                            : [...prev.calendarIds, calendar.id]
                        }));
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        readOnly
                      />
                      <div className="calendar-info">
                        <span className="calendar-name">{calendar.name || 'Unnamed Calendar'}</span>
                        {calendar.isDefaultCalendar ? (
                          <span className="calendar-badge primary">Primary</span>
                        ) : calendar.owner?.address && calendar.owner.address !== currentUser?.username ? (
                          <span className="calendar-badge shared">Shared</span>
                        ) : null}
                        {calendar.owner?.address && calendar.owner.address !== currentUser?.username && (
                          <span className="calendar-owner">👤 {calendar.owner.name || calendar.owner.address}</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {availableCalendars.length > 0 && migrationConfig.calendarIds.length === 0 && (
              <div className="validation-hint">⚠️ Select at least one calendar to import from</div>
            )}
          </div>

          <div className="form-group">
            <label>
              Migration Options 
              <span className="tooltip" title="Configure how the migration handles existing events and data">ℹ️</span>
            </label>
            <div className="options-group">
              <div 
                className={`option-checkbox ${migrationConfig.options.skipDuplicates ? 'selected' : ''}`}
                onClick={() => setMigrationConfig(prev => ({
                  ...prev,
                  options: { ...prev.options, skipDuplicates: !prev.options.skipDuplicates }
                }))}
              >
                <input
                  type="checkbox"
                  checked={migrationConfig.options.skipDuplicates}
                  readOnly
                />
                <div className="option-text">Skip duplicate events (recommended)</div>
                <div className="option-help">Prevents importing events that already exist in the database</div>
              </div>
              
              <div 
                className={`option-checkbox ${migrationConfig.options.preserveEnrichments ? 'selected' : ''}`}
                onClick={() => setMigrationConfig(prev => ({
                  ...prev,
                  options: { ...prev.options, preserveEnrichments: !prev.options.preserveEnrichments }
                }))}
              >
                <input
                  type="checkbox"
                  checked={migrationConfig.options.preserveEnrichments}
                  readOnly
                />
                <div className="option-text">Preserve existing enrichments</div>
                <div className="option-help">Keeps internal notes, categories, and custom data you've already added</div>
              </div>
              
              <div 
                className={`option-checkbox ${migrationConfig.options.forceOverwrite ? 'selected' : ''}`}
                onClick={() => setMigrationConfig(prev => ({
                  ...prev,
                  options: { ...prev.options, forceOverwrite: !prev.options.forceOverwrite }
                }))}
              >
                <input
                  type="checkbox"
                  checked={migrationConfig.options.forceOverwrite}
                  readOnly
                />
                <div className="option-text">Force overwrite existing events</div>
                <div className="option-help warning">⚠️ This will replace existing event data - use with caution</div>
              </div>
              
              <div 
                className={`option-checkbox ${migrationConfig.options.skipLimitedAccessCalendars ? 'selected' : ''}`}
                onClick={() => setMigrationConfig(prev => ({
                  ...prev,
                  options: { ...prev.options, skipLimitedAccessCalendars: !prev.options.skipLimitedAccessCalendars }
                }))}
              >
                <input
                  type="checkbox"
                  checked={migrationConfig.options.skipLimitedAccessCalendars}
                  readOnly
                />
                <div className="option-text">Skip calendars with limited access (recommended)</div>
                <div className="option-help">Excludes calendars where you may not see full event details (subjects, organizers, etc.)</div>
              </div>
              
              <div 
                className={`option-checkbox ${migrationConfig.options.skipEventsWithoutSubjects ? 'selected' : ''}`}
                onClick={() => setMigrationConfig(prev => ({
                  ...prev,
                  options: { ...prev.options, skipEventsWithoutSubjects: !prev.options.skipEventsWithoutSubjects }
                }))}
              >
                <input
                  type="checkbox"
                  checked={migrationConfig.options.skipEventsWithoutSubjects}
                  readOnly
                />
                <div className="option-text">Skip events without subjects</div>
                <div className="option-help">Excludes events that have no title/subject (often blocked time or placeholder events)</div>
              </div>
            </div>
          </div>

          <div className="migration-actions">
            <button
              onClick={previewMigration}
              className="action-btn primary"
              disabled={loading || migrationSession?.status === 'running'}
            >
              🔍 Preview Migration
            </button>

            {migrationPreview && (
              <button
                onClick={startMigration}
                className="action-btn success"
                disabled={loading || migrationSession?.status === 'running'}
              >
                ▶️ Start Migration
              </button>
            )}

            {migrationSession?.status === 'running' && (
              <button
                onClick={cancelMigration}
                className="action-btn danger"
                disabled={loading}
              >
                ❌ Cancel Migration
              </button>
            )}
          </div>
        </div>

        {/* Migration Preview */}
        {migrationPreview && (
          <div className="migration-preview">
            <h3>Migration Preview</h3>
            <div className="preview-stats">
              <div className="stat-card">
                <div className="stat-number">{migrationPreview.statistics.totalInOutlook}</div>
                <div className="stat-label">Events in Outlook</div>
              </div>
              <div 
                className="stat-card clickable"
                onClick={() => fetchEventDetails('imported')}
                title="Click to view event list"
              >
                <div className="stat-number">{migrationPreview.statistics.alreadyImported}</div>
                <div className="stat-label">Already Imported</div>
              </div>
              <div 
                className="stat-card clickable"
                onClick={() => fetchEventDetails('new')}
                title="Click to view event list"
              >
                <div className="stat-number">{migrationPreview.statistics.estimatedNewEvents}</div>
                <div className="stat-label">New Events to Import</div>
              </div>
            </div>

            <div className="calendar-breakdown">
              <div className="breakdown-container">
                <div className="calendar-section">
                  <h4>Calendar Breakdown</h4>
                  {migrationPreview.calendars.map(calendar => {
                const getAccessLevelDisplay = (permissions) => {
                  if (!permissions) return { text: 'Unknown', icon: '❓', className: 'access-unknown' };
                  
                  switch (permissions.accessLevel) {
                    case 'owner':
                    case 'full':
                      return { text: 'Full Access', icon: '✅', className: 'access-full' };
                    case 'limited':
                      return { text: 'Limited Access', icon: '⚠️', className: 'access-limited' };
                    case 'freeBusy':
                      return { text: 'Free/Busy Only', icon: '🔒', className: 'access-restricted' };
                    default:
                      return { text: 'Unknown', icon: '❓', className: 'access-unknown' };
                  }
                };
                
                const access = getAccessLevelDisplay(calendar.permissions);
                
                return (
                  <div key={calendar.id} className={`calendar-item ${access.className}`}>
                    <div className="calendar-header-breakdown">
                      <div className="calendar-title-section">
                        <span className="calendar-name">{calendar.name}</span>
                        <div className="calendar-type-badges">
                          {calendar.id === 'primary' || (calendar.owner && calendar.owner.address === currentUser?.username) ? (
                            <span className="calendar-type-badge primary">Primary</span>
                          ) : (
                            <span className="calendar-type-badge shared">Shared</span>
                          )}
                        </div>
                      </div>
                      <span className="calendar-count">{calendar.eventCount} events</span>
                    </div>
                    
                    <div className="calendar-details">
                      <div className="calendar-permissions">
                        <span className={`access-level ${access.className}`}>
                          {access.icon} {access.text}
                        </span>
                        
                        {calendar.owner && calendar.owner.address && (
                          <span className="calendar-owner">👤 {calendar.owner.address}</span>
                        )}
                      </div>
                    </div>
                    
                    {calendar.hasLimitedAccess && (
                      <div className="calendar-warning">
                        ⚠️ This calendar may have incomplete event data (missing subjects, organizers, etc.)
                      </div>
                    )}
                    
                    {calendar.error && (
                      <div className="calendar-error">❌ Error: {calendar.error}</div>
                    )}
                  </div>
                );
              })}
                </div>

              </div>
            </div>
          </div>
        )}

        {/* Migration Progress */}
        {migrationProgress && (
          <div className="migration-progress">
            <h3>Migration Progress</h3>
            <div className="progress-header">
              <span>Status: {migrationProgress.status}</span>
              <span>Progress: {migrationProgress.progress.processed} processed</span>
            </div>
            
            <div className="progress-stats">
              <div className="stat">Created: {migrationProgress.progress.created}</div>
              <div className="stat">Updated: {migrationProgress.progress.updated}</div>
              <div className="stat">Skipped: {migrationProgress.progress.skipped}</div>
              <div className="stat">Errors: {migrationProgress.progress.errors.length}</div>
            </div>

            {migrationProgress.currentCalendar && (
              <div className="current-activity">
                <div>Calendar: {migrationProgress.currentCalendar}</div>
                <div>Event: {migrationProgress.currentEvent}</div>
              </div>
            )}

            {migrationProgress.progress.errors.length > 0 && (
              <div className="migration-errors">
                <h4>Errors</h4>
                {migrationProgress.progress.errors.slice(0, 10).map((error, index) => (
                  <div key={index} className="error-item">
                    <strong>{error.subject}</strong>: {error.error}
                  </div>
                ))}
                {migrationProgress.progress.errors.length > 10 && (
                  <div className="error-item">... and {migrationProgress.progress.errors.length - 10} more errors</div>
                )}
              </div>
            )}

            {migrationProgress.status === 'completed' && (
              <div className="migration-complete">
                <h4>✅ Migration Complete!</h4>
                <p>Successfully processed {migrationProgress.progress.processed} events</p>
                <button
                  onClick={() => {
                    setMigrationSession(null);
                    setMigrationProgress(null);
                    setMigrationPreview(null);
                  }}
                  className="action-btn primary"
                >
                  Start New Migration
                </button>
              </div>
            )}
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
        <button
          className={`tab ${activeTab === 'advanced-import' ? 'active' : ''}`}
          onClick={() => setActiveTab('advanced-import')}
        >
          🔧 Advanced Import
        </button>
        <button
          className={`tab ${activeTab === 'migration' ? 'active' : ''}`}
          onClick={() => setActiveTab('migration')}
        >
          🚚 Migration
        </button>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {loading && <div className="loading-overlay">Loading...</div>}
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'events' && renderEvents()}
        {activeTab === 'csv-import' && <CSVImport apiToken={apiToken} availableCalendars={availableCalendars} />}
        {activeTab === 'advanced-import' && <CSVImportWithMapping apiToken={apiToken} />}
        {activeTab === 'migration' && renderMigration()}
      </div>

      {/* Event Details Modal */}
      <EventDetailsModal
        isOpen={eventDetailsModal.isOpen}
        onClose={closeEventDetailsModal}
        events={eventDetailsModal.events}
        title={eventDetailsModal.title}
        migrationConfig={migrationConfig}
      />
    </div>
  );
}