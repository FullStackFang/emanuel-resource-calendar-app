// src/components/CommunicationHistory.jsx
import React from 'react';
import './CommunicationHistory.css';

export default function CommunicationHistory({ reservation, isAdmin = false }) {
  if (!reservation?.communicationHistory || reservation.communicationHistory.length === 0) {
    return (
      <div className="communication-history">
        <h3>Communication History</h3>
        <div className="no-history">
          No communication history available for this reservation.
        </div>
      </div>
    );
  }

  const formatDateTime = (date) => {
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const getEntryIcon = (type) => {
    switch (type) {
      case 'submission': return '📝';
      case 'resubmission': return '🔄';
      case 'approval': return '✅';
      case 'rejection': return '❌';
      case 'admin_note': return '💬';
      case 'user_response': return '💭';
      default: return '📋';
    }
  };

  const getEntryTypeLabel = (type) => {
    switch (type) {
      case 'submission': return 'Initial Submission';
      case 'resubmission': return 'Resubmission';
      case 'approval': return 'Approved';
      case 'rejection': return 'Rejected';
      case 'admin_note': return 'Admin Note';
      case 'user_response': return 'User Response';
      default: return 'Activity';
    }
  };

  const hasDataSnapshot = (entry) => {
    return entry.snapshot && Object.keys(entry.snapshot).length > 0;
  };

  const getChangedFields = (currentSnapshot, previousSnapshot) => {
    if (!currentSnapshot || !previousSnapshot) return [];
    
    const changes = [];
    const fieldsToCheck = [
      'eventTitle', 'eventDescription', 'startDateTime', 'endDateTime',
      'attendeeCount', 'requestedRooms', 'specialRequirements',
      'department', 'phone', 'contactEmail'
    ];

    fieldsToCheck.forEach(field => {
      const current = currentSnapshot[field];
      const previous = previousSnapshot[field];
      
      if (JSON.stringify(current) !== JSON.stringify(previous)) {
        changes.push({
          field,
          from: previous,
          to: current
        });
      }
    });

    return changes;
  };

  const formatFieldValue = (field, value) => {
    if (value === null || value === undefined || value === '') return 'Not specified';
    
    switch (field) {
      case 'startDateTime':
      case 'endDateTime':
        return formatDateTime(value);
      case 'requestedRooms':
        return Array.isArray(value) ? `${value.length} room(s)` : value;
      case 'attendeeCount':
        return value ? `${value} attendees` : 'Not specified';
      default:
        return Array.isArray(value) ? value.join(', ') : value.toString();
    }
  };

  const getFieldLabel = (field) => {
    switch (field) {
      case 'eventTitle': return 'Event Title';
      case 'eventDescription': return 'Description';
      case 'startDateTime': return 'Start Time';
      case 'endDateTime': return 'End Time';
      case 'attendeeCount': return 'Attendees';
      case 'requestedRooms': return 'Requested Rooms';
      case 'specialRequirements': return 'Special Requirements';
      case 'department': return 'Department';
      case 'phone': return 'Phone';
      case 'contactEmail': return 'Contact Email';
      default: return field;
    }
  };

  // Sort entries by timestamp (oldest first for chronological order)
  const sortedEntries = [...reservation.communicationHistory].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );

  return (
    <div className="communication-history">
      <h3>Communication History</h3>
      <div className="revision-summary">
        Revision {reservation.currentRevision || 1} of {sortedEntries.filter(e => 
          e.type === 'submission' || e.type === 'resubmission'
        ).length}
      </div>
      
      <div className="timeline">
        {sortedEntries.map((entry, index) => {
          const previousEntry = index > 0 ? sortedEntries[index - 1] : null;
          const changes = hasDataSnapshot(entry) && previousEntry && hasDataSnapshot(previousEntry)
            ? getChangedFields(entry.snapshot, previousEntry.snapshot)
            : [];

          return (
            <div key={index} className={`timeline-entry ${entry.type}`}>
              <div className="timeline-marker">
                <span className="entry-icon">{getEntryIcon(entry.type)}</span>
              </div>
              
              <div className="timeline-content">
                <div className="entry-header">
                  <div className="entry-info">
                    <span className="entry-type">{getEntryTypeLabel(entry.type)}</span>
                    <span className="entry-author">
                      by {entry.authorName || entry.author || 'System'}
                    </span>
                  </div>
                  <div className="entry-timestamp">
                    {formatDateTime(entry.timestamp)}
                  </div>
                </div>

                {entry.message && (
                  <div className="entry-message">
                    {entry.message}
                  </div>
                )}

                {entry.revisionNumber && (
                  <div className="revision-info">
                    <span className="revision-badge">Revision {entry.revisionNumber}</span>
                  </div>
                )}

                {/* Show changes for resubmissions */}
                {entry.type === 'resubmission' && changes.length > 0 && (
                  <div className="changes-summary">
                    <h4>Changes Made:</h4>
                    <div className="changes-list">
                      {changes.map((change, changeIndex) => (
                        <div key={changeIndex} className="change-item">
                          <span className="field-label">{getFieldLabel(change.field)}:</span>
                          <div className="change-values">
                            <div className="old-value">
                              <span className="label">From:</span> {formatFieldValue(change.field, change.from)}
                            </div>
                            <div className="new-value">
                              <span className="label">To:</span> {formatFieldValue(change.field, change.to)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Show data snapshot for admin view */}
                {isAdmin && hasDataSnapshot(entry) && entry.type === 'submission' && (
                  <details className="data-snapshot">
                    <summary>View Submission Data</summary>
                    <div className="snapshot-content">
                      <div className="snapshot-grid">
                        <div><strong>Event:</strong> {entry.snapshot.eventTitle}</div>
                        <div><strong>Date:</strong> {formatDateTime(entry.snapshot.startDateTime)} - {formatDateTime(entry.snapshot.endDateTime)}</div>
                        <div><strong>Attendees:</strong> {entry.snapshot.attendeeCount || 'Not specified'}</div>
                        {entry.snapshot.eventDescription && (
                          <div><strong>Description:</strong> {entry.snapshot.eventDescription}</div>
                        )}
                        {entry.snapshot.specialRequirements && (
                          <div><strong>Special Requirements:</strong> {entry.snapshot.specialRequirements}</div>
                        )}
                      </div>
                    </div>
                  </details>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}