// src/hooks/useReviewModal.jsx
import { useState, useCallback } from 'react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';

/**
 * useReviewModal - Custom hook for managing review modal state and API calls
 *
 * Handles:
 * - Modal open/close state
 * - Current reservation/event data
 * - Dirty state tracking (hasChanges)
 * - API calls for approve/reject/save
 * - Soft hold management (for preventing concurrent edits)
 *
 * @param {string} apiToken - JWT token for API authentication
 * @param {string} graphToken - Graph API token (optional, for calendar operations)
 * @param {Function} onSuccess - Callback after successful action
 * @param {Function} onError - Callback after error
 */
export function useReviewModal({ apiToken, graphToken, onSuccess, onError, selectedCalendarId }) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentItem, setCurrentItem] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [editableData, setEditableData] = useState(null);
  const [originalChangeKey, setOriginalChangeKey] = useState(null);

  // Inline confirmation state for delete action
  const [pendingDeleteConfirmation, setPendingDeleteConfirmation] = useState(false);

  // Inline confirmation state for approve/reject actions
  const [pendingApproveConfirmation, setPendingApproveConfirmation] = useState(false);
  const [pendingRejectConfirmation, setPendingRejectConfirmation] = useState(false);

  // Inline confirmation state for save action
  const [pendingSaveConfirmation, setPendingSaveConfirmation] = useState(false);

  // Soft hold state
  const [reviewHold, setReviewHold] = useState(null);
  const [holdTimer, setHoldTimer] = useState(null);
  const [holdError, setHoldError] = useState(null);

  // Edit scope for recurring events: 'thisEvent' | 'allEvents' | null
  const [editScope, setEditScope] = useState(null);

  // Form validity state (controlled by child form component)
  const [isFormValid, setIsFormValid] = useState(true);

  /**
   * Open modal with a reservation or event
   * @param {Object} item - The reservation or event to open
   * @param {Object} options - Optional settings
   * @param {string} options.editScope - For recurring events: 'thisEvent' or 'allEvents'
   */
  const openModal = useCallback(async (item, options = {}) => {
    if (!item) return;

    const { editScope: scope = null } = options;

    // Try to acquire soft hold if item is pending
    if (item.status === 'pending' && !item._isNewUnifiedEvent) {
      const holdAcquired = await acquireReviewHold(item._id);
      if (!holdAcquired && holdError) {
        return; // Block if someone else is reviewing
      }
    }

    setCurrentItem(item);
    setEditableData(item);
    setOriginalChangeKey(item.changeKey);
    setHasChanges(false);
    setEditScope(scope);
    setIsOpen(true);
  }, [apiToken]);

  /**
   * Close modal and release any holds
   */
  const closeModal = useCallback(async () => {
    // Only release hold if one was actually acquired (reviewHold state exists)
    if (reviewHold && currentItem) {
      await releaseReviewHold(currentItem._id);
    }

    setIsOpen(false);
    setCurrentItem(null);
    setEditableData(null);
    setOriginalChangeKey(null);
    setHasChanges(false);
    setPendingDeleteConfirmation(false); // Reset delete confirmation
    setEditScope(null); // Reset edit scope for recurring events
  }, [currentItem, reviewHold]);

  /**
   * Acquire soft hold when opening review modal
   */
  const acquireReviewHold = async (reservationId) => {
    try {
      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${reservationId}/start-review`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiToken}`
          }
        }
      );

      if (response.status === 423) {
        const data = await response.json();
        setHoldError(
          `This reservation is currently being reviewed by ${data.reviewingBy}. ` +
          `The hold will expire in ${data.minutesRemaining} minutes.`
        );
        return false;
      }

      if (!response.ok) {
        throw new Error('Failed to acquire review hold');
      }

      const data = await response.json();
      const expiresAt = new Date(data.reviewExpiresAt);

      setReviewHold({
        expiresAt,
        durationMinutes: data.durationMinutes
      });
      setHoldError(null);

      // Set up countdown timer
      const timer = setInterval(() => {
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) {
          setHoldError('Your review session has expired. Please reopen the modal to continue.');
          closeModal();
        }
      }, 60000); // Check every minute

      setHoldTimer(timer);
      return true;
    } catch (error) {
      logger.error('Failed to acquire review hold:', error);
      setHoldError(null);
      return true; // Allow modal to open without hold
    }
  };

  /**
   * Release soft hold when closing modal
   */
  const releaseReviewHold = async (reservationId) => {
    if (holdTimer) {
      clearInterval(holdTimer);
      setHoldTimer(null);
    }

    if (!reservationId) return;

    try {
      await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${reservationId}/release-review`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiToken}`
          }
        }
      );
    } catch (error) {
      logger.error('Failed to release hold:', error);
    }

    setReviewHold(null);
    setHoldError(null);
  };

  /**
   * Update editable data
   */
  const updateData = useCallback((updates) => {
    console.log('[useReviewModal.updateData] Called with updates:', Object.keys(updates || {}));
    setEditableData(prev => ({
      ...prev,
      ...updates
    }));
    console.log('[useReviewModal.updateData] Setting hasChanges to true');
    setHasChanges(true);
    // Reset delete confirmation when form data changes
    if (pendingDeleteConfirmation) {
      setPendingDeleteConfirmation(false);
    }
  }, [pendingDeleteConfirmation]);

  /**
   * Save changes to the reservation/event
   * Two-step confirmation: first click shows confirmation, second click executes
   */
  const handleSave = useCallback(async () => {
    if (!hasChanges || !currentItem) return;

    // First click - show confirmation
    if (!pendingSaveConfirmation) {
      setPendingSaveConfirmation(true);
      setPendingApproveConfirmation(false); // Clear other confirmations
      setPendingRejectConfirmation(false);
      setPendingDeleteConfirmation(false);
      return;
    }

    // Second click - execute save
    setPendingSaveConfirmation(false);
    setIsSaving(true);
    try {
      // All events (including pending reservations) are now stored in templeEvents__Events
      // Use the unified events endpoint for all saves
      const isGraphEvent = currentItem.calendarId && !currentItem.status;
      const endpoint = `${APP_CONFIG.API_BASE_URL}/admin/events/${currentItem._id}`;

      // Add graphToken for Graph events
      // Convert requestedRooms to locations for backward compatibility
      const bodyData = {
        ...editableData,
        locations: editableData.requestedRooms || editableData.locations,
        graphToken: isGraphEvent ? graphToken : undefined,
        // Include edit scope for recurring events
        editScope: editScope,
        // For 'thisEvent' scope, include occurrence identification data
        occurrenceDate: editScope === 'thisEvent' ? currentItem.start?.dateTime : null,
        seriesMasterId: editScope ? (currentItem.seriesMasterId || currentItem.graphData?.seriesMasterId || currentItem.graphData?.id) : null
      };

      // Remove requestedRooms to avoid confusion (locations is the single source of truth)
      delete bodyData.requestedRooms;

      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
          'If-Match': originalChangeKey || ''
        },
        body: JSON.stringify(bodyData)
      });

      if (response.status === 409) {
        const data = await response.json();
        const changes = data.changes || [];
        const changesList = changes.map(c => `- ${c.field}: ${c.oldValue} → ${c.newValue}`).join('\n');

        const message =
          `This item was modified by ${data.lastModifiedBy} while you were editing.\n\n` +
          `Changes made:\n${changesList}\n\n` +
          `Your changes have NOT been saved. Please refresh to see the latest version.`;

        if (onError) onError(message);
        return { success: false, error: message };
      }

      if (!response.ok) {
        throw new Error(`Failed to save changes: ${response.status}`);
      }

      const result = await response.json();
      setOriginalChangeKey(result.changeKey);
      setHasChanges(false);

      if (onSuccess) onSuccess(result);
      return { success: true, data: result };
    } catch (error) {
      logger.error('Error saving changes:', error);
      if (onError) onError(error.message);
      return { success: false, error: error.message };
    } finally {
      setIsSaving(false);
    }
  }, [hasChanges, currentItem, editableData, originalChangeKey, apiToken, graphToken, editScope, onSuccess, onError, pendingSaveConfirmation]);

  /**
   * Approve the reservation/event
   * Uses two-step inline confirmation
   */
  const handleApprove = useCallback(async (approvalData = {}) => {
    if (!currentItem) return;

    // Two-step confirmation: First click shows confirmation, second click approves
    if (!pendingApproveConfirmation) {
      setPendingApproveConfirmation(true);
      setPendingRejectConfirmation(false); // Clear reject confirmation if any
      setPendingDeleteConfirmation(false); // Clear delete confirmation if any
      return { success: false, cancelled: true, needsConfirmation: true };
    }

    // Second click: User confirmed, proceed with approval
    setPendingApproveConfirmation(false);
    setIsApproving(true);

    try {
      // Filter out React synthetic events (e.g., click events passed as first argument)
      // These have nativeEvent property and cause "Converting circular structure to JSON" errors
      const safeApprovalData = (approvalData && typeof approvalData === 'object' && !approvalData.nativeEvent)
        ? approvalData
        : {};

      // Step 1: Create the Graph calendar event using the same audit-update endpoint as normal event creation
      let graphEventId = null;
      if (safeApprovalData.createCalendarEvent !== false && graphToken && selectedCalendarId) {
        try {
          // Build graphFields from the pending reservation data
          const graphFields = {
            subject: currentItem.graphData?.subject || currentItem.eventTitle || 'Untitled Event',
            start: currentItem.graphData?.start,
            end: currentItem.graphData?.end,
            location: currentItem.graphData?.location || { displayName: '' },
            categories: currentItem.graphData?.categories || [],
            body: currentItem.graphData?.body || { contentType: 'Text', content: currentItem.graphData?.bodyPreview || '' }
          };

          logger.info('Creating Graph event for approval via audit-update:', { subject: graphFields.subject, calendarId: selectedCalendarId });

          // Use the same audit-update endpoint that normal event creation uses
          const auditResponse = await fetch(`${APP_CONFIG.API_BASE_URL}/events/new/audit-update`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              graphFields,
              internalFields: currentItem.internalData || null,
              calendarId: selectedCalendarId,
              graphToken
            })
          });

          if (!auditResponse.ok) {
            const errorText = await auditResponse.text();
            throw new Error(`Failed to create calendar event: ${auditResponse.status} - ${errorText}`);
          }

          const auditResult = await auditResponse.json();
          // The response structure is { event: { ...graphData, ...internalData }, ... }
          // The Graph event ID is at event.id (spread from graphData)
          graphEventId = auditResult.event?.id;
          logger.info('Graph event created successfully via audit-update:', { graphEventId, auditResult });

          if (!graphEventId) {
            throw new Error('Failed to create Graph event - no ID returned');
          }
        } catch (graphError) {
          logger.error('Failed to create Graph event:', graphError);
          if (onError) onError(`Failed to create calendar event: ${graphError.message}`);
          return { success: false, error: graphError.message };
        }
      }

      // Step 2: Update the approval status in the backend
      const endpoint = `${APP_CONFIG.API_BASE_URL}/admin/events/${currentItem._id}/approve`;

      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
          'If-Match': originalChangeKey || currentItem.changeKey || ''
        },
        body: JSON.stringify({
          graphToken,
          notes: safeApprovalData.notes || '',
          calendarMode: safeApprovalData.calendarMode || 'production',
          createCalendarEvent: false, // We already created it via audit-update
          forceApprove: safeApprovalData.forceApprove || false,
          targetCalendar: safeApprovalData.targetCalendar || selectedCalendarId || ''
        })
      });

      if (response.status === 409) {
        const data = await response.json();
        if (data.error === 'SchedulingConflict') {
          const message = `Cannot approve: ${data.conflicts?.length || 0} scheduling conflict(s) detected.`;
          if (onError) onError(message, data.conflicts);
          return { success: false, error: message, conflicts: data.conflicts };
        }
      }

      if (!response.ok) {
        throw new Error(`Failed to approve: ${response.status}`);
      }

      const result = await response.json();
      if (onSuccess) onSuccess(result);
      await closeModal();
      return { success: true, data: result };
    } catch (error) {
      logger.error('Error approving:', error);
      if (onError) onError(error.message);
      return { success: false, error: error.message };
    } finally {
      setIsApproving(false);
    }
  }, [currentItem, originalChangeKey, apiToken, graphToken, selectedCalendarId, onSuccess, onError, closeModal, pendingApproveConfirmation]);

  /**
   * Reject the reservation/event
   * Uses two-step inline confirmation
   */
  const handleReject = useCallback(async (reason) => {
    // Two-step confirmation: First click shows confirmation, second click rejects
    if (!pendingRejectConfirmation) {
      setPendingRejectConfirmation(true);
      setPendingApproveConfirmation(false); // Clear approve confirmation if any
      setPendingDeleteConfirmation(false); // Clear delete confirmation if any
      return { success: false, cancelled: true, needsConfirmation: true };
    }

    // Second click: User confirmed, proceed with rejection
    setPendingRejectConfirmation(false);

    if (!currentItem || !reason?.trim()) {
      const message = 'Please provide a reason for rejection';
      if (onError) onError(message);
      return { success: false, error: message };
    }

    try {
      // All events (including pending reservations) are now stored in templeEvents__Events
      // Use the unified events endpoint for all rejections
      const endpoint = `${APP_CONFIG.API_BASE_URL}/admin/events/${currentItem._id}/reject`;

      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({ reason })
      });

      if (!response.ok) {
        throw new Error('Failed to reject');
      }

      const result = await response.json();
      if (onSuccess) onSuccess(result);
      await closeModal();
      return { success: true, data: result };
    } catch (error) {
      logger.error('Error rejecting:', error);
      if (onError) onError(error.message);
      return { success: false, error: error.message };
    }
  }, [currentItem, apiToken, onSuccess, onError, closeModal, pendingRejectConfirmation]);

  /**
   * Delete the event (Graph event or internal event)
   * Uses two-step inline confirmation instead of browser popup
   */
  const handleDelete = useCallback(async () => {
    if (!currentItem) return;

    // Two-step confirmation: First click shows confirmation, second click deletes
    if (!pendingDeleteConfirmation) {
      // First click: Set pending confirmation state and return
      console.log('DEBUG: Delete button first click - showing confirmation');
      setPendingDeleteConfirmation(true);
      setPendingApproveConfirmation(false); // Clear approve confirmation if any
      setPendingRejectConfirmation(false); // Clear reject confirmation if any
      return { success: false, cancelled: true, needsConfirmation: true };
    }

    // Second click: User confirmed, proceed with deletion
    console.log('DEBUG: Delete button second click - deleting');
    setPendingDeleteConfirmation(false); // Reset confirmation state
    setIsDeleting(true);
    try {
      // All events (including pending reservations) are now stored in templeEvents__Events
      // Use the unified events endpoint for all deletions
      const endpoint = `${APP_CONFIG.API_BASE_URL}/admin/events/${currentItem._id}`;

      const response = await fetch(endpoint, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          graphToken: graphToken, // Always pass graphToken - backend will use it if needed
          // Include edit scope for recurring events
          editScope: editScope,
          // For 'thisEvent' scope, include occurrence identification data
          occurrenceDate: editScope === 'thisEvent' ? currentItem.start?.dateTime : null,
          seriesMasterId: editScope ? (currentItem.seriesMasterId || currentItem.graphData?.seriesMasterId || currentItem.graphData?.id) : null,
          calendarId: currentItem.calendarId
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to delete: ${response.status}`);
      }

      const result = await response.json();
      if (onSuccess) onSuccess({ ...result, deleted: true });
      await closeModal();
      return { success: true, data: result };
    } catch (error) {
      logger.error('Error deleting:', error);
      if (onError) onError(error.message);
      return { success: false, error: error.message };
    } finally {
      setIsDeleting(false);
    }
  }, [currentItem, apiToken, graphToken, editScope, onSuccess, onError, closeModal, pendingDeleteConfirmation]);

  // Cancel confirmation functions
  const cancelDeleteConfirmation = useCallback(() => {
    setPendingDeleteConfirmation(false);
  }, []);

  const cancelApproveConfirmation = useCallback(() => {
    setPendingApproveConfirmation(false);
  }, []);

  const cancelRejectConfirmation = useCallback(() => {
    setPendingRejectConfirmation(false);
  }, []);

  const cancelSaveConfirmation = useCallback(() => {
    setPendingSaveConfirmation(false);
  }, []);

  return {
    // State
    isOpen,
    currentItem,
    editableData,
    hasChanges,
    isFormValid,
    isSaving,
    isDeleting,
    isApproving,
    holdError,
    reviewHold,
    pendingDeleteConfirmation,
    pendingApproveConfirmation,
    pendingRejectConfirmation,
    pendingSaveConfirmation,
    editScope, // For recurring events: 'thisEvent' | 'allEvents' | null

    // Actions
    openModal,
    closeModal,
    updateData,
    setIsFormValid,
    handleSave,
    handleApprove,
    handleReject,
    handleDelete,
    cancelDeleteConfirmation,
    cancelApproveConfirmation,
    cancelRejectConfirmation,
    cancelSaveConfirmation
  };
}
