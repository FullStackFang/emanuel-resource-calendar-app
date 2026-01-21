// src/components/EditRequestComparison.jsx
import React, { useState } from 'react';
import './EditRequestComparison.css';

/**
 * EditRequestComparison - Modal for admin review of edit requests
 * Shows original vs proposed changes in a comparison view
 */
export default function EditRequestComparison({
  editRequest,
  onClose,
  onApprove,
  onReject,
  rejectionReason,
  onRejectionReasonChange,
  isApproving,
  isRejecting
}) {
  const [approvalNotes, setApprovalNotes] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);

  const isPending = editRequest?.status === 'pending';

  // Format date for display
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

  // Get the original snapshot data
  const originalSnapshot = editRequest?.originalSnapshot || {};

  // Build comparison data
  const comparisonFields = [
    {
      label: 'Event Title',
      original: originalSnapshot.eventTitle || 'N/A',
      proposed: editRequest?.eventTitle || 'N/A',
      changed: originalSnapshot.eventTitle !== editRequest?.eventTitle
    },
    {
      label: 'Start Date/Time',
      original: formatDateTime(originalSnapshot.startDateTime),
      proposed: formatDateTime(editRequest?.startDateTime),
      changed: originalSnapshot.startDateTime !== editRequest?.startDateTime
    },
    {
      label: 'End Date/Time',
      original: formatDateTime(originalSnapshot.endDateTime),
      proposed: formatDateTime(editRequest?.endDateTime),
      changed: originalSnapshot.endDateTime !== editRequest?.endDateTime
    },
    {
      label: 'Location',
      original: originalSnapshot.locationDisplayNames || 'N/A',
      proposed: editRequest?.locationDisplayNames || 'N/A',
      changed: originalSnapshot.locationDisplayNames !== editRequest?.locationDisplayNames
    },
    {
      label: 'Attendee Count',
      original: originalSnapshot.attendeeCount?.toString() || 'N/A',
      proposed: editRequest?.attendeeCount?.toString() || 'N/A',
      changed: originalSnapshot.attendeeCount !== editRequest?.attendeeCount
    }
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
            </div>
          </div>

          {/* Change Reason Section */}
          <div className="change-reason-section">
            <h3>Reason for Changes</h3>
            <div className="reason-box">
              {editRequest?.changeReason || 'No reason provided'}
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

          {/* Approval/Rejection Forms (for pending requests) */}
          {isPending && (
            <div className="action-section">
              {showRejectForm ? (
                <div className="reject-form">
                  <h3>Reject Edit Request</h3>
                  <p>Please provide a reason for rejecting this edit request:</p>
                  <textarea
                    value={rejectionReason}
                    onChange={(e) => onRejectionReasonChange(e.target.value)}
                    placeholder="Enter rejection reason..."
                    rows={4}
                    required
                  />
                  <div className="reject-form-actions">
                    <button
                      className="cancel-reject-btn"
                      onClick={() => {
                        setShowRejectForm(false);
                        onRejectionReasonChange('');
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="confirm-reject-btn"
                      onClick={handleReject}
                      disabled={isRejecting || !rejectionReason.trim()}
                    >
                      {isRejecting ? 'Rejecting...' : 'Confirm Reject'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="approve-form">
                  <h3>Approval Notes (Optional)</h3>
                  <textarea
                    value={approvalNotes}
                    onChange={(e) => setApprovalNotes(e.target.value)}
                    placeholder="Add notes for the requester (optional)..."
                    rows={3}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="edit-request-comparison-footer">
          {isPending && !showRejectForm && (
            <>
              <button
                className="reject-btn"
                onClick={() => setShowRejectForm(true)}
              >
                Reject
              </button>
              <button
                className="approve-btn"
                onClick={handleApprove}
                disabled={isApproving}
              >
                {isApproving ? 'Approving...' : 'Approve & Apply Changes'}
              </button>
            </>
          )}
          {!isPending && (
            <button className="close-footer-btn" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
