/**
 * ErrorLogAdmin Component
 * Admin dashboard for viewing and managing error logs
 */

import React, { useState, useEffect, useCallback } from 'react';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';
import './ErrorLogAdmin.css';

// Severity badge colors
const SEVERITY_COLORS = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#16a34a'
};

// Source labels
const SOURCE_LABELS = {
  frontend: 'Frontend',
  backend: 'Backend',
  api: 'API',
  graph_api: 'Graph API'
};

// Type labels
const TYPE_LABELS = {
  error: 'Error',
  warning: 'Warning',
  user_report: 'User Report'
};

function ErrorLogAdmin({ apiToken }) {
  const [errors, setErrors] = useState([]);
  const [stats, setStats] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedError, setSelectedError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  // Filter state
  const [filters, setFilters] = useState({
    type: '',
    severity: '',
    source: '',
    reviewed: '',
    search: ''
  });

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Review modal state
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewResolution, setReviewResolution] = useState('');
  const [isReviewing, setIsReviewing] = useState(false);

  // Fetch error logs
  const fetchErrors = useCallback(async () => {
    if (!apiToken) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '25'
      });

      if (filters.type) params.append('type', filters.type);
      if (filters.severity) params.append('severity', filters.severity);
      if (filters.source) params.append('source', filters.source);
      if (filters.reviewed) params.append('reviewed', filters.reviewed);
      if (filters.search) params.append('search', filters.search);

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/error-logs?${params.toString()}`,
        {
          headers: { 'Authorization': `Bearer ${apiToken}` }
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch error logs');
      }

      const data = await response.json();
      setErrors(data.errors || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);

    } catch (error) {
      logger.error('Error fetching error logs:', error);
    } finally {
      setLoading(false);
    }
  }, [apiToken, page, filters]);

  // Fetch statistics
  const fetchStats = useCallback(async () => {
    if (!apiToken) return;

    try {
      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/error-logs/stats`,
        {
          headers: { 'Authorization': `Bearer ${apiToken}` }
        }
      );

      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      logger.error('Error fetching stats:', error);
    }
  }, [apiToken]);

  // Fetch settings
  const fetchSettings = useCallback(async () => {
    if (!apiToken) return;

    try {
      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/error-settings`,
        {
          headers: { 'Authorization': `Bearer ${apiToken}` }
        }
      );

      if (response.ok) {
        const data = await response.json();
        setSettings(data);
      }
    } catch (error) {
      logger.error('Error fetching settings:', error);
    }
  }, [apiToken]);

  // Initial load
  useEffect(() => {
    fetchErrors();
    fetchStats();
    fetchSettings();
  }, [fetchErrors, fetchStats, fetchSettings]);

  // Refetch on filter change
  useEffect(() => {
    setPage(1);
  }, [filters]);

  // Mark as reviewed
  const handleMarkReviewed = async (errorId, reviewed = true) => {
    setIsReviewing(true);
    try {
      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/error-logs/${errorId}/review`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify({
            reviewed,
            resolution: reviewResolution,
            notes: reviewNotes
          })
        }
      );

      if (response.ok) {
        // Refresh data
        fetchErrors();
        fetchStats();
        setSelectedError(null);
        setReviewNotes('');
        setReviewResolution('');
      }
    } catch (error) {
      logger.error('Error updating review:', error);
    } finally {
      setIsReviewing(false);
    }
  };

  // Update settings
  const handleUpdateSettings = async (newSettings) => {
    try {
      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/error-settings`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify(newSettings)
        }
      );

      if (response.ok) {
        const data = await response.json();
        setSettings(data);
        setShowSettings(false);
      }
    } catch (error) {
      logger.error('Error updating settings:', error);
    }
  };

  // Format timestamp
  const formatTimestamp = (isoString) => {
    if (!isoString) return '-';
    return new Date(isoString).toLocaleString();
  };

  // Truncate text
  const truncate = (text, maxLength = 100) => {
    if (!text) return '-';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  return (
    <div className="error-log-admin">
      <div className="error-log-header">
        <h1>Error Logs</h1>
        <button
          className="error-log-settings-btn"
          onClick={() => setShowSettings(true)}
        >
          Settings
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="error-log-stats">
          <div className="error-stat-card critical">
            <div className="error-stat-value">{stats.bySeverity?.critical || 0}</div>
            <div className="error-stat-label">Critical</div>
          </div>
          <div className="error-stat-card high">
            <div className="error-stat-value">{stats.bySeverity?.high || 0}</div>
            <div className="error-stat-label">High</div>
          </div>
          <div className="error-stat-card medium">
            <div className="error-stat-value">{stats.bySeverity?.medium || 0}</div>
            <div className="error-stat-label">Medium</div>
          </div>
          <div className="error-stat-card user-reports">
            <div className="error-stat-value">{stats.byType?.user_report || 0}</div>
            <div className="error-stat-label">User Reports</div>
          </div>
          <div className="error-stat-card unreviewed">
            <div className="error-stat-value">{stats.unreviewedCount || 0}</div>
            <div className="error-stat-label">Unreviewed</div>
          </div>
          <div className="error-stat-card today">
            <div className="error-stat-value">{stats.todayCount || 0}</div>
            <div className="error-stat-label">Today</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="error-log-filters">
        <div className="error-filter-group">
          <label>Type</label>
          <select
            value={filters.type}
            onChange={e => setFilters({ ...filters, type: e.target.value })}
          >
            <option value="">All Types</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
            <option value="user_report">User Report</option>
          </select>
        </div>

        <div className="error-filter-group">
          <label>Severity</label>
          <select
            value={filters.severity}
            onChange={e => setFilters({ ...filters, severity: e.target.value })}
          >
            <option value="">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        <div className="error-filter-group">
          <label>Source</label>
          <select
            value={filters.source}
            onChange={e => setFilters({ ...filters, source: e.target.value })}
          >
            <option value="">All Sources</option>
            <option value="frontend">Frontend</option>
            <option value="backend">Backend</option>
            <option value="api">API</option>
          </select>
        </div>

        <div className="error-filter-group">
          <label>Status</label>
          <select
            value={filters.reviewed}
            onChange={e => setFilters({ ...filters, reviewed: e.target.value })}
          >
            <option value="">All</option>
            <option value="false">Unreviewed</option>
            <option value="true">Reviewed</option>
          </select>
        </div>

        <div className="error-filter-group search">
          <label>Search</label>
          <input
            type="text"
            placeholder="Search message, correlation ID..."
            value={filters.search}
            onChange={e => setFilters({ ...filters, search: e.target.value })}
          />
        </div>
      </div>

      {/* Error List */}
      <div className="error-log-table-container">
        {loading ? (
          <div className="error-log-loading">Loading...</div>
        ) : errors.length === 0 ? (
          <div className="error-log-empty">No errors found</div>
        ) : (
          <table className="error-log-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Severity</th>
                <th>Source</th>
                <th>Message</th>
                <th>User</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {errors.map(error => (
                <tr
                  key={error._id}
                  className={error.reviewed ? 'reviewed' : ''}
                  onClick={() => setSelectedError(error)}
                >
                  <td className="error-time">
                    {formatTimestamp(error.createdAt)}
                  </td>
                  <td>
                    <span
                      className="error-severity-badge"
                      style={{ backgroundColor: SEVERITY_COLORS[error.severity] || '#6b7280' }}
                    >
                      {error.severity}
                    </span>
                  </td>
                  <td>{SOURCE_LABELS[error.source] || error.source}</td>
                  <td className="error-message-cell" title={error.message}>
                    {truncate(error.message, 60)}
                    {error.occurrenceCount > 1 && (
                      <span className="error-occurrence-badge">
                        x{error.occurrenceCount}
                      </span>
                    )}
                  </td>
                  <td>{error.userContext?.email || '-'}</td>
                  <td>
                    {error.reviewed ? (
                      <span className="error-status reviewed">Reviewed</span>
                    ) : (
                      <span className="error-status unreviewed">Unreviewed</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="error-action-btn"
                      onClick={e => {
                        e.stopPropagation();
                        setSelectedError(error);
                      }}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="error-log-pagination">
          <button
            disabled={page === 1}
            onClick={() => setPage(p => p - 1)}
          >
            Previous
          </button>
          <span>Page {page} of {totalPages} ({total} total)</span>
          <button
            disabled={page === totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </button>
        </div>
      )}

      {/* Error Detail Modal */}
      {selectedError && (
        <div className="error-detail-modal-overlay" onClick={() => setSelectedError(null)}>
          <div className="error-detail-modal" onClick={e => e.stopPropagation()}>
            <button
              className="error-detail-close"
              onClick={() => setSelectedError(null)}
            >
              &times;
            </button>

            <h2>Error Details</h2>

            <div className="error-detail-section">
              <div className="error-detail-row">
                <span className="error-detail-label">Correlation ID:</span>
                <code>{selectedError.correlationId}</code>
              </div>
              <div className="error-detail-row">
                <span className="error-detail-label">Severity:</span>
                <span
                  className="error-severity-badge"
                  style={{ backgroundColor: SEVERITY_COLORS[selectedError.severity] }}
                >
                  {selectedError.severity}
                </span>
              </div>
              <div className="error-detail-row">
                <span className="error-detail-label">Source:</span>
                <span>{SOURCE_LABELS[selectedError.source] || selectedError.source}</span>
              </div>
              <div className="error-detail-row">
                <span className="error-detail-label">Type:</span>
                <span>{TYPE_LABELS[selectedError.type] || selectedError.type}</span>
              </div>
              <div className="error-detail-row">
                <span className="error-detail-label">Time:</span>
                <span>{formatTimestamp(selectedError.createdAt)}</span>
              </div>
              <div className="error-detail-row">
                <span className="error-detail-label">Occurrences:</span>
                <span>{selectedError.occurrenceCount || 1}</span>
              </div>
            </div>

            <div className="error-detail-section">
              <h3>Message</h3>
              <div className="error-detail-message">{selectedError.message}</div>
            </div>

            {selectedError.userDescription && (
              <div className="error-detail-section">
                <h3>User Description</h3>
                <div className="error-detail-message">{selectedError.userDescription}</div>
              </div>
            )}

            {selectedError.stack && (
              <div className="error-detail-section">
                <h3>Stack Trace</h3>
                <pre className="error-detail-stack">{selectedError.stack}</pre>
              </div>
            )}

            {selectedError.userContext && (
              <div className="error-detail-section">
                <h3>User Context</h3>
                <div className="error-detail-row">
                  <span className="error-detail-label">Email:</span>
                  <span>{selectedError.userContext.email || '-'}</span>
                </div>
                <div className="error-detail-row">
                  <span className="error-detail-label">Name:</span>
                  <span>{selectedError.userContext.name || '-'}</span>
                </div>
              </div>
            )}

            {selectedError.browserContext && (
              <div className="error-detail-section">
                <h3>Browser Context</h3>
                <div className="error-detail-row">
                  <span className="error-detail-label">URL:</span>
                  <span>{selectedError.browserContext.url || '-'}</span>
                </div>
                <div className="error-detail-row">
                  <span className="error-detail-label">User Agent:</span>
                  <span className="error-detail-wrap">{selectedError.browserContext.userAgent || '-'}</span>
                </div>
              </div>
            )}

            {selectedError.endpoint && (
              <div className="error-detail-section">
                <h3>Endpoint</h3>
                <code>{selectedError.endpoint}</code>
              </div>
            )}

            {/* Review Section */}
            <div className="error-detail-section review-section">
              <h3>Review</h3>

              {selectedError.reviewed ? (
                <div className="error-review-info">
                  <p>Reviewed by: {selectedError.reviewedBy?.email || 'Unknown'}</p>
                  <p>Reviewed at: {formatTimestamp(selectedError.reviewedAt)}</p>
                  {selectedError.resolution && (
                    <p>Resolution: {selectedError.resolution}</p>
                  )}
                  {selectedError.notes && (
                    <p>Notes: {selectedError.notes}</p>
                  )}
                  <button
                    className="error-review-btn secondary"
                    onClick={() => handleMarkReviewed(selectedError._id, false)}
                    disabled={isReviewing}
                  >
                    Mark as Unreviewed
                  </button>
                </div>
              ) : (
                <div className="error-review-form">
                  <div className="error-review-field">
                    <label>Resolution</label>
                    <select
                      value={reviewResolution}
                      onChange={e => setReviewResolution(e.target.value)}
                    >
                      <option value="">Select resolution...</option>
                      <option value="fixed">Fixed</option>
                      <option value="wont_fix">Won't Fix</option>
                      <option value="duplicate">Duplicate</option>
                      <option value="cannot_reproduce">Cannot Reproduce</option>
                      <option value="user_error">User Error</option>
                      <option value="investigating">Investigating</option>
                    </select>
                  </div>
                  <div className="error-review-field">
                    <label>Notes</label>
                    <textarea
                      value={reviewNotes}
                      onChange={e => setReviewNotes(e.target.value)}
                      placeholder="Add notes about this error..."
                      rows={3}
                    />
                  </div>
                  <button
                    className="error-review-btn primary"
                    onClick={() => handleMarkReviewed(selectedError._id, true)}
                    disabled={isReviewing}
                  >
                    {isReviewing ? 'Saving...' : 'Mark as Reviewed'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && settings && (
        <div className="error-settings-modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="error-settings-modal" onClick={e => e.stopPropagation()}>
            <button
              className="error-settings-close"
              onClick={() => setShowSettings(false)}
            >
              &times;
            </button>

            <h2>Error Notification Settings</h2>

            <div className="error-settings-form">
              <div className="error-settings-field">
                <label>
                  <input
                    type="checkbox"
                    checked={settings.notificationsEnabled}
                    onChange={e => setSettings({ ...settings, notificationsEnabled: e.target.checked })}
                  />
                  Enable email notifications
                </label>
              </div>

              <div className="error-settings-field">
                <label>Notify on severity levels:</label>
                <div className="error-settings-checkboxes">
                  {['critical', 'high', 'medium', 'low'].map(sev => (
                    <label key={sev}>
                      <input
                        type="checkbox"
                        checked={settings.notifyOnSeverity?.includes(sev)}
                        onChange={e => {
                          const newSeverities = e.target.checked
                            ? [...(settings.notifyOnSeverity || []), sev]
                            : (settings.notifyOnSeverity || []).filter(s => s !== sev);
                          setSettings({ ...settings, notifyOnSeverity: newSeverities });
                        }}
                      />
                      {sev.charAt(0).toUpperCase() + sev.slice(1)}
                    </label>
                  ))}
                </div>
              </div>

              <div className="error-settings-field">
                <label>Email cooldown (minutes):</label>
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={settings.emailCooldownMinutes || 15}
                  onChange={e => setSettings({ ...settings, emailCooldownMinutes: parseInt(e.target.value) })}
                />
              </div>

              <div className="error-settings-field">
                <label>Daily email limit:</label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={settings.dailyEmailLimit || 50}
                  onChange={e => setSettings({ ...settings, dailyEmailLimit: parseInt(e.target.value) })}
                />
              </div>

              <div className="error-settings-field">
                <label>Log retention (days):</label>
                <input
                  type="number"
                  min="7"
                  max="365"
                  value={settings.retentionDays || 90}
                  onChange={e => setSettings({ ...settings, retentionDays: parseInt(e.target.value) })}
                />
              </div>

              <div className="error-settings-actions">
                <button
                  className="error-settings-btn secondary"
                  onClick={() => setShowSettings(false)}
                >
                  Cancel
                </button>
                <button
                  className="error-settings-btn primary"
                  onClick={() => handleUpdateSettings(settings)}
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ErrorLogAdmin;
