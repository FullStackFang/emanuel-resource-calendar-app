import React, { useState, useEffect } from 'react';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';
import './EventAuditHistory.css';

const EventAuditHistory = ({ eventId, apiToken }) => {
  const [auditHistory, setAuditHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedEntries, setExpandedEntries] = useState(new Set());

  useEffect(() => {
    if (eventId && apiToken) {
      fetchAuditHistory();
    }
  }, [eventId, apiToken]);

  const fetchAuditHistory = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/${eventId}/audit-history`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch audit history: ${response.status}`);
      }

      const data = await response.json();
      setAuditHistory(data.auditHistory || []);
    } catch (err) {
      logger.error('Error fetching audit history:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = (entryIndex) => {
    const newExpanded = new Set(expandedEntries);
    if (newExpanded.has(entryIndex)) {
      newExpanded.delete(entryIndex);
    } else {
      newExpanded.add(entryIndex);
    }
    setExpandedEntries(newExpanded);
  };

  const getChangeTypeIcon = (changeType) => {
    switch (changeType) {
      case 'create': return '➕';
      case 'update': return '✏️';
      case 'delete': return '🗑️';
      case 'import': return '📥';
      default: return '📝';
    }
  };

  const getSourceIcon = (source) => {
    if (source?.includes('Resource Scheduler')) return '📊';
    if (source?.includes('Import')) return '📥';
    if (source?.includes('Manual')) return '✏️';
    return '📝';
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    const dateStr = date.toLocaleDateString();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return { dateStr, timeStr };
  };

  const formatFieldName = (fieldName) => {
    const fieldMap = {
      'subject': 'Event Title',
      'startTime': 'Start Time',
      'endTime': 'End Time',
      'location': 'Location',
      'source': 'Source',
      'internalData.mecCategories': 'Categories',
      'internalData.assignedTo': 'Assigned To',
      'internalData.internalNotes': 'Notes',
      'internalData.rsId': 'Resource Scheduler ID',
      'internalData.rsEventCode': 'Event Code',
      'internalData.requesterName': 'Requester Name',
      'internalData.requesterEmail': 'Requester Email'
    };
    return fieldMap[fieldName] || fieldName;
  };

  const formatValue = (value) => {
    if (value === null || value === undefined) return 'None';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'string' && value.includes('T') && value.includes('Z')) {
      // Format ISO date strings
      try {
        const date = new Date(value);
        return date.toLocaleString();
      } catch {
        return value;
      }
    }
    return value.toString();
  };

  const renderChangeSet = (changeSet) => {
    if (!changeSet || changeSet.length === 0) return null;

    return (
      <div className="change-set">
        {changeSet.map((change, index) => (
          <div key={index} className="change-item">
            <div className="change-field">{formatFieldName(change.field)}</div>
            <div className="change-values">
              <div className="old-value">
                <span className="value-label">From:</span>
                <span className="value">{formatValue(change.oldValue)}</span>
              </div>
              <div className="value-arrow">→</div>
              <div className="new-value">
                <span className="value-label">To:</span>
                <span className="value">{formatValue(change.newValue)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="audit-history-loading">
        <div className="loading-spinner">⏳</div>
        <div>Loading event history...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="audit-history-error">
        <div className="error-icon">⚠️</div>
        <div>Failed to load event history: {error}</div>
        <button onClick={fetchAuditHistory} className="retry-button">
          🔄 Retry
        </button>
      </div>
    );
  }

  if (auditHistory.length === 0) {
    return (
      <div className="audit-history-empty">
        <div className="empty-icon">📝</div>
        <div>No history available</div>
        <div className="empty-subtitle">This event hasn't been modified since creation</div>
      </div>
    );
  }

  return (
    <div className="audit-history">
      <div className="audit-header">
        <h4>Event History ({auditHistory.length} entries)</h4>
        <div className="audit-legend">
          <span className="legend-item">
            <span className="legend-icon">➕</span> Created
          </span>
          <span className="legend-item">
            <span className="legend-icon">✏️</span> Updated
          </span>
          <span className="legend-item">
            <span className="legend-icon">📥</span> Imported
          </span>
        </div>
      </div>

      <div className="audit-timeline">
        {auditHistory.map((entry, index) => {
          const { dateStr, timeStr } = formatTimestamp(entry.timestamp);
          const isExpanded = expandedEntries.has(index);
          const hasDetails = entry.changeSet && entry.changeSet.length > 0;

          return (
            <div key={index} className="audit-entry">
              <div className="audit-entry-header">
                <div className="audit-entry-left">
                  <span className="change-type-icon">
                    {getChangeTypeIcon(entry.changeType)}
                  </span>
                  <div className="audit-entry-info">
                    <div className="audit-entry-action">
                      <strong>{entry.changeType ? (entry.changeType.charAt(0).toUpperCase() + entry.changeType.slice(1)) : (entry.action || 'Update')}</strong>
                      {entry.source && (
                        <span className="audit-source">
                          {getSourceIcon(entry.source)} {entry.source}
                        </span>
                      )}
                    </div>
                    <div className="audit-entry-time">
                      {dateStr} at {timeStr}
                    </div>
                  </div>
                </div>

                {hasDetails && (
                  <button
                    className={`expand-button ${isExpanded ? 'expanded' : ''}`}
                    onClick={() => toggleExpanded(index)}
                    title={isExpanded ? 'Hide details' : 'Show details'}
                  >
                    {isExpanded ? '▼' : '▶'}
                  </button>
                )}
              </div>

              {entry.metadata?.reason && (
                <div className="audit-reason">
                  <strong>Reason:</strong> {entry.metadata.reason}
                </div>
              )}

              {entry.metadata?.importSessionId && (
                <div className="audit-session">
                  <strong>Import Session:</strong> {entry.metadata.importSessionId}
                </div>
              )}

              {isExpanded && hasDetails && (
                <div className="audit-details">
                  <div className="details-header">Changes made:</div>
                  {renderChangeSet(entry.changeSet)}
                </div>
              )}

              {entry.changes && (
                <div className="audit-single-change">
                  <strong>{entry.changes.field}:</strong> {formatValue(entry.changes.oldValue)} → {formatValue(entry.changes.newValue)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default EventAuditHistory;