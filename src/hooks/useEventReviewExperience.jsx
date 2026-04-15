/**
 * useEventReviewExperience — Unified modal experience for reviewing events.
 *
 * Wraps useReviewModal and absorbs all satellite state that was previously
 * duplicated across Calendar.jsx, MyReservations.jsx, and ReservationRequests.jsx:
 *   - Edit request viewing (existingEditRequest, isViewingEditRequest, etc.)
 *   - Edit request mode (isEditRequestMode, computeDetectedChanges, etc.)
 *   - Cancel pending edit request (isCancelingEditRequest, confirmation state)
 *   - Cancellation request (isCancellationRequestMode, cancellationReason, etc.)
 *
 * Consumers only provide: API auth, callbacks (onSuccess/onError/onRefresh),
 * and genuinely-unique props via EventReviewExperience component.
 */
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useReviewModal } from './useReviewModal';
import { useNotification } from '../context/NotificationContext';
import { transformEventToFlatStructure } from '../utils/eventTransformers';
import {
  buildEditRequestViewData,
  computeApproverChanges,
  computeDetectedChanges as computeDetectedChangesUtil,
} from '../utils/editRequestUtils';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';

/**
 * @param {Object} config
 * @param {string} config.apiToken - API bearer token
 * @param {string} [config.graphToken] - Graph API token (Calendar only)
 * @param {string} [config.selectedCalendarId] - Target calendar ID for publishing
 * @param {Function} config.onSuccess - Called after successful useReviewModal actions (save/approve/reject/etc.)
 * @param {Function} [config.onError] - Called on useReviewModal errors
 * @param {Function} [config.authFetch] - Authenticated fetch function (from useAuthenticatedFetch).
 *   Calendar passes a thin wrapper instead: (url, opts) => fetch(url, { ...opts, headers: { Authorization } })
 * @param {Function} [config.onRefresh] - Called after cancel-edit, submit-cancellation, withdraw.
 *   CONTRACT: callers must handle both data reload AND badge dispatch (dispatchRefresh).
 *   The hook does NOT call dispatchRefresh internally.
 */
export function useEventReviewExperience({
  apiToken,
  graphToken,
  selectedCalendarId,
  onSuccess,
  onError,
  authFetch,
  onRefresh,
}) {
  const { showSuccess, showError } = useNotification();

  // =========================================================================
  // SATELLITE STATE — declared first so wrappedOnSuccess can reference setters
  // =========================================================================

  // Edit request mode (requester creating a new edit request)
  const [isEditRequestMode, setIsEditRequestMode] = useState(false);
  const [originalEventData, setOriginalEventData] = useState(null);

  // Stabilize authFetch via ref so doFetch has a stable identity even when
  // callers pass an inline arrow (Calendar.jsx). Prevents effect re-fires.
  const authFetchRef = useRef(authFetch);
  useEffect(() => { authFetchRef.current = authFetch; }, [authFetch]);

  const doFetch = useCallback((url, opts = {}) => {
    if (authFetchRef.current) return authFetchRef.current(url, opts);
    return fetch(url, {
      ...opts,
      headers: {
        ...opts.headers,
        'Authorization': `Bearer ${apiToken}`,
      },
    });
  }, [apiToken]);

  // Wrap onSuccess to reset satellite state before calling consumer's callback
  const wrappedOnSuccess = useCallback((result) => {
    setIsEditRequestMode(false);
    setOriginalEventData(null);
    onSuccess?.(result);
  }, [onSuccess]);

  // Core review modal hook
  const reviewModal = useReviewModal({
    apiToken,
    graphToken,
    selectedCalendarId,
    onSuccess: wrappedOnSuccess,
    onError,
  });

  // Transform originalEventData to flat structure for inline diff comparison.
  // Always apply the transform for consistency — it's idempotent on already-flat data.
  const flatOriginalEventData = useMemo(() =>
    originalEventData ? transformEventToFlatStructure(originalEventData) : null,
  [originalEventData]);

  // Existing edit request state (for viewing pending edit requests)
  const [existingEditRequest, setExistingEditRequest] = useState(null);
  const [isViewingEditRequest, setIsViewingEditRequest] = useState(false);
  const [loadingEditRequest, setLoadingEditRequest] = useState(false);

  // Cancel pending edit request state (requester withdrawing their own edit request)
  const [isCancelingEditRequest, setIsCancelingEditRequest] = useState(false);
  const [isCancelEditRequestConfirming, setIsCancelEditRequestConfirming] = useState(false);

  // Cancellation request state (requester requesting cancellation of published event)
  const [isCancellationRequestMode, setIsCancellationRequestMode] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');
  const [isSubmittingCancellationRequest, setIsSubmittingCancellationRequest] = useState(false);

  // =========================================================================
  // EDIT REQUEST VIEWING HANDLERS
  // =========================================================================

  /**
   * Extract edit request metadata from an event.
   * Uses Calendar's async version with API fallback for events loaded without embedded data.
   */
  const fetchExistingEditRequest = useCallback(async (event, viewingEditScope) => {
    if (!event) return null;

    // Resolve the event's start date across all possible field locations.
    // Events arrive in different shapes depending on source (calendar expansion,
    // API response, list view), so we check multiple paths.
    const resolveEventDate = (evt) =>
      evt.startDate || evt.calendarData?.startDate
      || evt.startDateTime?.split('T')[0] || evt.start?.dateTime?.split('T')[0];

    // Check whether an edit request targets a different occurrence than the current event.
    // Returns true when the edit should be hidden from this view.
    const isEditForDifferentOccurrence = (editReq, evt) =>
      editReq?.editScope === 'thisEvent'
      && editReq.occurrenceDate
      && resolveEventDate(evt) !== editReq.occurrenceDate;

    // Series-level view ('allEvents') should not show occurrence-scoped edits ('thisEvent').
    // The reverse is fine: viewing one occurrence should show series-wide edits since they affect it.
    const isScopeMismatch = (editReq, viewScope) =>
      viewScope === 'allEvents' && editReq?.editScope === 'thisEvent';

    setLoadingEditRequest(true);
    try {
      // EMBEDDED MODEL: Check for pendingEditRequest directly on the event
      const pendingReq = event.pendingEditRequest;
      if (pendingReq?.status === 'pending') {
        // Skip occurrence-scoped edit requests when viewing the whole series.
        // The edit's proposedChanges are computed against that occurrence's baseline —
        // showing them on the master or a different occurrence would display no/wrong diffs.
        if (isScopeMismatch(pendingReq, viewingEditScope)) {
          return null;
        }
        if (isEditForDifferentOccurrence(pendingReq, event)) {
          return null;
        }
        return {
          _id: event._id,
          editRequestId: pendingReq.id,
          status: pendingReq.status,
          requestedBy: pendingReq.requestedBy,
          changeReason: pendingReq.changeReason,
          proposedChanges: pendingReq.proposedChanges,
          reviewedBy: pendingReq.reviewedBy,
          reviewedAt: pendingReq.reviewedAt,
          reviewNotes: pendingReq.reviewNotes,
          createdAt: pendingReq.requestedBy?.requestedAt,
        };
      }

      // Calendar-expanded occurrences had pendingEditRequest scoped by Calendar.jsx.
      // Absence means the edit doesn't target this occurrence — skip the API fallback
      // which would re-fetch the master's edit request and bypass that scoping.
      if (event.isRecurringOccurrence) {
        return null;
      }

      // Fallback: API call for events loaded without full data (e.g., from list views)
      const eventId = event._id || event.eventId;
      if (!eventId || !apiToken) return null;

      const response = await doFetch(
        `${APP_CONFIG.API_BASE_URL}/events/${eventId}/edit-requests`
      );

      if (response.ok) {
        const data = await response.json();
        const pendingRequest = data.editRequests?.find(r => r.status === 'pending');
        if (isScopeMismatch(pendingRequest, viewingEditScope)) {
          return null;
        }
        if (isEditForDifferentOccurrence(pendingRequest, event)) {
          return null;
        }
        return pendingRequest || null;
      }
      return null;
    } catch (err) {
      logger.error('Error fetching edit requests:', err);
      return null;
    } finally {
      setLoadingEditRequest(false);
    }
  }, [apiToken, doFetch]);

  /**
   * Effect: Check for existing edit requests on modal open transition.
   * Uses prevIsOpenRef to fire only once on open (not on item swaps mid-session).
   * Resets all satellite state on close transition.
   */
  const prevIsOpenRef = useRef(false);
  useEffect(() => {
    const justOpened = reviewModal.isOpen && !prevIsOpenRef.current;
    const justClosed = !reviewModal.isOpen && prevIsOpenRef.current;
    prevIsOpenRef.current = reviewModal.isOpen;

    if (justOpened && reviewModal.currentItem?.status === 'published') {
      fetchExistingEditRequest(reviewModal.currentItem, reviewModal.editScope).then(setExistingEditRequest);
    } else if (justClosed) {
      // Reset ALL satellite state on modal close (single cleanup point)
      setExistingEditRequest(null);
      setIsViewingEditRequest(false);
      setOriginalEventData(null);
      setIsEditRequestMode(false);
      setIsCancelEditRequestConfirming(false);
      setIsCancelingEditRequest(false);
      setIsCancellationRequestMode(false);
      setCancellationReason('');
      setIsSubmittingCancellationRequest(false);
    }
  }, [reviewModal.isOpen, reviewModal.currentItem, fetchExistingEditRequest]);

  /** Overlay proposed changes onto the form (view edit request mode) */
  const handleViewEditRequest = useCallback(() => {
    if (existingEditRequest) {
      const currentData = reviewModal.editableData;
      if (currentData) {
        setOriginalEventData(JSON.parse(JSON.stringify(currentData)));
      }
      reviewModal.replaceEditableData(
        buildEditRequestViewData(reviewModal.currentItem, currentData)
      );
      setIsViewingEditRequest(true);
    }
  }, [existingEditRequest, reviewModal]);

  /** Toggle back to the original published event */
  const handleViewOriginalEvent = useCallback(() => {
    if (originalEventData) {
      reviewModal.replaceEditableData(originalEventData);
      setIsViewingEditRequest(false);
    }
  }, [originalEventData, reviewModal]);

  // =========================================================================
  // EDIT REQUEST MODE HANDLERS (requester creating new edit request)
  // =========================================================================

  /** Enter edit request mode — stores original data for diff comparison */
  const handleRequestEdit = useCallback(() => {
    const currentData = reviewModal.editableData;
    if (currentData) {
      setOriginalEventData(JSON.parse(JSON.stringify(currentData)));
    }
    setIsEditRequestMode(true);
  }, [reviewModal.editableData]);

  /** Cancel edit request mode — reverts form to original data via replaceEditableData (forces remount) */
  const handleCancelEditRequest = useCallback(() => {
    setIsEditRequestMode(false);
    // Revert to original data (replaceEditableData forces remount via reinitKey)
    if (originalEventData && reviewModal.editableData) {
      reviewModal.replaceEditableData(originalEventData);
    }
    setOriginalEventData(null);
  }, [originalEventData, reviewModal]);

  /** Compute detected changes using shared utility */
  const computeDetectedChanges = useCallback(() => {
    if (!isEditRequestMode) return [];
    return computeDetectedChangesUtil(originalEventData, reviewModal.editableData);
  }, [originalEventData, reviewModal.editableData, isEditRequestMode]);

  /** Submit edit request — wraps reviewModal.handleSubmitEditRequest with change detection */
  const handleSubmitEditRequest = useCallback(() => {
    return reviewModal.handleSubmitEditRequest(computeDetectedChanges);
  }, [reviewModal, computeDetectedChanges]);

  // =========================================================================
  // EDIT REQUEST APPROVE/REJECT WRAPPERS (admin actions)
  // =========================================================================

  const handleApproveEditRequest = useCallback(() => {
    const approverChanges = computeApproverChanges(reviewModal.editableData, originalEventData);
    return reviewModal.handleApproveEditRequest(approverChanges);
  }, [reviewModal, originalEventData]);

  // handleRejectEditRequest: no wrapper needed — comes through ...reviewModal spread

  // =========================================================================
  // CANCEL PENDING EDIT REQUEST (requester withdrawing own edit request)
  // =========================================================================

  const handleCancelPendingEditRequest = useCallback(async () => {
    // First click: show confirmation
    if (!isCancelEditRequestConfirming) {
      setIsCancelEditRequestConfirming(true);
      return;
    }

    // Second click: confirm
    const currentItem = reviewModal.currentItem;
    if (!currentItem || !existingEditRequest) {
      logger.error('No edit request to cancel');
      return;
    }

    try {
      setIsCancelingEditRequest(true);
      const eventId = currentItem._id || currentItem.eventId;

      const response = await doFetch(
        `${APP_CONFIG.API_BASE_URL}/events/edit-requests/${eventId}/cancel`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to cancel edit request');
      }

      logger.info('Edit request canceled:', eventId);

      // Reset state
      setIsCancelEditRequestConfirming(false);
      setIsViewingEditRequest(false);
      setExistingEditRequest(null);
      setOriginalEventData(null);

      reviewModal.closeModal();
      onRefresh?.();
    } catch (error) {
      logger.error('Error canceling edit request:', error);
      showError(`Failed to cancel edit request: ${error.message}`);
    } finally {
      setIsCancelingEditRequest(false);
      setIsCancelEditRequestConfirming(false);
    }
  }, [isCancelEditRequestConfirming, reviewModal, existingEditRequest, doFetch, onRefresh, showError]);

  const cancelCancelEditRequestConfirmation = useCallback(() => {
    setIsCancelEditRequestConfirming(false);
  }, []);

  // =========================================================================
  // CANCELLATION REQUEST HANDLERS (requester requesting event cancellation)
  // =========================================================================

  const handleRequestCancellation = useCallback(() => {
    setIsCancellationRequestMode(true);
    setCancellationReason('');
  }, []);

  const handleCancelCancellationRequest = useCallback(() => {
    setIsCancellationRequestMode(false);
    setCancellationReason('');
  }, []);

  const handleSubmitCancellationRequest = useCallback(async () => {
    const currentItem = reviewModal.currentItem;
    if (!currentItem || !cancellationReason.trim()) return;

    setIsSubmittingCancellationRequest(true);
    try {
      const eventId = currentItem._id || currentItem.eventId;
      const response = await doFetch(
        `${APP_CONFIG.API_BASE_URL}/events/${eventId}/request-cancellation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: cancellationReason.trim(),
            _version: currentItem._version,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit cancellation request');
      }

      showSuccess('Cancellation request submitted');
      setIsCancellationRequestMode(false);
      setCancellationReason('');
      reviewModal.closeModal();
      onRefresh?.();
    } catch (error) {
      showError(error, { context: 'submitCancellationRequest' });
    } finally {
      setIsSubmittingCancellationRequest(false);
    }
  }, [reviewModal, cancellationReason, doFetch, onRefresh, showSuccess, showError]);

  // =========================================================================
  // RETURN
  // =========================================================================

  return {
    // All useReviewModal return values (passthrough)
    ...reviewModal,

    // Edit request viewing
    existingEditRequest,
    isViewingEditRequest,
    loadingEditRequest,
    handleViewEditRequest,
    handleViewOriginalEvent,

    // Edit request mode (creating new edit request)
    isEditRequestMode,
    handleRequestEdit,
    handleCancelEditRequest,
    computeDetectedChanges,
    handleSubmitEditRequest,

    // Edit request approve/reject (admin)
    handleApproveEditRequest,
    // handleRejectEditRequest comes through ...reviewModal spread

    // Cancel pending edit request (requester)
    isCancelingEditRequest,
    isCancelEditRequestConfirming,
    handleCancelPendingEditRequest,
    cancelCancelEditRequestConfirmation,

    // Cancellation request
    isCancellationRequestMode,
    cancellationReason,
    setCancellationReason,
    isSubmittingCancellationRequest,
    handleRequestCancellation,
    handleCancelCancellationRequest,
    handleSubmitCancellationRequest,

    // Inline diff data (originalEventData is internal — only flat version is public)
    flatOriginalEventData,

    // Config passthrough (needed by EventReviewExperience component)
    apiToken,
  };
}
