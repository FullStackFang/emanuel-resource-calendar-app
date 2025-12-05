// src/components/shared/ReviewModal.jsx
import React, { useEffect, useCallback, useState } from 'react';
import './ReviewModal.css';

/**
 * ReviewModal - Reusable modal wrapper for reviewing/editing events and reservations
 *
 * Provides a full-screen modal with:
 * - Sticky action bar at top with approve/reject/save/delete/cancel buttons
 * - Tabbed interface for organizing content
 * - Scrollable content area
 * - ESC key and overlay click to close
 * - Feature toggle between legacy and unified forms
 * - Support for both 'review' mode (approve/reject pending items) and 'edit' mode (edit any event)
 */
export default function ReviewModal({
  isOpen,
  title = 'Review Request',
  onClose,
  onApprove,
  onReject,
  onSave,
  onDelete,
  children,
  // State flags
  isPending = true,
  hasChanges = false,
  isFormValid = true,  // Default to true for backwards compatibility
  isSaving = false,
  isDeleting = false,
  isApproving = false,
  isNavigating = false,
  // Mode: 'review' (for pending reservations) or 'edit' (for editing any event)
  mode = 'review',
  // Feature flags
  useUnifiedForm = false,
  onToggleForm = null,
  // Additional actions
  showFormToggle = false,
  showActionButtons = true,
  // Tab configuration
  showTabs = true,
  attachmentCount = 0,
  historyCount = 0,
  // Styling
  modalClassName = 'review-modal',
  overlayClassName = 'review-modal-overlay',
  // Button text customization
  saveButtonText = null,
  deleteButtonText = null,
  approveButtonText = null,
  // Admin access
  isAdmin = false,
  // Requester-only mode (can view but not edit/approve)
  isRequesterOnly = false,
  // Current item status for status badge display
  itemStatus = null,
  // Confirmation states for inline confirmation buttons
  isDeleteConfirming = false,
  onCancelDelete = null,
  isSaveConfirming = false,
  onCancelSave = null,
  isApproveConfirming = false,
  onCancelApprove = null,
  isRejectConfirming = false,
  onCancelReject = null
}) {
  // Helper to get status class for badge
  const getStatusClass = (status) => {
    switch (status) {
      case 'pending': return 'status-pending';
      case 'approved': return 'status-approved';
      case 'rejected': return 'status-rejected';
      case 'cancelled': return 'status-cancelled';
      default: return '';
    }
  };

  // Helper to format status text
  const formatStatus = (status) => {
    if (!status) return 'Unknown';
    return status.charAt(0).toUpperCase() + status.slice(1);
  };
  // Tab state
  const [activeTab, setActiveTab] = useState('details');
  // Close on ESC key
  const handleEscKey = useCallback((e) => {
    if (e.key === 'Escape' && isOpen) {
      onClose();
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscKey);
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleEscKey]);

  // Close on overlay click
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  // Only apply inline styles for the default review-modal, not for custom modals
  const inlineStyles = modalClassName === 'review-modal'
    ? { maxWidth: '100vw', display: 'flex', flexDirection: 'column', maxHeight: '100vh' }
    : { display: 'flex', flexDirection: 'column' };

  return (
    <div className={overlayClassName} onClick={handleOverlayClick}>
      <div className={modalClassName} style={inlineStyles}>
        {/* Sticky Action Bar */}
        <div className="review-action-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
              {title}
            </h2>

            {/* Feature Flag Toggle */}
            {showFormToggle && onToggleForm && (
              <button
                type="button"
                onClick={onToggleForm}
                style={{
                  padding: '6px 12px',
                  fontSize: '0.75rem',
                  borderRadius: '4px',
                  border: '1px solid #d1d5db',
                  background: useUnifiedForm ? '#0078d4' : '#f3f4f6',
                  color: useUnifiedForm ? 'white' : '#374151',
                  cursor: 'pointer',
                  fontWeight: '500',
                  transition: 'all 0.2s'
                }}
                title={useUnifiedForm ? 'Switch to Legacy Form' : 'Switch to New Unified Form'}
              >
                {useUnifiedForm ? '✨ New Form' : '📋 Legacy Form'}
              </button>
            )}
          </div>

          {/* Action Buttons */}
          {showActionButtons && (
            <div className="review-actions">
              {/* Status badge for requesters (view-only mode) */}
              {isRequesterOnly && itemStatus && (
                <span className={`status-badge-action ${getStatusClass(itemStatus)}`}>
                  Status: {formatStatus(itemStatus)}
                </span>
              )}

              {/* Approve button - only in review mode for pending items (not for requesters) */}
              {!isRequesterOnly && mode === 'review' && isPending && onApprove && (
                <div className="confirm-button-group">
                  <button
                    type="button"
                    className={`action-btn approve-btn ${isApproveConfirming ? 'confirming' : ''}`}
                    onClick={onApprove}
                    disabled={isApproving}
                  >
                    {isApproving ? 'Approving...' : (isApproveConfirming ? (approveButtonText || '⚠️ Confirm Approve?') : '✓ Approve')}
                  </button>
                  {isApproveConfirming && onCancelApprove && (
                    <button
                      type="button"
                      className="confirm-cancel-x approve-cancel-x"
                      onClick={onCancelApprove}
                      title="Cancel approve"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}

              {/* Reject button - only in review mode for pending items (not for requesters) */}
              {!isRequesterOnly && mode === 'review' && isPending && onReject && (
                <div className="confirm-button-group">
                  <button
                    type="button"
                    className={`action-btn reject-btn ${isRejectConfirming ? 'confirming' : ''}`}
                    onClick={onReject}
                  >
                    {isRejectConfirming ? '⚠️ Confirm Reject?' : '✗ Reject'}
                  </button>
                  {isRejectConfirming && onCancelReject && (
                    <button
                      type="button"
                      className="confirm-cancel-x reject-cancel-x"
                      onClick={onCancelReject}
                      title="Cancel reject"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}

              {/* Delete button in review mode - only for admins (not approvers or requesters) */}
              {!isRequesterOnly && mode === 'review' && isAdmin && onDelete && (
                <div className="confirm-button-group">
                  <button
                    type="button"
                    className={`action-btn delete-btn ${isDeleteConfirming ? 'confirming' : ''}`}
                    onClick={onDelete}
                    disabled={isDeleting}
                    title="Permanently delete this reservation (Admin only)"
                  >
                    {isDeleting ? 'Deleting...' : (deleteButtonText || '🗑️ Delete')}
                  </button>
                  {isDeleteConfirming && onCancelDelete && (
                    <button
                      type="button"
                      className="confirm-cancel-x delete-cancel-x"
                      onClick={onCancelDelete}
                      title="Cancel delete"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}

              {/* Submit button - only in create mode (for requesters submitting reservation requests) */}
              {mode === 'create' && onSave && (
                <div className="confirm-button-group">
                  <button
                    type="button"
                    className={`action-btn approve-btn ${isSaveConfirming ? 'confirming' : ''}`}
                    onClick={onSave}
                    disabled={!hasChanges || !isFormValid || isSaving}
                    title={!hasChanges ? 'Fill out the form to submit' : (!isFormValid ? 'Please fill all required fields' : '')}
                  >
                    {isSaving ? 'Submitting...' : (isSaveConfirming ? (saveButtonText || '⚠️ Confirm Submit?') : '📝 Submit Request')}
                  </button>
                  {isSaveConfirming && onCancelSave && (
                    <button
                      type="button"
                      className="confirm-cancel-x submit-cancel-x"
                      onClick={onCancelSave}
                      title="Cancel submit"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}

              {/* Save button - available in edit mode OR review mode with pending items (not for requesters) */}
              {!isRequesterOnly && onSave && (mode === 'edit' || (mode === 'review' && isPending)) && (
                <div className="confirm-button-group">
                  <button
                    type="button"
                    className={`action-btn save-btn ${isSaveConfirming ? 'confirming' : ''}`}
                    onClick={onSave}
                    disabled={!hasChanges || !isFormValid || isSaving}
                    title={!hasChanges ? 'No changes to save' : (!isFormValid ? 'Please fill all required fields' : '')}
                  >
                    {isSaving ? 'Saving...' : (isSaveConfirming ? '⚠️ Confirm Save?' : (saveButtonText || '💾 Save'))}
                  </button>
                  {isSaveConfirming && onCancelSave && (
                    <button
                      type="button"
                      className="confirm-cancel-x save-cancel-x"
                      onClick={onCancelSave}
                      title="Cancel save"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}

              {/* Delete button - only in edit mode (NOT create mode, not for requesters) */}
              {!isRequesterOnly && mode === 'edit' && onDelete && (
                <div className="confirm-button-group">
                  <button
                    type="button"
                    className={`action-btn delete-btn ${isDeleteConfirming ? 'confirming' : ''}`}
                    onClick={onDelete}
                    disabled={isDeleting}
                    title="Delete this event"
                  >
                    {isDeleting ? 'Deleting...' : (deleteButtonText || '🗑️ Delete')}
                  </button>
                  {isDeleteConfirming && onCancelDelete && (
                    <button
                      type="button"
                      className="confirm-cancel-x delete-cancel-x"
                      onClick={onCancelDelete}
                      title="Cancel delete"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}

              <button
                type="button"
                className="action-btn cancel-btn"
                onClick={onClose}
              >
                {isRequesterOnly ? 'Close' : (mode === 'create' || (mode === 'review' && isPending) ? 'Cancel' : 'Close')}
              </button>
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        {showTabs && (
          <div className="event-type-tabs">
            <div
              className={`event-type-tab ${activeTab === 'details' ? 'active' : ''}`}
              onClick={() => setActiveTab('details')}
            >
              Event Details
            </div>
            <div
              className={`event-type-tab ${activeTab === 'additional' ? 'active' : ''}`}
              onClick={() => setActiveTab('additional')}
            >
              Additional Info
            </div>
            <div
              className={`event-type-tab ${activeTab === 'attachments' ? 'active' : ''}`}
              onClick={() => setActiveTab('attachments')}
            >
              {attachmentCount > 0 ? `Attachments (${attachmentCount})` : 'Attachments'}
            </div>
            <div
              className={`event-type-tab ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              {historyCount > 0 ? `History (${historyCount})` : 'History'}
            </div>
            {isAdmin && (
              <div
                className={`event-type-tab ${activeTab === 'admin' ? 'active' : ''}`}
                onClick={() => setActiveTab('admin')}
              >
                Admin
              </div>
            )}
          </div>
        )}

        {/* Content Area */}
        <div style={{ flex: 1, position: 'relative' }}>
          {React.isValidElement(children)
            ? React.cloneElement(children, { activeTab })
            : children}

          {/* Loading Overlay for Series Navigation */}
          {isNavigating && (
            <div className="navigation-loading-overlay">
              <div className="navigation-loading-spinner">
                <div className="spinner"></div>
                <div className="loading-text">Loading event...</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
