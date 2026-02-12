// src/components/shared/ReviewModal.jsx
import React, { useEffect, useCallback, useState } from 'react';
import { usePermissions } from '../../hooks/usePermissions';
import LoadingSpinner from './LoadingSpinner';
import DraftSaveDialog from './DraftSaveDialog';
import './ReviewModal.css';

/**
 * ReviewModal - Reusable modal wrapper for reviewing/editing events and reservations
 *
 * Provides a full-screen modal with:
 * - Sticky action bar at top with publish/reject/save/delete/cancel buttons
 * - Tabbed interface for organizing content
 * - Scrollable content area
 * - ESC key and overlay click to close
 * - Feature toggle between legacy and unified forms
 * - Support for both 'review' mode (publish/reject pending items) and 'edit' mode (edit any event)
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
  // Requester-only mode (can view but not edit/publish)
  isRequesterOnly = false,
  // Current item status for status badge display
  itemStatus = null,
  // Current document version (for debugging/testing concurrency)
  eventVersion = null,
  // Confirmation states for inline confirmation buttons
  isDeleteConfirming = false,
  onCancelDelete = null,
  isSaveConfirming = false,
  onCancelSave = null,
  isApproveConfirming = false,
  onCancelApprove = null,
  isRejectConfirming = false,
  onCancelReject = null,
  isRejecting = false,
  rejectionReason = '',
  onRejectionReasonChange = null,
  // Draft-related props
  isDraft = false,
  onSaveDraft = null,
  onSubmitDraft = null,
  savingDraft = false,
  isDraftConfirming = false,
  onCancelDraft = null,
  showDraftDialog = false,
  onDraftDialogSave = null,
  onDraftDialogDiscard = null,
  onDraftDialogCancel = null,
  canSaveDraft = true,
  // Edit request props (for requesters to request changes to published events)
  onRequestEdit = null,
  canRequestEdit = false,
  // Existing edit request props (for viewing pending edit requests)
  existingEditRequest = null,
  isViewingEditRequest = false,
  loadingEditRequest = false,
  onViewEditRequest = null,
  onViewOriginalEvent = null,
  // Edit request mode props (when actively editing to create an edit request)
  isEditRequestMode = false,
  editRequestChangeReason = '',
  onEditRequestChangeReasonChange = null,
  onSubmitEditRequest = null,
  onCancelEditRequest = null,
  isSubmittingEditRequest = false,
  isEditRequestConfirming = false,
  onCancelEditRequestConfirm = null,
  originalData = null,
  detectedChanges = [], // Array of { field, label, oldValue, newValue }
  // Edit request approval/rejection props (for admins reviewing edit requests)
  onApproveEditRequest = null,
  onRejectEditRequest = null,
  isApprovingEditRequest = false,
  isRejectingEditRequest = false,
  editRequestRejectionReason = '',
  onEditRequestRejectionReasonChange = null,
  isEditRequestApproveConfirming = false,
  isEditRequestRejectConfirming = false,
  onCancelEditRequestApprove = null,
  onCancelEditRequestReject = null,
  // Cancel edit request props (for requesters canceling their own edit request)
  onCancelPendingEditRequest = null,
  isCancelingEditRequest = false,
  isCancelEditRequestConfirming = false,
  onCancelCancelEditRequest = null,
  // Pending edit props (for editing pending events directly)
  onSavePendingEdit = null,
  savingPendingEdit = false,
  showDiscardDialog = false,
  onDiscardDialogDiscard = null,
  onDiscardDialogCancel = null,
  // Edit request modal props (scale-80 modal for requesting edits on published events)
  onSubmitEditRequestModal = null,
  submittingEditRequestModal = false,
  // Scheduling conflict state (from SchedulingAssistant)
  hasSchedulingConflicts = false
}) {
  // Get admin status from permissions hook
  const { isAdmin, canApproveReservations } = usePermissions();

  // Helper to get status class for badge
  const getStatusClass = (status) => {
    switch (status) {
      case 'pending': return 'status-pending';
      case 'published': return 'status-published';
      case 'rejected': return 'status-rejected';
      case 'cancelled': return 'status-cancelled';
      case 'draft': return 'status-draft';
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
          <div className="action-bar-left">
            <h2 className="action-bar-title">{title}</h2>

            {/* Status badge - now on the left next to title */}
            {itemStatus && !isEditRequestMode && !isViewingEditRequest && (
              <span className={`status-pill ${getStatusClass(itemStatus)}`}>
                {formatStatus(itemStatus)}
              </span>
            )}

            {/* Version indicator (for concurrency testing) */}
            {eventVersion != null && (
              <span className="version-badge" title="Document version (for concurrency control)">
                v{eventVersion}
              </span>
            )}

            {/* Edit Request Mode badge - on left next to title */}
            {isEditRequestMode && (
              <span className="edit-request-mode-badge">
                Edit Request Mode
              </span>
            )}

            {/* Feature Flag Toggle */}
            {showFormToggle && onToggleForm && (
              <button
                type="button"
                className="form-toggle-btn"
                onClick={onToggleForm}
                title={useUnifiedForm ? 'Switch to Legacy Form' : 'Switch to New Unified Form'}
              >
                {useUnifiedForm ? 'New Form' : 'Legacy Form'}
              </button>
            )}
          </div>

          {/* Action Buttons */}
          {showActionButtons && (
            <div className="review-actions">
              {/* Edit Request Mode Actions */}
              {isEditRequestMode ? (
                <>
                  <div className="confirm-button-group">
                    <button
                      type="button"
                      className={`action-btn publish-btn ${isEditRequestConfirming ? 'confirming' : ''}`}
                      onClick={onSubmitEditRequest}
                      disabled={isSubmittingEditRequest || !hasChanges}
                      title={!hasChanges ? 'Make changes to submit' : 'Submit edit request for admin review'}
                    >
                      {isSubmittingEditRequest ? 'Submitting...' : (isEditRequestConfirming ? 'Confirm Submit?' : 'Submit Edit Request')}
                    </button>
                    {isEditRequestConfirming && onCancelEditRequestConfirm && (
                      <button
                        type="button"
                        className="confirm-cancel-x publish-cancel-x"
                        onClick={onCancelEditRequestConfirm}
                        title="Cancel submit"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    className="action-btn cancel-btn"
                    onClick={onCancelEditRequest}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  {/* Viewing Edit Request badge and toggle */}
                  {isViewingEditRequest && (
                    <>
                      <span className="edit-request-view-badge">
                        Viewing Edit Request
                      </span>
                      <button
                        type="button"
                        className="action-btn toggle-view-btn"
                        onClick={onViewOriginalEvent}
                        title="Switch to view the original published event"
                      >
                        🔄 View Original
                      </button>

                      {/* Approve/Reject buttons for admins viewing edit requests */}
                      {!isRequesterOnly && onApproveEditRequest && (
                        <div className="confirm-button-group">
                          <button
                            type="button"
                            className={`action-btn publish-btn ${isEditRequestApproveConfirming ? 'confirming' : ''}`}
                            onClick={onApproveEditRequest}
                            disabled={isApprovingEditRequest}
                          >
                            {isApprovingEditRequest ? 'Approving...' : (isEditRequestApproveConfirming ? 'Confirm Approve?' : 'Approve Edit')}
                          </button>
                          {isEditRequestApproveConfirming && onCancelEditRequestApprove && (
                            <button
                              type="button"
                              className="confirm-cancel-x publish-cancel-x"
                              onClick={onCancelEditRequestApprove}
                              title="Cancel approve"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      )}

                      {!isRequesterOnly && onRejectEditRequest && (
                        <div className="confirm-button-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {isEditRequestRejectConfirming && (
                            <input
                              type="text"
                              placeholder="Rejection reason (required)"
                              value={editRequestRejectionReason}
                              onChange={(e) => onEditRequestRejectionReasonChange && onEditRequestRejectionReasonChange(e.target.value)}
                              style={{
                                padding: '6px 10px',
                                borderRadius: '4px',
                                border: '1px solid #ef4444',
                                fontSize: '13px',
                                width: '200px'
                              }}
                              autoFocus
                            />
                          )}
                          <button
                            type="button"
                            className={`action-btn reject-btn ${isEditRequestRejectConfirming ? 'confirming' : ''}`}
                            onClick={onRejectEditRequest}
                            disabled={isRejectingEditRequest}
                          >
                            {isRejectingEditRequest ? 'Rejecting...' : (isEditRequestRejectConfirming ? 'Confirm Reject?' : 'Reject Edit')}
                          </button>
                          {isEditRequestRejectConfirming && onCancelEditRequestReject && (
                            <button
                              type="button"
                              className="confirm-cancel-x reject-cancel-x"
                              onClick={onCancelEditRequestReject}
                              title="Cancel reject"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      )}

                      {/* Cancel Edit Request button for requesters */}
                      {isRequesterOnly && onCancelPendingEditRequest && (
                        <div className="confirm-button-group">
                          <button
                            type="button"
                            className={`action-btn reject-btn ${isCancelEditRequestConfirming ? 'confirming' : ''}`}
                            onClick={onCancelPendingEditRequest}
                            disabled={isCancelingEditRequest}
                          >
                            {isCancelingEditRequest ? 'Canceling...' : (isCancelEditRequestConfirming ? '⚠️ Confirm Cancel?' : '🚫 Cancel Edit Request')}
                          </button>
                          {isCancelEditRequestConfirming && onCancelCancelEditRequest && (
                            <button
                              type="button"
                              className="confirm-cancel-x reject-cancel-x"
                              onClick={onCancelCancelEditRequest}
                              title="Don't cancel"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* View Edit Request button - when a pending edit request exists */}
                  {existingEditRequest && !isViewingEditRequest && !isEditRequestMode && itemStatus === 'published' && onViewEditRequest && (
                    <button
                      type="button"
                      className="action-btn view-edit-request-btn"
                      onClick={onViewEditRequest}
                      disabled={loadingEditRequest}
                      title="View your pending edit request"
                    >
                      {loadingEditRequest ? 'Loading...' : '📋 View Edit Request'}
                    </button>
                  )}

                  {/* Request Edit button - only shown when NO existing edit request */}
                  {canRequestEdit && !existingEditRequest && itemStatus === 'published' && onRequestEdit && !isEditRequestMode && !isViewingEditRequest && (
                    <button
                      type="button"
                      className="action-btn request-edit-btn"
                      onClick={onRequestEdit}
                      disabled={loadingEditRequest}
                      title="Request changes to this published event"
                    >
                      {loadingEditRequest ? 'Checking...' : 'Request Edit'}
                    </button>
                  )}

              {/* Publish button - only in review mode for pending items (not for requesters) */}
              {!isRequesterOnly && mode === 'review' && isPending && onApprove && (
                <div className="confirm-button-group">
                  <button
                    type="button"
                    className={`action-btn publish-btn ${isApproveConfirming ? 'confirming' : ''}`}
                    onClick={onApprove}
                    disabled={isApproving || hasSchedulingConflicts}
                    title={hasSchedulingConflicts ? 'Resolve scheduling conflicts before publishing' : undefined}
                  >
                    {isApproving ? 'Publishing...' : (isApproveConfirming ? (approveButtonText || 'Confirm Publish?') : 'Publish')}
                  </button>
                  {isApproveConfirming && onCancelApprove && (
                    <button
                      type="button"
                      className="confirm-cancel-x publish-cancel-x"
                      onClick={onCancelApprove}
                      title="Cancel publish"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}

              {/* Reject button - only in review mode for pending items (not for requesters) */}
              {!isRequesterOnly && mode === 'review' && isPending && onReject && (
                <div className="confirm-button-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {isRejectConfirming && (
                    <input
                      type="text"
                      placeholder="Rejection reason (required)"
                      value={rejectionReason}
                      onChange={(e) => onRejectionReasonChange?.(e.target.value)}
                      disabled={isRejecting}
                      style={{
                        padding: '6px 10px',
                        borderRadius: '4px',
                        border: '1px solid var(--color-error-300, #f87171)',
                        fontSize: '0.875rem',
                        minWidth: '200px'
                      }}
                      autoFocus
                    />
                  )}
                  <button
                    type="button"
                    className={`action-btn reject-btn ${isRejectConfirming ? 'confirming' : ''}`}
                    onClick={onReject}
                    disabled={isRejecting || (isRejectConfirming && !rejectionReason?.trim())}
                  >
                    {isRejecting ? 'Rejecting...' : (isRejectConfirming ? 'Confirm Reject?' : 'Reject')}
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
                    {isDeleting ? 'Deleting...' : (deleteButtonText || 'Delete')}
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

              {/* Save Draft button - for new drafts or updating existing drafts */}
              {onSaveDraft && (
                <div className="confirm-button-group">
                  <button
                    type="button"
                    className={`action-btn draft-btn ${isDraftConfirming ? 'confirming' : ''}`}
                    onClick={onSaveDraft}
                    disabled={savingDraft || isSaving || !canSaveDraft}
                    title={!canSaveDraft ? (!hasChanges ? 'No changes to save' : 'Event title is required to save as draft') : 'Save your progress as a draft'}
                  >
                    {savingDraft ? 'Drafting...' : (isDraftConfirming ? 'Confirm Draft?' : 'Save Draft')}
                  </button>
                  {isDraftConfirming && onCancelDraft && (
                    <button
                      type="button"
                      className="confirm-cancel-x draft-cancel-x"
                      onClick={onCancelDraft}
                      title="Cancel draft"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}

              {/* Submit Draft button - when editing an existing draft */}
              {isDraft && onSubmitDraft && (
                <button
                  type="button"
                  className="action-btn publish-btn"
                  onClick={onSubmitDraft}
                  disabled={isSaving || savingDraft || !isFormValid}
                  title={!isFormValid ? 'Please fill all required fields' : undefined}
                >
                  {isSaving ? (canApproveReservations ? 'Creating...' : 'Submitting...') : (canApproveReservations ? 'Create Event' : 'Submit Request')}
                </button>
              )}

              {/* Save Pending Edit button - for editing pending events */}
              {onSavePendingEdit && (
                <button
                  type="button"
                  className="action-btn publish-btn"
                  onClick={onSavePendingEdit}
                  disabled={!hasChanges || !isFormValid || savingPendingEdit}
                  title={!hasChanges ? 'No changes to save' : (!isFormValid ? 'Please fill all required fields' : 'Save changes to this pending reservation')}
                >
                  {savingPendingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              )}

              {/* Submit Edit Request button - for requesting edits on approved events (scale-80 modal) */}
              {onSubmitEditRequestModal && (
                <button
                  type="button"
                  className="action-btn publish-btn"
                  onClick={onSubmitEditRequestModal}
                  disabled={!hasChanges || !isFormValid || submittingEditRequestModal}
                  title={!hasChanges ? 'Make changes to submit an edit request' : (!isFormValid ? 'Please fill all required fields' : 'Submit changes for admin approval')}
                >
                  {submittingEditRequestModal ? 'Submitting...' : 'Submit Edit Request'}
                </button>
              )}

              {/* Submit button - only in create mode (for requesters submitting reservation requests) */}
              {mode === 'create' && onSave && !isDraft && (
                <div className="confirm-button-group">
                  <button
                    type="button"
                    className={`action-btn publish-btn ${isSaveConfirming ? 'confirming' : ''}`}
                    onClick={onSave}
                    disabled={!hasChanges || !isFormValid || isSaving}
                    title={!hasChanges ? 'Fill out the form to submit' : (!isFormValid ? 'Please fill all required fields' : '')}
                  >
                    {isSaving ? 'Submitting...' : (isSaveConfirming ? (saveButtonText || 'Confirm Submit?') : 'Submit Request')}
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
              {/* Hide when viewing an edit request */}
              {!isRequesterOnly && onSave && !isDraft && (mode === 'edit' || (mode === 'review' && isPending)) && !isViewingEditRequest && (
                <div className="confirm-button-group">
                  <button
                    type="button"
                    className={`action-btn save-btn ${isSaveConfirming ? 'confirming' : ''}`}
                    onClick={onSave}
                    disabled={!hasChanges || !isFormValid || isSaving || hasSchedulingConflicts}
                    title={hasSchedulingConflicts ? 'Resolve scheduling conflicts before saving' : (!hasChanges ? 'No changes to save' : (!isFormValid ? 'Please fill all required fields' : ''))}
                  >
                    {isSaving ? 'Saving...' : (isSaveConfirming ? 'Confirm Save?' : (saveButtonText || 'Save'))}
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
              {/* Hide when viewing an edit request */}
              {!isRequesterOnly && mode === 'edit' && onDelete && !isViewingEditRequest && (
                <div className="confirm-button-group">
                  <button
                    type="button"
                    className={`action-btn delete-btn ${isDeleteConfirming ? 'confirming' : ''}`}
                    onClick={onDelete}
                    disabled={isDeleting}
                    title="Delete this event"
                  >
                    {isDeleting ? 'Deleting...' : (deleteButtonText || 'Delete')}
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

              {hasSchedulingConflicts && (
                <span className="scheduling-conflict-warning" title="Scheduling conflicts detected">
                  ⚠ Conflicts
                </span>
              )}

              <button
                type="button"
                className="action-btn cancel-btn"
                onClick={onClose}
              >
                {isRequesterOnly ? 'Close' : (mode === 'create' || (mode === 'review' && isPending) ? 'Cancel' : 'Close')}
              </button>
                </>
              )}
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
            {!isRequesterOnly && (
              <div
                className={`event-type-tab ${activeTab === 'attachments' ? 'active' : ''}`}
                onClick={() => setActiveTab('attachments')}
              >
                {attachmentCount > 0 ? `Attachments (${attachmentCount})` : 'Attachments'}
              </div>
            )}
            {!isRequesterOnly && (
              <div
                className={`event-type-tab ${activeTab === 'history' ? 'active' : ''}`}
                onClick={() => setActiveTab('history')}
              >
                {historyCount > 0 ? `History (${historyCount})` : 'History'}
              </div>
            )}
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
            ? React.cloneElement(children, { activeTab, isEditRequestMode, isViewingEditRequest, originalData })
            : children}

          {/* Loading Overlay for Series Navigation */}
          {isNavigating && (
            <div className="navigation-loading-overlay">
              <LoadingSpinner minHeight={100} size={40} />
            </div>
          )}
        </div>

        {/* Edit Request Mode - show change count or prompt to make changes */}
        {isEditRequestMode && detectedChanges.length === 0 && (
          <div className="edit-request-no-changes">
            Make at least one change to submit an edit request.
          </div>
        )}

        {/* Draft Save Dialog - shown when closing with unsaved changes */}
        {showDraftDialog && (
          <DraftSaveDialog
            isOpen={showDraftDialog}
            onSaveDraft={onDraftDialogSave}
            onDiscard={onDraftDialogDiscard}
            onCancel={onDraftDialogCancel}
            canSaveDraft={canSaveDraft}
            saving={savingDraft}
          />
        )}

        {/* Discard Dialog - shown when closing pending edit with unsaved changes */}
        {showDiscardDialog && (
          <div className="draft-save-dialog-overlay">
            <div className="draft-save-dialog">
              <h3>Unsaved Changes</h3>
              <p>You have unsaved changes. Are you sure you want to discard them?</p>
              <div className="draft-save-dialog-actions">
                <button
                  type="button"
                  className="action-btn reject-btn"
                  onClick={onDiscardDialogDiscard}
                >
                  Discard
                </button>
                <button
                  type="button"
                  className="action-btn"
                  onClick={onDiscardDialogCancel}
                >
                  Keep Editing
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
