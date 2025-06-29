// src/components/CacheAdmin.jsx
import React, { useState, useEffect, useCallback } from 'react';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';
import './Admin.css';
import './CacheAdmin.css';

export default function CacheAdmin({ apiToken }) {
  const API_BASE_URL = APP_CONFIG.API_BASE_URL;
  
  // Main state
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  // Dashboard state
  const [cacheOverview, setCacheOverview] = useState(null);
  
  // Browser state
  const [cachedEvents, setCachedEvents] = useState([]);
  const [pagination, setPagination] = useState({});
  const [filters, setFilters] = useState({
    page: 1,
    limit: 20,
    status: '',
    search: '',
    calendarId: '',
    sortBy: 'cachedAt',
    sortOrder: 'desc'
  });
  
  // Performance state
  const [performanceResults, setPerformanceResults] = useState(null);
  const [testRunning, setTestRunning] = useState(false);

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

  // Load cache overview
  const loadCacheOverview = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/admin/cache/overview`, {
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`Failed to load cache overview: ${response.status}`);
      }

      const data = await response.json();
      setCacheOverview(data);
      logger.debug('Cache overview loaded:', data);
    } catch (err) {
      logger.error('Error loading cache overview:', err);
      showError(`Failed to load cache overview: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [API_BASE_URL, getAuthHeaders]);

  // Load cached events
  const loadCachedEvents = useCallback(async (newFilters = null) => {
    const filtersToUse = newFilters || filters;
    try {
      setLoading(true);
      const queryParams = new URLSearchParams();
      
      Object.entries(filtersToUse).forEach(([key, value]) => {
        if (value !== '' && value !== null && value !== undefined) {
          queryParams.append(key, value);
        }
      });

      const response = await fetch(`${API_BASE_URL}/admin/cache/events?${queryParams}`, {
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`Failed to load cached events: ${response.status}`);
      }

      const data = await response.json();
      setCachedEvents(data.events);
      setPagination(data.pagination);
      setFilters(newFilters);
      logger.debug('Cached events loaded:', data);
    } catch (err) {
      logger.error('Error loading cached events:', err);
      showError(`Failed to load cached events: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [API_BASE_URL, getAuthHeaders]);

  // Run performance test
  const runPerformanceTest = async (testType = 'basic') => {
    try {
      setTestRunning(true);
      const response = await fetch(`${API_BASE_URL}/admin/cache/test-performance`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ testType })
      });

      if (!response.ok) {
        throw new Error(`Performance test failed: ${response.status}`);
      }

      const results = await response.json();
      setPerformanceResults(results);
      showSuccess(`Performance test completed: ${testType}`);
      logger.debug('Performance test results:', results);
    } catch (err) {
      logger.error('Error running performance test:', err);
      showError(`Performance test failed: ${err.message}`);
    } finally {
      setTestRunning(false);
    }
  };

  // Cache cleanup
  const performCleanup = async (operation) => {
    if (!confirm(`Are you sure you want to clean up ${operation} cache entries?`)) {
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/admin/cache/cleanup`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ operation })
      });

      if (!response.ok) {
        throw new Error(`Cleanup failed: ${response.status}`);
      }

      const result = await response.json();
      showSuccess(result.message);
      
      // Refresh data
      if (activeTab === 'dashboard') {
        await loadCacheOverview();
      } else if (activeTab === 'browser') {
        await loadCachedEvents();
      }
    } catch (err) {
      logger.error('Error during cleanup:', err);
      showError(`Cleanup failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Clean duplicate cache entries
  const cleanDuplicates = async () => {
    if (!confirm('This will remove duplicate cache entries, keeping the most appropriate version of each event. Continue?')) {
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/admin/cache/clean-duplicates`, {
        method: 'POST',
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`Duplicate cleanup failed: ${response.status}`);
      }

      const result = await response.json();
      showSuccess(`Cleaned ${result.duplicatesRemoved} duplicate entries out of ${result.totalEventsChecked} events`);
      
      // Refresh data
      if (activeTab === 'dashboard') {
        await loadCacheOverview();
      } else if (activeTab === 'browser') {
        await loadCachedEvents();
      }
    } catch (err) {
      logger.error('Error cleaning duplicates:', err);
      showError(`Duplicate cleanup failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Invalidate cache for selected events
  const invalidateSelectedEvents = async (eventIds) => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/admin/cache/refresh`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ eventIds })
      });

      if (!response.ok) {
        throw new Error(`Cache invalidation failed: ${response.status}`);
      }

      const result = await response.json();
      showSuccess(result.message);
      await loadCachedEvents();
    } catch (err) {
      logger.error('Error invalidating cache:', err);
      showError(`Cache invalidation failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Handle filter changes
  const handleFilterChange = (key, value) => {
    // For search, just update state without triggering a load
    if (key === 'search') {
      setFilters(prev => ({ ...prev, [key]: value }));
    } else {
      // For other filters, trigger immediate load
      const newFilters = { ...filters, [key]: value, page: 1 };
      setFilters(newFilters);
      loadCachedEvents(newFilters);
    }
  };

  // Handle search on Enter key
  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const newFilters = { ...filters, page: 1 };
      loadCachedEvents(newFilters);
    }
  };

  // Handle search button click
  const handleSearchClick = () => {
    const newFilters = { ...filters, page: 1 };
    loadCachedEvents(newFilters);
  };

  // Handle pagination
  const handlePageChange = (newPage) => {
    const newFilters = { ...filters, page: newPage };
    loadCachedEvents(newFilters);
  };

  // Load initial data
  useEffect(() => {
    if (!apiToken) {
      showError('API token not available');
      return;
    }

    loadCacheOverview();
  }, [apiToken, loadCacheOverview]);

  // Load data when tab changes
  useEffect(() => {
    if (!apiToken) return;

    if (activeTab === 'dashboard') {
      loadCacheOverview();
    } else if (activeTab === 'browser') {
      // Load with current filters when switching to browser tab
      loadCachedEvents(filters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, apiToken]); // Intentionally omit loadCachedEvents and filters to prevent infinite loops

  // Render dashboard tab
  const renderDashboard = () => {
    if (!cacheOverview) {
      return <div className="loading">Loading cache overview...</div>;
    }

    const { statistics, cacheByCalendar, recentOperations, storage, configuration } = cacheOverview;

    return (
      <div className="cache-dashboard">
        <div className="dashboard-controls">
          <button 
            onClick={cleanDuplicates}
            className="action-btn primary"
            disabled={loading}
          >
            🧹 Clean Duplicate Entries
          </button>
          <button 
            onClick={() => performCleanup('expired')}
            className="action-btn"
            disabled={loading}
          >
            🗑️ Clean Expired Entries
          </button>
          <button 
            onClick={loadCacheOverview}
            className="action-btn"
            disabled={loading}
          >
            🔄 Refresh
          </button>
        </div>
        <div className="dashboard-grid">
          {/* Cache Statistics */}
          <div className="stats-card">
            <h3>📊 Cache Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-label">Total Cached:</span>
                <span className="stat-value">{statistics.totalCached}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Active:</span>
                <span className="stat-value">{statistics.activeCount}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Expired:</span>
                <span className="stat-value">{statistics.expiredCount}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Dirty:</span>
                <span className="stat-value">{statistics.dirtyCount}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Hit Ratio:</span>
                <span className="stat-value">{statistics.hitRatio}%</span>
              </div>
            </div>
          </div>

          {/* Storage Information */}
          <div className="stats-card">
            <h3>💾 Storage</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-label">Total Size:</span>
                <span className="stat-value">{Math.round(storage.totalSize / 1024)} KB</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Index Size:</span>
                <span className="stat-value">{Math.round(storage.indexSize / 1024)} KB</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Documents:</span>
                <span className="stat-value">{storage.documentCount}</span>
              </div>
            </div>
          </div>

          {/* Configuration */}
          <div className="stats-card">
            <h3>⚙️ Configuration</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-label">Max Cache Size:</span>
                <span className="stat-value">{configuration.maxCacheSize}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">TTL Hours:</span>
                <span className="stat-value">{configuration.ttlHours}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Stale Threshold:</span>
                <span className="stat-value">{configuration.staleThresholdMinutes} min</span>
              </div>
            </div>
          </div>

          {/* Cache by Calendar */}
          <div className="stats-card full-width">
            <h3>📅 Cache by Calendar</h3>
            {cacheByCalendar.length > 0 ? (
              <div className="calendar-list">
                {cacheByCalendar.map((cal, index) => (
                  <div key={index} className="calendar-item">
                    <div className="calendar-info">
                      <span className="calendar-id">{cal._id || 'Unknown'}</span>
                      <span className="calendar-count">{cal.count} events</span>
                    </div>
                    <div className="calendar-dates">
                      {cal.oldestCached && (
                        <span className="cache-date">
                          Oldest: {new Date(cal.oldestCached).toLocaleDateString()}
                        </span>
                      )}
                      {cal.newestCached && (
                        <span className="cache-date">
                          Newest: {new Date(cal.newestCached).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p>No cached events found</p>
            )}
          </div>

          {/* Recent Operations */}
          <div className="stats-card full-width">
            <h3>🕐 Recent Operations</h3>
            {recentOperations.length > 0 ? (
              <div className="operations-list">
                {recentOperations.map((op, index) => (
                  <div key={index} className="operation-item">
                    <div className="operation-info">
                      <span className="operation-subject">{op.subject}</span>
                      <span className="operation-status">
                        {op.isDirty ? '🔄 Dirty' : '✅ Clean'}
                      </span>
                    </div>
                    <div className="operation-dates">
                      <span className="operation-date">
                        Cached: {new Date(op.cachedAt).toLocaleString()}
                      </span>
                      <span className="operation-date">
                        Last Access: {new Date(op.lastAccessedAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p>No recent operations</p>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="dashboard-actions">
          <button 
            onClick={() => loadCacheOverview()} 
            disabled={loading}
            className="refresh-btn"
          >
            🔄 Refresh Dashboard
          </button>
          <button 
            onClick={() => performCleanup('expired')} 
            disabled={loading}
            className="cleanup-btn"
          >
            🧹 Clean Expired
          </button>
          <button 
            onClick={() => performCleanup('dirty')} 
            disabled={loading}
            className="cleanup-btn"
          >
            🔄 Clean Dirty
          </button>
        </div>
      </div>
    );
  };

  // Render browser tab
  const renderBrowser = () => {
    return (
      <div className="cache-browser">
        {/* Filters */}
        <div className="browser-filters">
          <div className="filter-row">
            <div className="search-container">
              <input
                type="text"
                placeholder="Search events..."
                value={filters.search}
                onChange={(e) => handleFilterChange('search', e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="search-input"
              />
              <button 
                onClick={handleSearchClick}
                className="search-btn"
                title="Search"
              >
                🔍
              </button>
            </div>
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="filter-select"
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="dirty">Dirty</option>
            </select>
            <select
              value={filters.sortBy}
              onChange={(e) => handleFilterChange('sortBy', e.target.value)}
              className="filter-select"
            >
              <option value="cachedAt">Cache Date</option>
              <option value="lastAccessedAt">Last Access</option>
              <option value="expiresAt">Expires At</option>
              <option value="eventData.subject">Subject</option>
            </select>
            <select
              value={filters.sortOrder}
              onChange={(e) => handleFilterChange('sortOrder', e.target.value)}
              className="filter-select"
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </div>
        </div>

        {/* Events Table */}
        <div className="events-table-container">
          {loading ? (
            <div className="loading">Loading cached events...</div>
          ) : cachedEvents.length > 0 ? (
            <table className="events-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Start Time</th>
                  <th>Location</th>
                  <th>Enhanced</th>
                  <th>Setup/Teardown</th>
                  <th>Cached At</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {cachedEvents.map((event) => (
                  <tr key={event._id}>
                    <td className="event-subject">
                      <div className="subject-cell">
                        <div className="subject-title">{event.subject}</div>
                        {event.category && event.category !== 'Uncategorized' && (
                          <div className="event-category">📋 {event.category}</div>
                        )}
                        {event.mecCategories && event.mecCategories.length > 0 && (
                          <div className="mec-categories">
                            🏷️ {event.mecCategories.join(', ')}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="event-time">
                      <div className="time-cell">
                        <div className="main-time">
                          {event.startTime ? new Date(event.startTime).toLocaleString() : 'N/A'}
                        </div>
                        {event.hasRegistrationEvent && event.registrationStart && (
                          <div className="registration-time">
                            🎟️ Reg: {new Date(event.registrationStart).toLocaleString()}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="event-location">{event.location || 'N/A'}</td>
                    <td className="enhancement-info">
                      <div className="enhancement-indicators">
                        {event.hasInternalData && <span title="Has internal data">📝</span>}
                        {event.hasRegistrationEvent && <span title="Has registration event">🎟️</span>}
                        {event.setupMinutes > 0 && <span title="Has setup time">⚙️</span>}
                        {event.teardownMinutes > 0 && <span title="Has teardown time">🧹</span>}
                        {event.assignedTo && <span title="Has staff assignment">👤</span>}
                        {event.registrationNotes && <span title="Has notes">📝</span>}
                        {event.extensions && event.extensions.length > 0 && <span title="Has extensions">🔌</span>}
                      </div>
                    </td>
                    <td className="setup-teardown">
                      {event.setupMinutes > 0 || event.teardownMinutes > 0 ? (
                        <div className="times">
                          {event.setupMinutes > 0 && <div>⚙️ {event.setupMinutes}m</div>}
                          {event.teardownMinutes > 0 && <div>🧹 {event.teardownMinutes}m</div>}
                        </div>
                      ) : (
                        <span className="no-times">-</span>
                      )}
                    </td>
                    <td className="cache-date">
                      {new Date(event.cachedAt).toLocaleString()}
                    </td>
                    <td className="event-status">
                      {event.isDirty ? (
                        <span className="status dirty">🔄 Dirty</span>
                      ) : new Date(event.expiresAt) < new Date() ? (
                        <span className="status expired">⏰ Expired</span>
                      ) : (
                        <span className="status active">✅ Active</span>
                      )}
                    </td>
                    <td className="event-actions">
                      <button
                        onClick={() => invalidateSelectedEvents([event.eventId])}
                        className="action-btn invalidate-btn"
                        title="Invalidate cache for this event"
                      >
                        🔄
                      </button>
                      <button
                        onClick={() => {/* TODO: Show detailed view */}}
                        className="action-btn details-btn"
                        title="View detailed information"
                      >
                        🔍
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="no-data">No cached events found</div>
          )}
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="pagination">
            <button
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="page-btn"
            >
              ← Previous
            </button>
            <span className="page-info">
              Page {pagination.page} of {pagination.totalPages} 
              ({pagination.totalCount} total events)
            </span>
            <button
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="page-btn"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    );
  };

  // Render performance tab
  const renderPerformance = () => {
    return (
      <div className="cache-performance">
        <div className="performance-actions">
          <button
            onClick={() => runPerformanceTest('basic')}
            disabled={testRunning}
            className="test-btn"
          >
            {testRunning ? '⏳ Running...' : '🚀 Run Basic Test'}
          </button>
          <button
            onClick={() => runPerformanceTest('detailed')}
            disabled={testRunning}
            className="test-btn"
          >
            {testRunning ? '⏳ Running...' : '📊 Run Detailed Test'}
          </button>
        </div>

        {performanceResults && (
          <div className="performance-results">
            <h3>📈 Performance Test Results</h3>
            <div className="results-grid">
              <div className="result-card">
                <h4>⚡ Performance Metrics</h4>
                <div className="metrics">
                  <div className="metric">
                    <span>Cache Lookup Time:</span>
                    <span>{performanceResults.performance.cacheLookupTimeMs} ms</span>
                  </div>
                  <div className="metric">
                    <span>Query Time:</span>
                    <span>{performanceResults.performance.queryTimeMs} ms</span>
                  </div>
                  <div className="metric">
                    <span>Cached Events:</span>
                    <span>{performanceResults.performance.cachedEventCount}</span>
                  </div>
                  <div className="metric">
                    <span>Avg Event Size:</span>
                    <span>{performanceResults.performance.avgEventSizeBytes} bytes</span>
                  </div>
                </div>
              </div>

              <div className="result-card">
                <h4>💾 Utilization</h4>
                <div className="metrics">
                  <div className="metric">
                    <span>Total Cache Size:</span>
                    <span>{performanceResults.utilization.totalCacheSize}</span>
                  </div>
                  <div className="metric">
                    <span>User Cache Size:</span>
                    <span>{performanceResults.utilization.userCacheSize}</span>
                  </div>
                  <div className="metric">
                    <span>User Percentage:</span>
                    <span>{performanceResults.utilization.userCachePercentage}%</span>
                  </div>
                  <div className="metric">
                    <span>Overall Utilization:</span>
                    <span>{performanceResults.utilization.utilizationPercentage}%</span>
                  </div>
                </div>
              </div>

              {performanceResults.indexes && (
                <div className="result-card full-width">
                  <h4>📋 Index Performance</h4>
                  <div className="metrics">
                    <div className="metric">
                      <span>Analysis Time:</span>
                      <span>{performanceResults.indexes.analysisTimeMs} ms</span>
                    </div>
                    <div className="metric">
                      <span>Index Count:</span>
                      <span>{performanceResults.indexes.indexCount}</span>
                    </div>
                  </div>
                  <div className="index-list">
                    {performanceResults.indexes.indexes.map((idx, i) => (
                      <div key={i} className="index-item">
                        <span className="index-name">{idx.name}</span>
                        <span className="index-accesses">{idx.accesses} accesses</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <div className="test-metadata">
              <p><strong>Test Type:</strong> {performanceResults.testType}</p>
              <p><strong>Timestamp:</strong> {new Date(performanceResults.timestamp).toLocaleString()}</p>
              {performanceResults.calendarId && (
                <p><strong>Calendar ID:</strong> {performanceResults.calendarId}</p>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!apiToken) {
    return (
      <div className="cache-admin">
        <div className="error-message">
          API token is required to access cache administration.
        </div>
      </div>
    );
  }

  return (
    <div className="cache-admin">
      <div className="admin-header">
        <h1>🗂️ Cache Management</h1>
        <p>Monitor and manage the MongoDB event cache system</p>
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
          className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          📊 Dashboard
        </button>
        <button
          className={`tab ${activeTab === 'browser' ? 'active' : ''}`}
          onClick={() => setActiveTab('browser')}
        >
          🔍 Cache Browser
        </button>
        <button
          className={`tab ${activeTab === 'performance' ? 'active' : ''}`}
          onClick={() => setActiveTab('performance')}
        >
          📈 Performance
        </button>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {loading && <div className="loading-overlay">Loading...</div>}
        {activeTab === 'dashboard' && renderDashboard()}
        {activeTab === 'browser' && renderBrowser()}
        {activeTab === 'performance' && renderPerformance()}
      </div>
    </div>
  );
}