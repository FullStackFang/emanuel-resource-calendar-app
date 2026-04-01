import React, { useState, useEffect } from 'react';
import LoadingSpinner from './shared/LoadingSpinner';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';
import './EventAuditHistory.css';

/* =========================================================================
   SVG Icon Components — consistent with AttachmentsSection pattern
   ========================================================================= */

const Icon = ({ children, size = 20, className = '', ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`ah-icon ${className}`}
    {...props}
  >
    {children}
  </svg>
);

const IconPlus = (props) => (
  <Icon {...props}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </Icon>
);

const IconEdit = (props) => (
  <Icon {...props}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </Icon>
);

const IconTrash = (props) => (
  <Icon {...props}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Icon>
);

const IconDownloadCloud = (props) => (
  <Icon {...props}>
    <polyline points="8 17 12 21 16 17" />
    <line x1="12" y1="12" x2="12" y2="21" />
    <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" />
  </Icon>
);

const IconFileText = (props) => (
  <Icon {...props}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </Icon>
);

const IconClock = (props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </Icon>
);

const IconChevronRight = (props) => (
  <Icon {...props}>
    <polyline points="9 18 15 12 9 6" />
  </Icon>
);

const IconChevronDown = (props) => (
  <Icon {...props}>
    <polyline points="6 9 12 15 18 9" />
  </Icon>
);

const IconAlertTriangle = (props) => (
  <Icon {...props}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </Icon>
);

const IconRefreshCw = (props) => (
  <Icon {...props}>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </Icon>
);

const IconBarChart = (props) => (
  <Icon {...props}>
    <line x1="12" y1="20" x2="12" y2="10" />
    <line x1="18" y1="20" x2="18" y2="4" />
    <line x1="6" y1="20" x2="6" y2="16" />
  </Icon>
);

const IconArrowRight = (props) => (
  <Icon {...props}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </Icon>
);

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
      case 'create': return IconPlus;
      case 'update': return IconEdit;
      case 'delete': return IconTrash;
      case 'import': return IconDownloadCloud;
      default: return IconFileText;
    }
  };

  const getChangeTypeColor = (changeType) => {
    switch (changeType) {
      case 'create': return 'create';
      case 'update': return 'update';
      case 'delete': return 'delete';
      case 'import': return 'import';
      default: return 'update';
    }
  };

  const getSourceIcon = (source) => {
    if (source?.includes('Resource Scheduler')) return IconBarChart;
    if (source?.includes('Import')) return IconDownloadCloud;
    if (source?.includes('Manual')) return IconEdit;
    return IconFileText;
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
      'calendarData.categories': 'Categories',
      'calendarData.assignedTo': 'Assigned To',
      'calendarData.eventNotes': 'Notes',
      'calendarData.rsId': 'Resource Scheduler ID',
      'calendarData.rsEventCode': 'Event Code',
      'calendarData.requesterName': 'Requester Name',
      'calendarData.requesterEmail': 'Requester Email',
      // Legacy field paths (for old audit history entries)
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
      <div className="ah-change-set">
        {changeSet.map((change, index) => (
          <div key={index} className="ah-change-item">
            <div className="ah-change-field">{formatFieldName(change.field)}</div>
            <div className="ah-change-values">
              <div className="ah-old-value">
                <span className="ah-value-label">From</span>
                <span className="ah-value">{formatValue(change.oldValue)}</span>
              </div>
              <div className="ah-value-arrow">
                <IconArrowRight size={14} />
              </div>
              <div className="ah-new-value">
                <span className="ah-value-label">To</span>
                <span className="ah-value">{formatValue(change.newValue)}</span>
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
      <div className="ah-state ah-state--error">
        <div className="ah-state-icon ah-state-icon--error">
          <IconAlertTriangle size={28} />
        </div>
        <div className="ah-state-text">Failed to load event history</div>
        <div className="ah-state-sub">{error}</div>
        <button onClick={fetchAuditHistory} className="ah-retry-btn">
          <IconRefreshCw size={14} />
          Retry
        </button>
      </div>
    );
  }

  if (auditHistory.length === 0) {
    return (
      <div className="ah-state ah-state--empty">
        <div className="ah-state-icon">
          <IconClock size={28} />
        </div>
        <div className="ah-state-text">No history available</div>
        <div className="ah-state-sub">This event hasn&apos;t been modified since creation</div>
      </div>
    );
  }

  return (
    <div className="ah-section">
      <div className="ah-header">
        <div className="ah-header-left">
          <IconClock size={14} />
          <span>Event History ({auditHistory.length})</span>
        </div>
        <div className="ah-legend">
          <span className="ah-legend-item">
            <span className="ah-legend-dot ah-legend-dot--create" />
            Created
          </span>
          <span className="ah-legend-item">
            <span className="ah-legend-dot ah-legend-dot--update" />
            Updated
          </span>
          <span className="ah-legend-item">
            <span className="ah-legend-dot ah-legend-dot--import" />
            Imported
          </span>
        </div>
      </div>

      <div className="ah-timeline">
        {auditHistory.map((entry, index) => {
          const { dateStr, timeStr } = formatTimestamp(entry.timestamp);
          const isExpanded = expandedEntries.has(index);
          const hasDetails = entry.changeSet && entry.changeSet.length > 0;
          const TypeIcon = getChangeTypeIcon(entry.changeType);
          const colorVariant = getChangeTypeColor(entry.changeType);
          const SourceIcon = getSourceIcon(entry.source);

          return (
            <div
              key={index}
              className={`ah-entry ${hasDetails ? 'ah-entry--expandable' : ''}`}
              style={{ '--ah-entry-index': index }}
            >
              <div
                className="ah-entry-header"
                onClick={hasDetails ? () => toggleExpanded(index) : undefined}
              >
                <div className="ah-entry-left">
                  <div className={`ah-type-icon ah-type-icon--${colorVariant}`}>
                    <TypeIcon size={14} />
                  </div>
                  <div className="ah-entry-info">
                    <div className="ah-entry-action">
                      <span className="ah-action-label">
                        {entry.changeType ? (entry.changeType.charAt(0).toUpperCase() + entry.changeType.slice(1)) : (entry.action || 'Update')}
                      </span>
                      {entry.source && (
                        <span className="ah-source-badge">
                          <SourceIcon size={12} />
                          {entry.source}
                        </span>
                      )}
                    </div>
                    <div className="ah-entry-time">
                      {dateStr} at {timeStr}
                    </div>
                  </div>
                </div>

                {hasDetails && (
                  <button
                    className={`ah-expand-btn ${isExpanded ? 'ah-expand-btn--open' : ''}`}
                    onClick={(e) => { e.stopPropagation(); toggleExpanded(index); }}
                    title={isExpanded ? 'Hide details' : 'Show details'}
                  >
                    {isExpanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                  </button>
                )}
              </div>

              {entry.metadata?.reason && (
                <div className="ah-meta-note ah-meta-note--reason">
                  <strong>Reason:</strong> {entry.metadata.reason}
                </div>
              )}

              {entry.metadata?.importSessionId && (
                <div className="ah-meta-note ah-meta-note--session">
                  <strong>Import Session:</strong> {entry.metadata.importSessionId}
                </div>
              )}

              {isExpanded && hasDetails && (
                <div className="ah-details">
                  <div className="ah-details-label">Changes made:</div>
                  {renderChangeSet(entry.changeSet)}
                </div>
              )}

              {entry.changes && (
                <div className="ah-single-change">
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
