// src/components/shared/ReviewModal.jsx
import React, { useEffect, useCallback, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { usePermissions } from '../../hooks/usePermissions';
import useScrollLock from '../../hooks/useScrollLock';
import LoadingSpinner from './LoadingSpinner';
import DraftSaveDialog from './DraftSaveDialog';
import DiscardChangesDialog from './DiscardChangesDialog';
import RecurrenceWarningDialog from './RecurrenceWarningDialog';
import DuplicateDateDialog from './DuplicateDateDialog';
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
  title = 'Event',
  modalMode = null,
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
  showActionButtons = true,
  // Tab configuration
  showTabs = true,
  attachmentCount = 0,
  historyCount = 0,
  // Styling
  modalClassName = 'review-modal',
  overlayClassName = 'review-modal-overlay',
  // Button label customization (default label only, not confirmation text)
  saveButtonLabel = null,
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
  rejectInputRef = null,
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
  isDraftOccurrenceEdit = false,
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
  // Cancellation request props (for requesting cancellation of published events)
  canRequestCancellation = false,
  onRequestCancellation = null,
  isCancellationRequestMode = false,
  cancellationReason = '',
  onCancellationReasonChange = null,
  onSubmitCancellationRequest = null,
  onCancelCancellationRequest = null,
  isSubmittingCancellationRequest = false,
  // Existing cancellation request props (viewing/withdrawing)
  existingCancellationRequest = null,
  // Cancellation request approval/rejection props (for admins/approvers)
  onApproveCancellationRequest = null,
  onRejectCancellationRequest = null,
  isApprovingCancellationRequest = false,
  isRejectingCancellationRequest = false,
  cancellationRejectionReason = '',
  onCancellationRejectionReasonChange = null,
  isCancellationApproveConfirming = false,
  isCancellationRejectConfirming = false,
  onCancelCancellationApprove = null,
  onCancelCancellationReject = null,
  onWithdrawCancellationRequest = null,
  isWithdrawingCancellationRequest = false,
  isWithdrawCancellationConfirming = false,
  onCancelWithdrawCancellation = null,
  // Requester action buttons (opt-in, for MyReservations)
  // Delete reason (for owner-pending delete)
  deleteReason = '',
  onDeleteReasonChange = null,
  deleteInputRef = null,
  // Resubmit (requester, rejected events)
  onResubmit = null,
  isResubmitting = false,
  // Restore (owner, deleted events)
  onRestore = null,
  isRestoring = false,
  // Pending edit props (for editing pending events directly)
  onSavePendingEdit = null,
  savingPendingEdit = false,
  // Rejected edit props (for editing rejected events + resubmitting)
  onSaveRejectedEdit = null,
  savingRejectedEdit = false,
  showDiscardDialog = false,
  onDiscardDialogDiscard = null,
  onDiscardDialogCancel = null,
  // Duplicate mode props (from NewReservationModal)
  onDuplicate = null, // Opens the duplicate date dialog
  showDuplicateDialog = false,
  onDuplicateClose = null,
  onDuplicateSubmit = null,
  submittingDuplicate = false,
  duplicateEventTitle = '',
  duplicateSourceDate = '',
  // Scheduling conflict state (from SchedulingAssistant)
  hasSchedulingConflicts = false, // Hard conflicts (published events)
  hasSoftConflicts = false, // Soft conflicts (pending edit proposals)
  hasPendingReservationConflicts = false, // Informational conflicts (other pending requests)
  isHold = false, // No event times — will display as [Hold]
  // Recurring event data (for Recurrence tab)
  reservation = null,
  // Recurrence tab props (auto-detected from reservation if not explicitly set)
  hasRecurrence: hasRecurrenceProp = null,
  canEditRecurrence: canEditRecurrenceProp = null,
  // Event owner info (displayed as pills in action bar)
  requesterName = '',
  // Recurrence warning dialog props (for uncommitted recurrence edits on draft save)
  showRecurrenceWarning = false,
  onRecurrenceWarningCreateAndSave = null,
  onRecurrenceWarningSaveWithout = null,
  onRecurrenceWarningCancel = null,
  createRecurrenceRef = null,
  onHasUncommittedRecurrence = null,
  // Scheduling check complete: false while waiting for initial conflict check, defaults to true for parents that don't track it
  isSchedulingCheckComplete = true
}) {
  // Get admin status from permissions hook
  const { isAdmin, canApproveReservations } = usePermissions();

  // Determine effective conflict blocking behavior
  // Hard conflicts: block non-admins, allow admin override
  // Soft conflicts: show warning but don't disable buttons (handled by useReviewModal confirmation)
  const hardConflictBlocks = hasSchedulingConflicts && !isAdmin;

  // Auto-detect recurrence from reservation if not explicitly provided
  const hasRecurrenceFromReservation = Boolean(reservation?.recurrence || reservation?.calendarData?.recurrence || reservation?.eventType === 'seriesMaster');
  const [liveHasRecurrence, setLiveHasRecurrence] = useState(false);
  const [hasServices, setHasServices] = useState(false);

  // Re-initialize from reservation when it changes
  useEffect(() => {
    setLiveHasRecurrence(hasRecurrenceFromReservation);
  }, [hasRecurrenceFromReservation]);

  const hasRecurrence = hasRecurrenceProp !== null ? hasRecurrenceProp
    : (hasRecurrenceFromReservation || liveHasRecurrence);
  const canEditRecurrence = canEditRecurrenceProp !== null ? canEditRecurrenceProp : true;
  // Show tab (signals series membership) but disable — recurrence is owned by the series master.
  const isRecurrenceTabDisabled = (reservation?.eventType === 'exception' || reservation?.eventType === 'addition') && !hasRecurrence;

  // Lock body scroll when modal is open (runs before paint to prevent jitter)
  useScrollLock(isOpen);

  // Focus inline reason inputs when confirmation state opens (more reliable than autoFocus on re-renders)
  useEffect(() => {
    if (isRejectConfirming && rejectInputRef?.current) {
      requestAnimationFrame(() => rejectInputRef.current?.focus());
    }
  }, [isRejectConfirming, rejectInputRef]);

  useEffect(() => {
    if (isDeleteConfirming && deleteInputRef?.current) {
      requestAnimationFrame(() => deleteInputRef.current?.focus());
    }
  }, [isDeleteConfirming, deleteInputRef]);

  // Helper to get status class for badge
  const getStatusClass = (status) => {
    switch (status) {
      case 'pending': return 'status-pending';
      case 'published': return 'status-published';
      case 'rejected': return 'status-rejected';
      case 'draft': return 'status-draft';
      default: return '';
    }
  };

  // Helper to format status text
  const formatStatus = (status) => {
    if (!status) return 'Unknown';
    return status.charAt(0).toUpperCase() + status.slice(1);
  };
  // Tab state - reset to 'details' whenever modal opens
  const [activeTab, setActiveTab] = useState('details');
  // Track whether Event Details date/time fields are complete (gates other tabs)
  // Default true to avoid flash on existing events; FormBase is the sole authority
  // and will override via onDetailsCompleteChange callback after mount
  const [areDetailsComplete, setAreDetailsComplete] = useState(true);
  useEffect(() => {
    if (isOpen) {
      setActiveTab('details');
      // Note: do NOT reset areDetailsComplete here — React runs parent effects
      // AFTER child effects, so this would clobber FormBase's onDetailsCompleteChange(false)
    }
  }, [isOpen]);

  const recurrenceTabTitle = isRecurrenceTabDisabled
    ? 'Recurrence pattern is defined on the series master'
    : !areDetailsComplete ? 'Fill in event dates and times first'
    : undefined;

  // Local confirmation state for buttons without external confirmation management.
  // Tracks which button is in "Confirm?" state: 'submitDraft' | 'pendingEdit' | 'publishedEdit' | 'editRequestModal' | null
  const [localConfirming, setLocalConfirming] = useState(null);

  // When ANY button is in confirming state, all OTHER buttons should be disabled
  const anyConfirming = isApproveConfirming || isRejectConfirming || isDeleteConfirming ||
    isSaveConfirming || isDraftConfirming || isEditRequestConfirming ||
    isEditRequestApproveConfirming || isEditRequestRejectConfirming ||
    isCancelEditRequestConfirming || localConfirming !== null;

  // Clear local confirmation when external confirmations activate
  useEffect(() => {
    if (isApproveConfirming || isRejectConfirming || isDeleteConfirming || isDraftConfirming || isSaveConfirming) {
      setLocalConfirming(null);
    }
  }, [isApproveConfirming, isRejectConfirming, isDeleteConfirming, isDraftConfirming, isSaveConfirming]);

  // Generic local confirmation handler: first click shows "Confirm?", second click fires action
  const handleLocalConfirmClick = useCallback((key, action) => {
    if (localConfirming === key) {
      setLocalConfirming(null);
      action();
    } else {
      setLocalConfirming(key);
    }
  }, [localConfirming]);

  // Close on ESC key
  const handleEscKey = useCallback((e) => {
    if (e.key === 'Escape' && isOpen) {
      onClose();
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscKey);
    }

    return () => {
      document.removeEventListener('keydown', handleEscKey);
    };
  }, [isOpen, handleEscKey]);

  // Close on overlay click — only if mousedown also started on the overlay.
  // This prevents closing when a drag starts inside the modal (e.g. SchedulingAssistant
  // event block resize) and the cursor ends up on the overlay on mouseup.
  const mouseDownTargetRef = useRef(null);
  const handleOverlayMouseDown = (e) => {
    mouseDownTargetRef.current = e.target;
  };
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget && mouseDownTargetRef.current === e.currentTarget) {
      onClose();
    }
  };

  // Content gate: true when availability data is loaded (or not needed).
  // Until this is true, the modal shows a spinner and form children are not mounted.
  const isContentReady = isSchedulingCheckComplete;

  if (!isOpen) return null;

  const inlineStyles = { display: 'flex', flexDirection: 'column' };

  const modalContent = (
    <div className={overlayClassName} onMouseDown={handleOverlayMouseDown} onClick={handleOverlayClick}>
      {/* Content gate: show spinner on frosted overlay until data is ready.
          Modal container only renders once content is loaded — no empty white box. */}
      {!isContentReady ? (
        <LoadingSpinner size={48} text="Loading..." />
      ) : (
      <div className={modalClassName} style={inlineStyles}>
        {/* Sticky Action Bar */}
        <div className="review-action-bar">
          <div className="action-bar-left">
            <div className="action-bar-identity">
              {modalMode && (
                <span className={`mode-pill mode-${modalMode}`}>
                  {modalMode === 'edit' && 'Editing'}
                  {modalMode === 'review' && 'Reviewing'}
                  {modalMode === 'view' && 'Viewing'}
                  {modalMode === 'new' && 'New'}
                </span>
              )}
              <h2 className="action-bar-title">{title}</h2>
              {itemStatus && !isEditRequestMode && !isViewingEditRequest && (
                <span className={`status-pill ${getStatusClass(itemStatus)}`}>
                  {formatStatus(itemStatus)}
                </span>
              )}
              {eventVersion != null && (
                <span className="meta-item meta-version" title="Document version (for concurrency control)">
                  v{eventVersion}
                </span>
              )}
              {requesterName && (
                <span className="meta-item" title={`Requested by ${requesterName}`}>
                  {requesterName}
                </span>
              )}
              {isHold && (
                <span className="warning-strip warning-hold" title="No event times — will display as [Hold]">
                  ⚠ Hold
                </span>
              )}
              {hasSchedulingConflicts && (
                <span
                  className={`warning-strip warning-conflict ${isAdmin ? 'admin-override' : ''}`}
                  title={`Hard Conflicts${isAdmin ? ' (Override Available)' : ''}`}
                >
                  ⚠ Conflicts{isAdmin ? '*' : ''}
                </span>
              )}
              {!hasSchedulingConflicts && hasSoftConflicts && (
                <span className="warning-strip warning-soft-conflict" title="Pending Edit Conflicts">
                  ⚠ Edit Conflicts
                </span>
              )}
              {!hasSchedulingConflicts && !hasSoftConflicts && hasPendingReservationConflicts && (
                <span className="warning-strip warning-pending-reservation" title="Overlapping Pending Requests">
                  ⚠ Overlapping
                </span>
              )}
              {existingCancellationRequest?.status === 'pending' && isRequesterOnly && (
                <span
                  className="warning-strip warning-cancellation-pending"
                  title={`${existingCancellationRequest.requestedBy?.name || existingCancellationRequest.requestedBy?.email || 'Someone'} requested cancellation${existingCancellationRequest.requestedBy?.requestedAt ? ' on ' + new Date(existingCancellationRequest.requestedBy.requestedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}`}
                >
                  Cancellation pending — {existingCancellationRequest.requestedBy?.name || existingCancellationRequest.requestedBy?.email || 'Unknown'}{existingCancellationRequest.requestedBy?.requestedAt ? `, ${new Date(existingCancellationRequest.requestedBy.requestedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                </span>
              )}
              {isEditRequestMode && (
                <span className="meta-item edit-request-mode-badge">
                  Edit Request Mode
                </span>
              )}
            </div>
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
                      disabled={isSubmittingEditRequest || !hasChanges || (anyConfirming && !isEditRequestConfirming)}
                    >
                      {isSubmittingEditRequest ? 'Submitting...' : (isEditRequestConfirming ? 'Confirm Submit?' : 'Submit Edit Request')}
                    </button>
                    {isEditRequestConfirming && onCancelEditRequestConfirm && (
                      <button
                        type="button"
                        className="confirm-cancel-x publish-cancel-x"
                        onClick={onCancelEditRequestConfirm}
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
                  {/* ═══════════════════════════════════════════════════
                       STANDARDIZED BUTTON ORDER
                       Group 1: Primary positive actions (left)
                       Group 2: Save/edit actions
                       Group 3: Utility (Duplicate, View/Request Edit)
                       Group 4: Destructive/negative actions
                       Group 5: Close (always last, right)
                     ═══════════════════════════════════════════════════ */}

                  {/* ── Viewing Edit Request: badge + toggle + approve/reject ── */}
                  {isViewingEditRequest && (
                    <>
                      <span className="edit-request-view-badge">
                        Viewing Edit Request
                      </span>
                      <button
                        type="button"
                        className="action-btn toggle-view-btn"
                        onClick={onViewOriginalEvent}
                        disabled={anyConfirming}
                      >
                        🔄 View Original
                      </button>
                    </>
                  )}

                  {/* ── GROUP 1: Primary positive actions ── */}

                  {/* Publish — admin reviewing pending */}
                  {!isRequesterOnly && mode === 'review' && isPending && onApprove && (
                    <div className="confirm-button-group">
                      <button
                        type="button"
                        className={`action-btn publish-btn ${isApproveConfirming ? 'confirming' : ''}`}
                        onClick={onApprove}
                        disabled={isApproving || hardConflictBlocks || (anyConfirming && !isApproveConfirming)}
                      >
                        {isApproving ? 'Publishing...' : (isApproveConfirming ? (isHold ? 'Publish as [Hold]?' : 'Confirm Publish?') : 'Publish')}
                      </button>
                      {isApproveConfirming && onCancelApprove && (
                        <button type="button" className="confirm-cancel-x publish-cancel-x" onClick={onCancelApprove}>✕</button>
                      )}
                    </div>
                  )}

                  {/* Submit Request — requester creating new */}
                  {mode === 'create' && onSave && !isDraft && (
                    <div className="confirm-button-group">
                      <button
                        type="button"
                        className={`action-btn publish-btn ${isSaveConfirming ? 'confirming' : ''}`}
                        onClick={onSave}
                        disabled={!hasChanges || !isFormValid || isSaving || (anyConfirming && !isSaveConfirming)}
                      >
                        {isSaving ? 'Submitting...' : (isSaveConfirming ? (isHold ? 'Submit as [Hold]?' : 'Confirm Submit?') : 'Submit Request')}
                      </button>
                      {isSaveConfirming && onCancelSave && (
                        <button type="button" className="confirm-cancel-x submit-cancel-x" onClick={onCancelSave}>✕</button>
                      )}
                    </div>
                  )}

                  {/* Submit Draft — draft → pending/published */}
                  {isDraft && onSubmitDraft && (
                    <div className="confirm-button-group">
                      <button
                        type="button"
                        className={`action-btn publish-btn ${localConfirming === 'submitDraft' ? 'confirming' : ''}`}
                        onClick={() => handleLocalConfirmClick('submitDraft', onSubmitDraft)}
                        disabled={isDraftOccurrenceEdit || isSaving || savingDraft || !isFormValid || (anyConfirming && localConfirming !== 'submitDraft')}
                        title={isDraftOccurrenceEdit ? 'Open the series master to submit all occurrences' : undefined}
                      >
                        {isSaving
                          ? 'Submitting...'
                          : localConfirming === 'submitDraft'
                            ? (isHold ? 'Submit as [Hold]?' : 'Confirm Submit?')
                            : 'Submit Request'}
                      </button>
                      {localConfirming === 'submitDraft' && (
                        <button type="button" className="confirm-cancel-x publish-cancel-x" onClick={() => setLocalConfirming(null)}>✕</button>
                      )}
                    </div>
                  )}

                  {/* Save & Resubmit — requester, rejected events with changes */}
                  {isRequesterOnly && itemStatus === 'rejected' && onSaveRejectedEdit && hasChanges && !isEditRequestMode && !isViewingEditRequest && (
                    <div className="confirm-button-group">
                      <button
                        type="button"
                        className={`action-btn publish-btn ${localConfirming === 'rejectedEdit' ? 'confirming' : ''}`}
                        onClick={() => handleLocalConfirmClick('rejectedEdit', onSaveRejectedEdit)}
                        disabled={savingRejectedEdit || !isFormValid || hardConflictBlocks || (anyConfirming && localConfirming !== 'rejectedEdit')}
                      >
                        {savingRejectedEdit ? 'Saving & Resubmitting...' : (localConfirming === 'rejectedEdit' ? 'Confirm?' : 'Save & Resubmit')}
                      </button>
                      {localConfirming === 'rejectedEdit' && (
                        <button type="button" className="confirm-cancel-x publish-cancel-x" onClick={() => setLocalConfirming(null)}>✕</button>
                      )}
                    </div>
                  )}

                  {/* Resubmit — requester, rejected events without changes */}
                  {isRequesterOnly && itemStatus === 'rejected' && onResubmit && !hasChanges && !isEditRequestMode && !isViewingEditRequest && (
                    <div className="confirm-button-group">
                      <button
                        type="button"
                        className={`action-btn publish-btn ${localConfirming === 'resubmit' ? 'confirming' : ''}`}
                        onClick={() => handleLocalConfirmClick('resubmit', onResubmit)}
                        disabled={isResubmitting || (anyConfirming && localConfirming !== 'resubmit')}
                      >
                        {isResubmitting ? 'Resubmitting...' : (localConfirming === 'resubmit' ? 'Confirm Resubmit?' : 'Resubmit')}
                      </button>
                      {localConfirming === 'resubmit' && (
                        <button type="button" className="confirm-cancel-x publish-cancel-x" onClick={() => setLocalConfirming(null)}>✕</button>
                      )}
                    </div>
                  )}

                  {/* Restore — deleted events */}
                  {itemStatus === 'deleted' && onRestore && !isEditRequestMode && !isViewingEditRequest && (
                    <div className="confirm-button-group">
                      <button
                        type="button"
                        className={`action-btn publish-btn ${localConfirming === 'restore' ? 'confirming' : ''}`}
                        onClick={() => handleLocalConfirmClick('restore', onRestore)}
                        disabled={isRestoring || (anyConfirming && localConfirming !== 'restore')}
                      >
                        {isRestoring ? 'Restoring...' : (localConfirming === 'restore' ? 'Confirm Restore?' : 'Restore')}
                      </button>
                      {localConfirming === 'restore' && (
                        <button type="button" className="confirm-cancel-x publish-cancel-x" onClick={() => setLocalConfirming(null)}>✕</button>
                      )}
                    </div>
                  )}


                  {/* Approve Edit Request — admin viewing edit request */}
                  {isViewingEditRequest && !isRequesterOnly && onApproveEditRequest && (
                    <div className="confirm-button-group">
                      <button
                        type="button"
                        className={`action-btn publish-btn ${isEditRequestApproveConfirming ? 'confirming' : ''}`}
                        onClick={onApproveEditRequest}
                        disabled={isApprovingEditRequest || (anyConfirming && !isEditRequestApproveConfirming)}
                      >
                        {isApprovingEditRequest ? 'Approving...' : (isEditRequestApproveConfirming ? 'Confirm Approve?' : 'Approve Edit')}
                      </button>
                      {isEditRequestApproveConfirming && onCancelEditRequestApprove && (
                        <button type="button" className="confirm-cancel-x publish-cancel-x" onClick={onCancelEditRequestApprove}>✕</button>
                      )}
                    </div>
                  )}

                  {/* Approve Cancellation — admin */}
                  {!isRequesterOnly && existingCancellationRequest?.status === 'pending' && onApproveCancellationRequest && (
                    <div className="confirm-button-group">
                      <button
                        type="button"
                        className={`action-btn publish-btn ${isCancellationApproveConfirming ? 'confirming' : ''}`}
                        onClick={onApproveCancellationRequest}
                        disabled={isApprovingCancellationRequest || (anyConfirming && !isCancellationApproveConfirming)}
                      >
                        {isApprovingCancellationRequest ? 'Approving...' : (isCancellationApproveConfirming ? 'Confirm Cancel Event?' : 'Approve Cancellation')}
                      </button>
                      {isCancellationApproveConfirming && onCancelCancellationApprove && (
                        <button type="button" className="confirm-cancel-x publish-cancel-x" onClick={onCancelCancellationApprove}>✕</button>
                      )}
                    </div>
                  )}

                  {/* ── GROUP 2: Save/edit actions ── */}

                  {/* Save — admin save (published/pending) */}
                  {!isRequesterOnly && onSave && !isDraft && itemStatus !== 'deleted' && (mode === 'edit' || (mode === 'review' && isPending)) && !isViewingEditRequest && (
                    <div className="confirm-button-group">
                      <button
                        type="button"
                        className={`action-btn save-btn ${isSaveConfirming ? 'confirming' : ''}`}
                        onClick={onSave}
                        disabled={!hasChanges || !isFormValid || isSaving || hardConflictBlocks || (anyConfirming && !isSaveConfirming)}
                      >
                        {isSaving ? 'Saving...' : (isSaveConfirming ? 'Confirm Save?' : (saveButtonLabel || 'Save'))}
                      </button>
                      {isSaveConfirming && onCancelSave && (
                        <button type="button" className="confirm-cancel-x save-cancel-x" onClick={onCancelSave}>✕</button>
                      )}
                    </div>
                  )}


                  {/* Save Pending Edit — owner editing pending */}
                  {onSavePendingEdit && (
                    <div className="confirm-button-group">
                      <button
                        type="button"
                        className={`action-btn publish-btn ${localConfirming === 'pendingEdit' ? 'confirming' : ''}`}
                        onClick={() => handleLocalConfirmClick('pendingEdit', onSavePendingEdit)}
                        disabled={!hasChanges || !isFormValid || savingPendingEdit || (anyConfirming && localConfirming !== 'pendingEdit')}
                      >
                        {savingPendingEdit ? 'Saving...' : (localConfirming === 'pendingEdit' ? 'Confirm Save?' : 'Save Changes')}
                      </button>
                      {localConfirming === 'pendingEdit' && (
                        <button type="button" className="confirm-cancel-x publish-cancel-x" onClick={() => setLocalConfirming(null)}>✕</button>
                      )}
                    </div>
                  )}

                  {/* Save Draft */}
                  {onSaveDraft && (
                    <div className="confirm-button-group">
                      <button
                        type="button"
                        className={`action-btn draft-btn ${isDraftConfirming ? 'confirming' : ''}`}
                        onClick={onSaveDraft}
                        disabled={savingDraft || isSaving || !canSaveDraft || (anyConfirming && !isDraftConfirming)}
                      >
                        {savingDraft ? 'Drafting...' : (isDraftConfirming ? 'Confirm Draft?' : 'Save Draft')}
                      </button>
                      {isDraftConfirming && onCancelDraft && (
                        <button type="button" className="confirm-cancel-x draft-cancel-x" onClick={onCancelDraft}>✕</button>
                      )}
                    </div>
                  )}

                  {/* ── GROUP 3: Utility actions ── */}

                  {/* Duplicate — opens date picker dialog */}
                  {onDuplicate && itemStatus !== 'deleted' && (
                    <button
                      type="button"
                      className="action-btn duplicate-btn"
                      onClick={onDuplicate}
                      disabled={anyConfirming}
                    >
                      Duplicate
                    </button>
                  )}

                  {/* View Edit Request */}
                  {existingEditRequest && !isViewingEditRequest && !isEditRequestMode && itemStatus === 'published' && onViewEditRequest && (
                    <button
                      type="button"
                      className="action-btn view-edit-request-btn"
                      onClick={onViewEditRequest}
                      disabled={loadingEditRequest || anyConfirming}
                    >
                      {loadingEditRequest ? 'Loading...' : (
                        existingEditRequest?.proposedChanges?.startDateTime
                          ? `📋 View Edit Request (${existingEditRequest.proposedChanges.startDateTime.split('T')[0]})`
                          : '📋 View Edit Request'
                      )}
                    </button>
                  )}

                  {/* Request Edit */}
                  {canRequestEdit && !existingEditRequest && itemStatus === 'published' && onRequestEdit && !isEditRequestMode && !isViewingEditRequest && (
                    <button
                      type="button"
                      className="action-btn request-edit-btn"
                      onClick={onRequestEdit}
                      disabled={loadingEditRequest || anyConfirming}
                    >
                      {loadingEditRequest ? 'Checking...' : 'Request Edit'}
                    </button>
                  )}

                  {/* Request Cancellation */}
                  {isRequesterOnly && itemStatus === 'published' && !isEditRequestMode && !isViewingEditRequest && !isCancellationRequestMode && (
                    existingCancellationRequest?.status === 'pending' ? (
                      <button
                        type="button"
                        className="action-btn request-cancellation-btn"
                        disabled
                        title={`${existingCancellationRequest.requestedBy?.name || existingCancellationRequest.requestedBy?.email || 'Someone'} submitted a cancellation request${existingCancellationRequest.requestedBy?.requestedAt ? ' on ' + new Date(existingCancellationRequest.requestedBy.requestedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}`}
                      >
                        Cancellation Pending
                      </button>
                    ) : (
                      canRequestCancellation && onRequestCancellation && (
                        <button
                          type="button"
                          className="action-btn request-cancellation-btn"
                          onClick={onRequestCancellation}
                          disabled={anyConfirming}
                        >
                          Request Cancellation
                        </button>
                      )
                    )
                  )}

                  {/* Cancellation request form (inline reason) */}
                  {isCancellationRequestMode && onSubmitCancellationRequest && existingCancellationRequest?.status !== 'pending' && (
                    <div className="cancellation-request-form" style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%' }}>
                      <input
                        type="text"
                        className="inline-reason-input"
                        placeholder="Why should this event be cancelled?"
                        value={cancellationReason}
                        onChange={(e) => onCancellationReasonChange?.(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && cancellationReason?.trim()) onSubmitCancellationRequest(); }}
                        disabled={isSubmittingCancellationRequest}
                        autoFocus
                        style={{ flex: 1 }}
                      />
                      <button type="button" className="action-btn delete-btn confirming" onClick={onSubmitCancellationRequest} disabled={isSubmittingCancellationRequest || !cancellationReason?.trim()}>
                        {isSubmittingCancellationRequest ? 'Submitting...' : 'Submit'}
                      </button>
                      <button type="button" className="action-btn" onClick={onCancelCancellationRequest} disabled={isSubmittingCancellationRequest}>
                        Cancel
                      </button>
                    </div>
                  )}

                  {/* ── GROUP 4: Destructive/negative actions ── */}

                  {/* Reject — admin rejecting pending */}
                  {!isRequesterOnly && mode === 'review' && isPending && onReject && (
                    <div className="confirm-button-group">
                      {isRejectConfirming && (
                        <input
                          type="text"
                          className="inline-reason-input"
                          placeholder="Why are you rejecting this?"
                          value={rejectionReason}
                          onChange={(e) => onRejectionReasonChange?.(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && rejectionReason?.trim()) onReject(); }}
                          disabled={isRejecting}
                          ref={rejectInputRef}
                        />
                      )}
                      <button
                        type="button"
                        className={`action-btn reject-btn ${isRejectConfirming ? 'confirming' : ''}`}
                        onClick={onReject}
                        disabled={isRejecting || (isRejectConfirming && !rejectionReason?.trim()) || (anyConfirming && !isRejectConfirming)}
                      >
                        {isRejecting ? 'Rejecting...' : (isRejectConfirming ? 'Confirm Reject?' : 'Reject')}
                      </button>
                      {isRejectConfirming && onCancelReject && (
                        <button type="button" className="confirm-cancel-x reject-cancel-x" onClick={onCancelReject}>✕</button>
                      )}
                    </div>
                  )}

                  {/* Reject Edit Request — admin viewing edit request */}
                  {isViewingEditRequest && !isRequesterOnly && onRejectEditRequest && (
                    <div className="confirm-button-group">
                      {isEditRequestRejectConfirming && (
                        <input
                          type="text"
                          className="inline-reason-input"
                          placeholder="Why are you rejecting this edit?"
                          value={editRequestRejectionReason}
                          onChange={(e) => onEditRequestRejectionReasonChange && onEditRequestRejectionReasonChange(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && editRequestRejectionReason?.trim()) onRejectEditRequest(); }}
                          autoFocus
                        />
                      )}
                      <button
                        type="button"
                        className={`action-btn reject-btn ${isEditRequestRejectConfirming ? 'confirming' : ''}`}
                        onClick={onRejectEditRequest}
                        disabled={isRejectingEditRequest || (anyConfirming && !isEditRequestRejectConfirming)}
                      >
                        {isRejectingEditRequest ? 'Rejecting...' : (isEditRequestRejectConfirming ? 'Confirm Reject?' : 'Reject Edit')}
                      </button>
                      {isEditRequestRejectConfirming && onCancelEditRequestReject && (
                        <button type="button" className="confirm-cancel-x reject-cancel-x" onClick={onCancelEditRequestReject}>✕</button>
                      )}
                    </div>
                  )}

                  {/* Reject Cancellation — admin */}
                  {!isRequesterOnly && existingCancellationRequest?.status === 'pending' && onRejectCancellationRequest && (
                    <div className="confirm-button-group">
                      {isCancellationRejectConfirming && (
                        <input
                          type="text"
                          className="inline-reason-input"
                          placeholder="Why are you rejecting this cancellation?"
                          value={cancellationRejectionReason}
                          onChange={(e) => onCancellationRejectionReasonChange?.(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && cancellationRejectionReason?.trim()) onRejectCancellationRequest(); }}
                          autoFocus
                        />
                      )}
                      <button
                        type="button"
                        className={`action-btn reject-btn ${isCancellationRejectConfirming ? 'confirming' : ''}`}
                        onClick={onRejectCancellationRequest}
                        disabled={isRejectingCancellationRequest || (isCancellationRejectConfirming && !cancellationRejectionReason?.trim()) || (anyConfirming && !isCancellationRejectConfirming)}
                      >
                        {isRejectingCancellationRequest ? 'Rejecting...' : (isCancellationRejectConfirming ? 'Confirm Reject?' : 'Reject Cancellation')}
                      </button>
                      {isCancellationRejectConfirming && onCancelCancellationReject && (
                        <button type="button" className="confirm-cancel-x reject-cancel-x" onClick={onCancelCancellationReject}>✕</button>
                      )}
                    </div>
                  )}

                  {/* Withdraw Request — requester, pending (delete with reason) */}
                  {isRequesterOnly && itemStatus === 'pending' && onDelete && !isEditRequestMode && !isViewingEditRequest && (
                    <div className="confirm-button-group">
                      {isDeleteConfirming && (
                        <input
                          type="text"
                          className="inline-reason-input"
                          placeholder="Why are you withdrawing?"
                          value={deleteReason}
                          onChange={(e) => onDeleteReasonChange?.(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && deleteReason?.trim()) onDelete(); }}
                          disabled={isDeleting}
                          ref={deleteInputRef}
                        />
                      )}
                      <button
                        type="button"
                        className={`action-btn delete-btn ${isDeleteConfirming ? 'confirming' : ''}`}
                        onClick={onDelete}
                        disabled={isDeleting || (isDeleteConfirming && !deleteReason?.trim()) || (anyConfirming && !isDeleteConfirming)}
                      >
                        {isDeleting ? 'Withdrawing...' : (isDeleteConfirming ? 'Confirm Withdraw?' : 'Withdraw Request')}
                      </button>
                      {isDeleteConfirming && onCancelDelete && (
                        <button type="button" className="confirm-cancel-x delete-cancel-x" onClick={onCancelDelete}>✕</button>
                      )}
                    </div>
                  )}

                  {/* Withdraw Cancellation — requester */}
                  {isRequesterOnly && existingCancellationRequest?.status === 'pending' && onWithdrawCancellationRequest && (
                    <div className="confirm-button-group">
                      <button
                        type="button"
                        className={`action-btn reject-btn ${isWithdrawCancellationConfirming ? 'confirming' : ''}`}
                        onClick={onWithdrawCancellationRequest}
                        disabled={isWithdrawingCancellationRequest || (anyConfirming && !isWithdrawCancellationConfirming)}
                      >
                        {isWithdrawingCancellationRequest ? 'Withdrawing...' : (isWithdrawCancellationConfirming ? 'Confirm Withdraw?' : 'Withdraw Cancellation')}
                      </button>
                      {isWithdrawCancellationConfirming && onCancelWithdrawCancellation && (
                        <button type="button" className="confirm-cancel-x reject-cancel-x" onClick={onCancelWithdrawCancellation}>✕</button>
                      )}
                    </div>
                  )}

                  {/* Cancel Edit Request — requester */}
                  {isViewingEditRequest && isRequesterOnly && onCancelPendingEditRequest && (
                    <div className="confirm-button-group">
                      <button
                        type="button"
                        className={`action-btn reject-btn ${isCancelEditRequestConfirming ? 'confirming' : ''}`}
                        onClick={onCancelPendingEditRequest}
                        disabled={isCancelingEditRequest || (anyConfirming && !isCancelEditRequestConfirming)}
                      >
                        {isCancelingEditRequest ? 'Canceling...' : (isCancelEditRequestConfirming ? '⚠️ Confirm Cancel?' : '🚫 Cancel Edit Request')}
                      </button>
                      {isCancelEditRequestConfirming && onCancelCancelEditRequest && (
                        <button type="button" className="confirm-cancel-x reject-cancel-x" onClick={onCancelCancelEditRequest}>✕</button>
                      )}
                    </div>
                  )}

                  {/* Delete — admin delete */}
                  {!isRequesterOnly && mode === 'edit' && onDelete && itemStatus !== 'deleted' && !isViewingEditRequest && existingCancellationRequest?.status !== 'pending' && (
                    <div className="confirm-button-group">
                      <button
                        type="button"
                        className={`action-btn delete-btn ${isDeleteConfirming ? 'confirming' : ''}`}
                        onClick={onDelete}
                        disabled={isDeleting || (anyConfirming && !isDeleteConfirming)}
                      >
                        {isDeleting ? 'Deleting...' : (isDeleteConfirming ? 'Confirm Delete?' : 'Delete')}
                      </button>
                      {isDeleteConfirming && onCancelDelete && (
                        <button type="button" className="confirm-cancel-x delete-cancel-x" onClick={onCancelDelete}>✕</button>
                      )}
                    </div>
                  )}

                  {/* ── GROUP 5: Close (always last) ── */}
                  <button
                    type="button"
                    className="action-btn cancel-btn"
                    onClick={onClose}
                    disabled={anyConfirming}
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
              className={`event-type-tab ${activeTab === 'additional' ? 'active' : ''} ${!areDetailsComplete ? 'disabled' : ''}`}
              onClick={() => areDetailsComplete && setActiveTab('additional')}
              title={!areDetailsComplete ? 'Fill in event dates and times first' : undefined}
            >
              Additional Info
            </div>
            <div
              className={`event-type-tab ${activeTab === 'services' ? 'active' : ''} ${!areDetailsComplete ? 'disabled' : ''}`}
              onClick={() => areDetailsComplete && setActiveTab('services')}
              title={!areDetailsComplete ? 'Fill in event dates and times first' : undefined}
            >
              Services
              {hasServices && <span className="tab-active-dot" />}
            </div>
            {/* Recurrence tab — visible when recurrence exists OR user can create one */}
            {(hasRecurrence || canEditRecurrence) && (
              <div
                className={`event-type-tab ${activeTab === 'recurrence' ? 'active' : ''} ${(!areDetailsComplete || isRecurrenceTabDisabled) ? 'disabled' : ''}`}
                onClick={() => areDetailsComplete && !isRecurrenceTabDisabled && setActiveTab('recurrence')}
                title={recurrenceTabTitle}
              >
                Recurrence
                {hasRecurrence && <span className="tab-active-dot" />}
              </div>
            )}
            <div
              className={`event-type-tab ${activeTab === 'attachments' ? 'active' : ''} ${!areDetailsComplete ? 'disabled' : ''}`}
              onClick={() => areDetailsComplete && setActiveTab('attachments')}
              title={!areDetailsComplete ? 'Fill in event dates and times first' : undefined}
            >
              {attachmentCount > 0 ? `Attachments (${attachmentCount})` : 'Attachments'}
            </div>
            {!isRequesterOnly && (
              <div
                className={`event-type-tab ${activeTab === 'history' ? 'active' : ''} ${!areDetailsComplete ? 'disabled' : ''}`}
                onClick={() => areDetailsComplete && setActiveTab('history')}
                title={!areDetailsComplete ? 'Fill in event dates and times first' : undefined}
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
        <div style={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="review-modal-scroll-area">
            <div className="review-modal-scroll-content">
              {/* Cancellation request banner — shown to approvers */}
              {existingCancellationRequest?.status === 'pending' && !isRequesterOnly && (
                <div className="cancellation-request-banner">
                  <div className="cancellation-banner-header">Cancellation Requested</div>
                  <div className="cancellation-banner-reason">{existingCancellationRequest.reason}</div>
                  <div className="cancellation-banner-requester">
                    Requested by {existingCancellationRequest.requestedBy?.name || existingCancellationRequest.requestedBy?.email || 'Unknown'}
                    {existingCancellationRequest.requestedBy?.requestedAt && (
                      <> on {new Date(existingCancellationRequest.requestedBy.requestedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                    )}
                  </div>
                </div>
              )}

              {React.isValidElement(children)
                ? React.cloneElement(children, { activeTab, setActiveTab, isEditRequestMode, isViewingEditRequest, originalData, onRecurrenceExists: setLiveHasRecurrence, onServicesExist: setHasServices, onHasUncommittedRecurrence, createRecurrenceRef, onDetailsCompleteChange: setAreDetailsComplete })
                : children
              }
            </div>
          </div>

          {/* Loading Overlay for Series Navigation */}
          {isNavigating && (
            <LoadingSpinner variant="overlay" size={40} text="Loading..." />
          )}
        </div>

        {/* Edit Request Mode - show change count or prompt to make changes */}
        {isEditRequestMode && detectedChanges.length === 0 && (
          <div className="edit-request-no-changes">
            Make at least one change to submit an edit request.
          </div>
        )}

        {/* Recurrence Warning Dialog - shown when saving draft with uncommitted recurrence edits */}
        {showRecurrenceWarning && (
          <RecurrenceWarningDialog
            isOpen={showRecurrenceWarning}
            onCreateAndSave={onRecurrenceWarningCreateAndSave}
            onSaveWithout={onRecurrenceWarningSaveWithout}
            onCancel={onRecurrenceWarningCancel}
            saving={savingDraft}
          />
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

        {/* Duplicate Date Dialog - shown when user clicks Duplicate */}
        <DuplicateDateDialog
          isOpen={showDuplicateDialog}
          onClose={onDuplicateClose}
          onSubmit={onDuplicateSubmit}
          eventTitle={duplicateEventTitle}
          sourceEventDate={duplicateSourceDate}
          submitting={submittingDuplicate}
        />

        {/* Discard Dialog - shown when closing pending edit with unsaved changes */}
        <DiscardChangesDialog
          isOpen={showDiscardDialog}
          onDiscard={onDiscardDialogDiscard}
          onKeepEditing={onDiscardDialogCancel}
        />
      </div>
      )}{/* end content gate */}
    </div>
  );

  return createPortal(modalContent, document.body);
}
