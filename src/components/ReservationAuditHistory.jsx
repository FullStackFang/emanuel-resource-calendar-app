import React, { useState, useEffect } from 'react';
import LoadingSpinner from './shared/LoadingSpinner';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';
import './ReservationAuditHistory.css';

const ReservationAuditHistory = ({ reservationId, apiToken, refreshTrigger }) => {
  const [auditHistory, setAuditHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedEntries, setExpandedEntries] = useState(new Set());

  useEffect(() => {
    if (reservationId && apiToken) {
      logger.log('🔄 Fetching audit history (refreshTrigger:', refreshTrigger, ')');
      fetchAuditHistory();
    }
  }, [reservationId, apiToken, refreshTrigger]);

  const fetchAuditHistory = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/room-reservations/${reservationId}/audit-history`, {
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
      logger.error('Error fetching reservation audit history:', err);
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
      case 'approve': return '✅';
      case 'reject': return '❌';
      case 'cancel': return '🚫';
      case 'resubmit': return '🔄';
      default: return '📝';
    }
  };

  const getSourceIcon = (source) => {
    if (source?.includes('Space Booking')) return '📝';
    if (source?.includes('Guest')) return '🎫';
    if (source?.includes('Admin')) return '⚙️';
    if (source?.includes('Resubmission')) return '🔄';
    return '📋';
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    const dateStr = date.toLocaleDateString();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return { dateStr, timeStr };
  };

  const formatFieldName = (fieldName) => {
    const fieldMap = {
      'eventTitle': 'Event Title',
      'eventDescription': 'Description',
      'startDateTime': 'Start Time',
      'endDateTime': 'End Time',
      'attendeeCount': 'Attendee Count',
      'requestedRooms': 'Requested Rooms',
      'requiredFeatures': 'Required Features',
      'specialRequirements': 'Special Requirements',
      'department': 'Department',
      'phone': 'Phone',
      'setupTimeMinutes': 'Setup Time',
      'teardownTimeMinutes': 'Teardown Time',
      'setupTime': 'Setup Time',
      'teardownTime': 'Teardown Time',
      'reservationStartMinutes': 'Reservation Start Time',
      'reservationEndMinutes': 'Reservation End Time',
      'reservationStartTime': 'Reservation Start Time',
      'reservationEndTime': 'Reservation End Time',
      'doorOpenTime': 'Door Open Time',
      'doorCloseTime': 'Door Close Time'
    };
    return fieldMap[fieldName] || fieldName;
  };

  const formatValue = (value) => {
    if (value === null || value === undefined) return 'None';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'string' && (value.includes('T') || value.includes('Z'))) {
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
    return <LoadingSpinner minHeight={150} />;
  }

  if (error) {
    return (
      <div className="reservation-audit-history-error">
        <div className="error-icon">⚠️</div>
        <div>Failed to load reservation history: {error}</div>
        <button onClick={fetchAuditHistory} className="retry-button">
          🔄 Retry
        </button>
      </div>
    );
  }

  if (auditHistory.length === 0) {
    return (
      <div className="reservation-audit-history-empty">
        <div className="empty-icon">📝</div>
        <div>No history available</div>
        <div className="empty-subtitle">This reservation hasn't been modified since creation</div>
      </div>
    );
  }

  return (
    <div className="reservation-audit-history">
      <div className="audit-header">
        <h4>Reservation History ({auditHistory.length} entries)</h4>
        <div className="audit-legend">
          <span className="legend-item">
            <span className="legend-icon">➕</span> Created
          </span>
          <span className="legend-item">
            <span className="legend-icon">✏️</span> Updated
          </span>
          <span className="legend-item">
            <span className="legend-icon">✅</span> Approved
          </span>
          <span className="legend-item">
            <span className="legend-icon">❌</span> Rejected
          </span>
          <span className="legend-item">
            <span className="legend-icon">🔄</span> Resubmitted
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
                      <strong>{entry.changeType.charAt(0).toUpperCase() + entry.changeType.slice(1)}</strong>
                      {entry.source && (
                        <span className="audit-source">
                          {getSourceIcon(entry.source)} {entry.source}
                        </span>
                      )}
                    </div>
                    <div className="audit-entry-meta">
                      <span className="audit-user">{entry.userEmail}</span>
                      <span className="audit-time">{dateStr} at {timeStr}</span>
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

              {entry.metadata?.notes && (
                <div className="audit-notes">
                  <strong>Notes:</strong> {entry.metadata.notes}
                </div>
              )}

              {entry.metadata?.userMessage && (
                <div className="audit-message">
                  <strong>Message:</strong> {entry.metadata.userMessage}
                </div>
              )}

              {entry.metadata?.previousRevision && (
                <div className="audit-revision">
                  <strong>Revision:</strong> {entry.metadata.previousRevision} → {entry.metadata.newRevision}
                </div>
              )}

              {isExpanded && hasDetails && (
                <div className="audit-details">
                  <div className="details-header">Changes made:</div>
                  {renderChangeSet(entry.changeSet)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ReservationAuditHistory;
