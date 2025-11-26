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
export function useReviewModal({ apiToken, graphToken, onSuccess, onError }) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentItem, setCurrentItem] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editableData, setEditableData] = useState(null);
  const [originalChangeKey, setOriginalChangeKey] = useState(null);

  // Inline confirmation state for delete action
  const [pendingDeleteConfirmation, setPendingDeleteConfirmation] = useState(false);

  // Soft hold state
  const [reviewHold, setReviewHold] = useState(null);
  const [holdTimer, setHoldTimer] = useState(null);
  const [holdError, setHoldError] = useState(null);

  // Edit scope for recurring events: 'thisEvent' | 'allEvents' | null
  const [editScope, setEditScope] = useState(null);

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
    setEditableData(prev => ({
      ...prev,
      ...updates
    }));
    setHasChanges(true);
    // Reset delete confirmation when form data changes
    if (pendingDeleteConfirmation) {
      setPendingDeleteConfirmation(false);
    }
  }, [pendingDeleteConfirmation]);

  /**
   * Save changes to the reservation/event
   */
  const handleSave = useCallback(async () => {
    if (!hasChanges || !currentItem) return;

    setIsSaving(true);
    try {
      // Determine event type and appropriate endpoint
      // 1. Graph events have id field and calendarId (synced from Microsoft calendar)
      // 2. Internal unified events have _isNewUnifiedEvent flag
      // 3. Room reservations have status field and _id
      const hasMongoId = !!currentItem._id;
      const isGraphEvent = currentItem.calendarId && !currentItem.status;
      const isNewUnifiedEvent = currentItem._isNewUnifiedEvent;
      const isRoomReservation = currentItem.status && (
        currentItem.status === 'pending' ||
        currentItem.status === 'room-reservation-request' ||
        currentItem.status === 'approved' ||
        currentItem.status === 'rejected'
      );

      let endpoint;
      if (isGraphEvent && hasMongoId) {
        // Graph event stored in our DB - update via admin/events endpoint
        endpoint = `${APP_CONFIG.API_BASE_URL}/admin/events/${currentItem._id}`;
      } else if (isNewUnifiedEvent) {
        // Internal unified event
        endpoint = `${APP_CONFIG.API_BASE_URL}/admin/events/${currentItem._id}`;
      } else if (isRoomReservation) {
        // Room reservation
        endpoint = `${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${currentItem._id}`;
      } else {
        throw new Error('Unable to determine event type for saving');
      }

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
  }, [hasChanges, currentItem, editableData, originalChangeKey, apiToken, graphToken, editScope, onSuccess, onError]);

  /**
   * Approve the reservation/event
   */
  const handleApprove = useCallback(async (approvalData = {}) => {
    if (!currentItem) return;

    try {
      const isNewUnifiedEvent = currentItem._isNewUnifiedEvent;
      const endpoint = isNewUnifiedEvent
        ? `${APP_CONFIG.API_BASE_URL}/admin/events/${currentItem._id}/approve`
        : `${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${currentItem._id}/approve`;

      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
          'If-Match': originalChangeKey || currentItem.changeKey || ''
        },
        body: JSON.stringify({
          graphToken,
          ...approvalData
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
    }
  }, [currentItem, originalChangeKey, apiToken, graphToken, onSuccess, onError, closeModal]);

  /**
   * Reject the reservation/event
   */
  const handleReject = useCallback(async (reason) => {
    if (!currentItem || !reason?.trim()) {
      const message = 'Please provide a reason for rejection';
      if (onError) onError(message);
      return { success: false, error: message };
    }

    try {
      const isNewUnifiedEvent = currentItem._isNewUnifiedEvent;
      const endpoint = isNewUnifiedEvent
        ? `${APP_CONFIG.API_BASE_URL}/admin/events/${currentItem._id}/reject`
        : `${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${currentItem._id}/reject`;

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
  }, [currentItem, apiToken, onSuccess, onError, closeModal]);

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
      return { success: false, cancelled: true, needsConfirmation: true };
    }

    // Second click: User confirmed, proceed with deletion
    console.log('DEBUG: Delete button second click - deleting');
    setPendingDeleteConfirmation(false); // Reset confirmation state
    setIsDeleting(true);
    try {
      // Determine endpoint based on whether this is a room reservation (has status field)
      const isRoomReservation = currentItem.status && (
        currentItem.status === 'pending' ||
        currentItem.status === 'room-reservation-request' ||
        currentItem.status === 'approved' ||
        currentItem.status === 'rejected'
      );

      let endpoint;
      if (isRoomReservation) {
        // Room reservations go to their own endpoint
        endpoint = `${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${currentItem._id}`;
      } else {
        // All events (Graph-synced or internal) go to /admin/events/:id
        // The backend will handle Graph deletion if the event has an eventId
        endpoint = `${APP_CONFIG.API_BASE_URL}/admin/events/${currentItem._id}`;
      }

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

  return {
    // State
    isOpen,
    currentItem,
    editableData,
    hasChanges,
    isSaving,
    isDeleting,
    holdError,
    reviewHold,
    pendingDeleteConfirmation,
    editScope, // For recurring events: 'thisEvent' | 'allEvents' | null

    // Actions
    openModal,
    closeModal,
    updateData,
    handleSave,
    handleApprove,
    handleReject,
    handleDelete
  };
}
