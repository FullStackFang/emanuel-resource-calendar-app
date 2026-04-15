// src/components/EditRequestComparison.jsx
import React, { useState } from 'react';
import './EditRequestComparison.css';
import './shared/ReviewModal.css';

/**
 * EditRequestComparison - Modal for admin review of edit requests
 * Shows original vs proposed changes in a comparison view
 */
export default function EditRequestComparison({
  editRequest,
  eventCalendarData,
  eventRoomReservationData,
  onClose,
  onApprove,
  onReject,
  rejectionReason,
  onRejectionReasonChange,
  isApproving,
  isRejecting
}) {
  const [approvalNotes, setApprovalNotes] = useState('');
  const [isRejectConfirming, setIsRejectConfirming] = useState(false);

  const isPending = editRequest?.status === 'pending';

  // Format date+time for display
  const formatDateTime = (dateStr) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  // Format HH:MM time string for display
  const formatTime = (timeStr) => {
    if (!timeStr) return 'N/A';
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours, 10);
    if (isNaN(hour)) return timeStr;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  // Format array for display
  const formatArray = (arr) => {
    if (!arr || !Array.isArray(arr) || arr.length === 0) return 'N/A';
    return arr.join(', ');
  };

  // Check if arrays differ (order-insensitive)
  const arraysDiffer = (a, b) => {
    const arrA = Array.isArray(a) ? a.map(String).sort() : [];
    const arrB = Array.isArray(b) ? b.map(String).sort() : [];
    return JSON.stringify(arrA) !== JSON.stringify(arrB);
  };

  // Original values come from calendarData (the event's unmodified state)
  const cd = eventCalendarData || {};
  // Proposed changes from the edit request (only fields that changed)
  const proposed = editRequest?.proposedChanges || {};

  // Helper: simple field comparison entry (optional originalOverride for fields outside calendarData)
  const simpleField = (label, field, formatter, originalOverride) => {
    const fmt = formatter || ((v) => v?.toString() || 'N/A');
    const original = originalOverride !== undefined ? originalOverride : cd[field];
    return {
      label,
      original: fmt(original),
      proposed: fmt(proposed[field] !== undefined ? proposed[field] : original),
      changed: proposed[field] !== undefined && proposed[field] !== (original ?? '')
    };
  };

  // Build comparison data: original from calendarData, proposed from proposedChanges
  // Covers all fields the backend tracks in fieldsToCompare + rooms/categories/services
  const comparisonFields = [
    simpleField('Event Title', 'eventTitle'),
    simpleField('Description', 'eventDescription'),
    {
      label: 'Start Date/Time',
      original: formatDateTime(cd.startDateTime),
      proposed: formatDateTime(proposed.startDateTime || cd.startDateTime),
      changed: proposed.startDateTime !== undefined && proposed.startDateTime !== cd.startDateTime
    },
    {
      label: 'End Date/Time',
      original: formatDateTime(cd.endDateTime),
      proposed: formatDateTime(proposed.endDateTime || cd.endDateTime),
      changed: proposed.endDateTime !== undefined && proposed.endDateTime !== cd.endDateTime
    },
    {
      label: 'Location',
      original: cd.locationDisplayNames || 'N/A',
      proposed: proposed.locationDisplayNames || cd.locationDisplayNames || 'N/A',
      changed: proposed.locationDisplayNames !== undefined && proposed.locationDisplayNames !== cd.locationDisplayNames
    },
    {
      label: 'Attendee Count',
      original: cd.attendeeCount?.toString() || 'N/A',
      proposed: (proposed.attendeeCount ?? cd.attendeeCount)?.toString() || 'N/A',
      changed: proposed.attendeeCount !== undefined && proposed.attendeeCount !== cd.attendeeCount
    },
    {
      label: 'Categories',
      original: formatArray(cd.categories),
      proposed: formatArray(proposed.categories || cd.categories),
      changed: proposed.categories !== undefined && arraysDiffer(proposed.categories, cd.categories)
    },
    simpleField('Reservation Start Time', 'reservationStartTime', formatTime),
    simpleField('Reservation End Time', 'reservationEndTime', formatTime),
    simpleField('Setup Time', 'setupTime', formatTime),
    simpleField('Teardown Time', 'teardownTime', formatTime),
    simpleField('Door Open Time', 'doorOpenTime', formatTime),
    simpleField('Door Close Time', 'doorCloseTime', formatTime),
    simpleField('Setup Notes', 'setupNotes'),
    simpleField('Door Notes', 'doorNotes'),
    simpleField('Event Notes', 'eventNotes'),
    simpleField('Special Requirements', 'specialRequirements'),
    simpleField('Offsite', 'isOffsite', (v) => v ? 'Yes' : 'No'),
    simpleField('Offsite Name', 'offsiteName'),
    simpleField('Offsite Address', 'offsiteAddress'),
    simpleField('Organizer Name', 'organizerName'),
    simpleField('Organizer Phone', 'organizerPhone'),
    simpleField('Organizer Email', 'organizerEmail'),
  ];

  // Filter to only show changed fields in the "Changes" section
  const changedFields = comparisonFields.filter(f => f.changed);

  const handleApprove = () => {
    onApprove(approvalNotes);
  };

  const handleReject = () => {
    onReject();
  };

  return (
    <div className="edit-request-comparison-overlay">
      <div className="edit-request-comparison-modal">
        {/* Header */}
        <div className="edit-request-comparison-header">
          <div className="header-content">
            <h2>Edit Request Review</h2>
            <span className={`status-badge ${editRequest?.status === 'pending' ? 'status-pending' : editRequest?.status === 'approved' ? 'status-approved' : 'status-rejected'}`}>
              {editRequest?.status?.toUpperCase()}
            </span>
          </div>
          <button className="close-btn" onClick={onClose} type="button">&times;</button>
        </div>

        <div className="edit-request-comparison-body">
          {/* Request Info Section */}
          <div className="request-info-section">
            <h3>Request Information</h3>
            <div className="info-grid">
              <div className="info-item">
                <label>Event:</label>
                <span>{editRequest?.eventTitle}</span>
              </div>
              <div className="info-item">
                <label>Submitted By:</label>
                <span>{editRequest?.requesterName} ({editRequest?.requesterEmail})</span>
              </div>
              <div className="info-item">
                <label>Submitted At:</label>
                <span>{formatDateTime(editRequest?.submittedAt)}</span>
              </div>
              {editRequest?.editScope === 'thisEvent' && editRequest?.occurrenceDate && (
                <div className="info-item">
                  <label>Scope:</label>
                  <span>
                    This occurrence only ({new Date(editRequest.occurrenceDate + 'T00:00:00').toLocaleDateString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
                    })})
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Proposed Changes Comparison */}
          <div className="comparison-section">
            <h3>Proposed Changes</h3>
            {changedFields.length > 0 ? (
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Original Value</th>
                    <th>Proposed Value</th>
                  </tr>
                </thead>
                <tbody>
                  {changedFields.map((field, idx) => (
                    <tr key={idx} className="changed-row">
                      <td className="field-name">{field.label}</td>
                      <td className="original-value">{field.original}</td>
                      <td className="proposed-value">{field.proposed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="no-changes-message">No specific field changes detected. This may be a general update request.</p>
            )}
          </div>

          {/* All Fields Overview (collapsible) */}
          <details className="all-fields-section">
            <summary>View All Fields</summary>
            <table className="comparison-table all-fields-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Original</th>
                  <th>Proposed</th>
                </tr>
              </thead>
              <tbody>
                {comparisonFields.map((field, idx) => (
                  <tr key={idx} className={field.changed ? 'changed-row' : ''}>
                    <td className="field-name">{field.label}</td>
                    <td className="original-value">{field.original}</td>
                    <td className="proposed-value">{field.proposed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

          {/* Review Notes (if already reviewed) */}
          {editRequest?.reviewNotes && !isPending && (
            <div className="review-notes-section">
              <h3>{editRequest?.status === 'approved' ? 'Approval Notes' : 'Rejection Reason'}</h3>
              <div className="notes-box">
                {editRequest.reviewNotes}
              </div>
            </div>
          )}

          {/* Approval Notes (for pending requests) */}
          {isPending && (
            <div className="action-section">
              <div className="approve-form">
                <h3>Approval Notes (Optional)</h3>
                <textarea
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  placeholder="Add notes for the requester (optional)..."
                  rows={3}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="edit-request-comparison-footer">
          {isPending && (
            <>
              <div className="confirm-button-group">
                {isRejectConfirming && (
                  <input
                    type="text"
                    className="inline-reason-input"
                    placeholder="Why are you rejecting this edit?"
                    value={rejectionReason}
                    onChange={(e) => onRejectionReasonChange(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && rejectionReason?.trim()) handleReject(); }}
                    disabled={isRejecting}
                    autoFocus
                  />
                )}
                <button
                  className={`action-btn reject-btn ${isRejectConfirming ? 'confirming' : ''}`}
                  type="button"
                  onClick={() => {
                    if (isRejectConfirming) {
                      handleReject();
                    } else {
                      setIsRejectConfirming(true);
                    }
                  }}
                  disabled={isRejecting || (isRejectConfirming && !rejectionReason?.trim())}
                >
                  {isRejecting ? 'Rejecting...' : (isRejectConfirming ? 'Confirm Reject?' : 'Reject')}
                </button>
                {isRejectConfirming && (
                  <button
                    type="button"
                    className="confirm-cancel-x reject-cancel-x"
                    onClick={() => {
                      setIsRejectConfirming(false);
                      onRejectionReasonChange('');
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
              <button
                className="action-btn publish-btn"
                type="button"
                onClick={handleApprove}
                disabled={isApproving || isRejectConfirming}
              >
                {isApproving ? 'Approving...' : 'Approve & Apply Changes'}
              </button>
            </>
          )}
          {!isPending && (
            <button className="action-btn cancel-btn" type="button" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
