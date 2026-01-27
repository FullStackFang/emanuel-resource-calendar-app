/**
 * ErrorLogAdmin Component
 * Admin dashboard for viewing and managing user-submitted reports
 * Note: Automatic errors are now handled by Sentry - see Sentry dashboard
 */

import React, { useState, useEffect, useCallback } from 'react';
import * as Sentry from '@sentry/react';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';
import './ErrorLogAdmin.css';

// Category labels for user reports
const CATEGORY_LABELS = {
  general: 'General',
  bug: 'Bug Report',
  feature: 'Feature Request',
  performance: 'Performance Issue',
  ui: 'UI/Display Issue',
  other: 'Other'
};

function ErrorLogAdmin({ apiToken }) {
  const [reports, setReports] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState(null);

  // Filter state
  const [filters, setFilters] = useState({
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

  // Sentry test state
  const [testingFrontend, setTestingFrontend] = useState(false);
  const [testingBackend, setTestingBackend] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Fetch user reports
  const fetchReports = useCallback(async () => {
    if (!apiToken) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '25',
        type: 'user_report' // Only fetch user reports
      });

      if (filters.reviewed) params.append('reviewed', filters.reviewed);
      if (filters.search) params.append('search', filters.search);

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/error-logs?${params.toString()}`,
        {
          headers: { 'Authorization': `Bearer ${apiToken}` }
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch reports');
      }

      const data = await response.json();
      setReports(data.errors || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);

    } catch (error) {
      logger.error('Error fetching reports:', error);
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

  // Initial load
  useEffect(() => {
    fetchReports();
    fetchStats();
  }, [fetchReports, fetchStats]);

  // Refetch on filter change
  useEffect(() => {
    setPage(1);
  }, [filters]);

  // Mark as reviewed
  const handleMarkReviewed = async (reportId, reviewed = true) => {
    setIsReviewing(true);
    try {
      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/error-logs/${reportId}/review`,
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
        fetchReports();
        fetchStats();
        setSelectedReport(null);
        setReviewNotes('');
        setReviewResolution('');
      }
    } catch (error) {
      logger.error('Error updating review:', error);
    } finally {
      setIsReviewing(false);
    }
  };

  // Test Sentry frontend error
  const testFrontendError = () => {
    setTestingFrontend(true);
    setTestResult(null);

    try {
      // Capture a test error to Sentry
      const testError = new Error(`[TEST] Frontend Sentry test error - ${new Date().toISOString()}`);
      Sentry.captureException(testError, {
        tags: { test: true, source: 'ErrorLogAdmin' },
        extra: { triggeredBy: 'Test Sentry Frontend button' }
      });

      setTestResult({
        type: 'success',
        message: 'Frontend test error sent to Sentry! Check your Sentry dashboard.'
      });
    } catch (err) {
      setTestResult({
        type: 'error',
        message: `Failed to send test error: ${err.message}`
      });
    } finally {
      setTestingFrontend(false);
    }
  };

  // Test Sentry backend error
  const testBackendError = async () => {
    setTestingBackend(true);
    setTestResult(null);

    try {
      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/test-sentry`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          }
        }
      );

      const data = await response.json();

      if (response.ok) {
        setTestResult({
          type: 'success',
          message: data.message || 'Backend test error sent to Sentry! Check your Sentry dashboard.'
        });
      } else {
        setTestResult({
          type: 'error',
          message: data.error || 'Failed to trigger backend test error'
        });
      }
    } catch (err) {
      setTestResult({
        type: 'error',
        message: `Failed to call backend: ${err.message}`
      });
    } finally {
      setTestingBackend(false);
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
        <h1>User Reports</h1>
        <p className="error-log-subtitle">
          User-submitted feedback and issue reports.
          For automatic error tracking, see the{' '}
          <a
            href="https://sentry.io"
            target="_blank"
            rel="noopener noreferrer"
            className="sentry-link"
          >
            Sentry Dashboard
          </a>
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="error-log-stats">
          <div className="error-stat-card user-reports">
            <div className="error-stat-value">{stats.total || 0}</div>
            <div className="error-stat-label">Total Reports</div>
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

      {/* Sentry Test Section */}
      <div className="sentry-test-section">
        <h3>Test Sentry Integration</h3>
        <p className="sentry-test-description">
          Send test errors to verify Sentry is configured correctly.
          Check your <a href="https://sentry.io" target="_blank" rel="noopener noreferrer">Sentry dashboard</a> after clicking.
        </p>
        <div className="sentry-test-buttons">
          <button
            className="sentry-test-btn frontend"
            onClick={testFrontendError}
            disabled={testingFrontend}
          >
            {testingFrontend ? 'Sending...' : 'Test Frontend Error'}
          </button>
          <button
            className="sentry-test-btn backend"
            onClick={testBackendError}
            disabled={testingBackend}
          >
            {testingBackend ? 'Sending...' : 'Test Backend Error'}
          </button>
        </div>
        {testResult && (
          <div className={`sentry-test-result ${testResult.type}`}>
            {testResult.message}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="error-log-filters">
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
            placeholder="Search description, user email..."
            value={filters.search}
            onChange={e => setFilters({ ...filters, search: e.target.value })}
          />
        </div>
      </div>

      {/* Reports List */}
      <div className="error-log-table-container">
        {loading ? (
          <div className="error-log-loading">Loading...</div>
        ) : reports.length === 0 ? (
          <div className="error-log-empty">No user reports found</div>
        ) : (
          <table className="error-log-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Category</th>
                <th>Description</th>
                <th>User</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map(report => (
                <tr
                  key={report._id}
                  className={report.reviewed ? 'reviewed' : ''}
                  onClick={() => setSelectedReport(report)}
                >
                  <td className="error-time">
                    {formatTimestamp(report.createdAt)}
                  </td>
                  <td>
                    <span className="error-category-badge">
                      {CATEGORY_LABELS[report.userSelectedCategory] || report.userSelectedCategory || 'General'}
                    </span>
                  </td>
                  <td className="error-message-cell" title={report.userDescription || report.message}>
                    {truncate(report.userDescription || report.message, 60)}
                  </td>
                  <td>{report.userContext?.email || '-'}</td>
                  <td>
                    {report.reviewed ? (
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
                        setSelectedReport(report);
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

      {/* Report Detail Modal */}
      {selectedReport && (
        <div className="error-detail-modal-overlay" onClick={() => setSelectedReport(null)}>
          <div className="error-detail-modal" onClick={e => e.stopPropagation()}>
            <button
              className="error-detail-close"
              onClick={() => setSelectedReport(null)}
            >
              &times;
            </button>

            <h2>User Report Details</h2>

            <div className="error-detail-section">
              <div className="error-detail-row">
                <span className="error-detail-label">Reference ID:</span>
                <code>{selectedReport.correlationId}</code>
              </div>
              <div className="error-detail-row">
                <span className="error-detail-label">Category:</span>
                <span className="error-category-badge">
                  {CATEGORY_LABELS[selectedReport.userSelectedCategory] || selectedReport.userSelectedCategory || 'General'}
                </span>
              </div>
              <div className="error-detail-row">
                <span className="error-detail-label">Submitted:</span>
                <span>{formatTimestamp(selectedReport.createdAt)}</span>
              </div>
            </div>

            <div className="error-detail-section">
              <h3>User Description</h3>
              <div className="error-detail-message">
                {selectedReport.userDescription || selectedReport.message || 'No description provided'}
              </div>
            </div>

            {selectedReport.userContext && (
              <div className="error-detail-section">
                <h3>Submitted By</h3>
                <div className="error-detail-row">
                  <span className="error-detail-label">Email:</span>
                  <span>{selectedReport.userContext.email || '-'}</span>
                </div>
                <div className="error-detail-row">
                  <span className="error-detail-label">Name:</span>
                  <span>{selectedReport.userContext.name || '-'}</span>
                </div>
              </div>
            )}

            {selectedReport.browserContext && (
              <div className="error-detail-section">
                <h3>Browser Context</h3>
                <div className="error-detail-row">
                  <span className="error-detail-label">URL:</span>
                  <span>{selectedReport.browserContext.url || selectedReport.endpoint || '-'}</span>
                </div>
                <div className="error-detail-row">
                  <span className="error-detail-label">Browser:</span>
                  <span className="error-detail-wrap">{selectedReport.browserContext.userAgent || '-'}</span>
                </div>
              </div>
            )}

            {/* Review Section */}
            <div className="error-detail-section review-section">
              <h3>Review</h3>

              {selectedReport.reviewed ? (
                <div className="error-review-info">
                  <p>Reviewed by: {selectedReport.reviewedBy?.email || 'Unknown'}</p>
                  <p>Reviewed at: {formatTimestamp(selectedReport.reviewedAt)}</p>
                  {selectedReport.resolution && (
                    <p>Resolution: {selectedReport.resolution}</p>
                  )}
                  {selectedReport.notes && (
                    <p>Notes: {selectedReport.notes}</p>
                  )}
                  <button
                    className="error-review-btn secondary"
                    onClick={() => handleMarkReviewed(selectedReport._id, false)}
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
                      <option value="addressed">Addressed</option>
                      <option value="wont_fix">Won't Fix</option>
                      <option value="duplicate">Duplicate</option>
                      <option value="need_info">Need More Info</option>
                      <option value="feature_request">Feature Request Logged</option>
                      <option value="investigating">Investigating</option>
                    </select>
                  </div>
                  <div className="error-review-field">
                    <label>Notes</label>
                    <textarea
                      value={reviewNotes}
                      onChange={e => setReviewNotes(e.target.value)}
                      placeholder="Add notes about this report..."
                      rows={3}
                    />
                  </div>
                  <button
                    className="error-review-btn primary"
                    onClick={() => handleMarkReviewed(selectedReport._id, true)}
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
    </div>
  );
}

export default ErrorLogAdmin;
