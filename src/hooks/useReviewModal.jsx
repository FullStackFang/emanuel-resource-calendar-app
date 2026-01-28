// src/hooks/useReviewModal.jsx
import { useState, useCallback, useRef } from 'react';
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

  // Pre-fetched availability data (fetched before modal opens)
  const [prefetchedAvailability, setPrefetchedAvailability] = useState(null);

  // Form validity state (controlled by child form component)
  const [isFormValid, setIsFormValid] = useState(true);

  // Draft-specific state
  const [isDraft, setIsDraft] = useState(false);
  const [draftId, setDraftId] = useState(null);
  const [showDraftDialog, setShowDraftDialog] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  // Ref to hold form data getter function (set by child form component)
  const formDataGetterRef = useRef(null);

  /**
   * Set the form data getter function (called from child component via callback)
   */
  const setFormDataGetter = useCallback((getter) => {
    formDataGetterRef.current = getter;
  }, []);

  /**
   * Open modal with a reservation or event
   * @param {Object} item - The reservation or event to open
   * @param {Object} options - Optional settings
   * @param {string} options.editScope - For recurring events: 'thisEvent' or 'allEvents'
   * @param {boolean} options.isDraft - Whether opening a draft for editing
   */
  const openModal = useCallback(async (item, options = {}) => {
    if (!item) return;

    const { editScope: scope = null, isDraft: openAsDraft = false } = options;

    // Set draft state if opening a draft
    if (openAsDraft || item.status === 'draft') {
      setIsDraft(true);
      setDraftId(item._id);
    } else {
      setIsDraft(false);
      setDraftId(null);
    }

    // Try to acquire soft hold if item is pending
    if (item.status === 'pending' && !item._isNewUnifiedEvent) {
      const holdAcquired = await acquireReviewHold(item._id);
      if (!holdAcquired && holdError) {
        return; // Block if someone else is reviewing
      }
    }

    // Pre-fetch room availability for existing events with dates
    // This ensures the modal opens with all data ready (no loading spinner inside)
    let availability = null;
    if (item.startDate && item.startTime && item.endDate && item.endTime) {
      try {
        const startDateTime = `${item.startDate}T${item.startTime}`;
        const endDateTime = `${item.endDate}T${item.endTime}`;
        const params = new URLSearchParams({
          startDateTime,
          endDateTime,
          setupTimeMinutes: item.setupTimeMinutes || 0,
          teardownTimeMinutes: item.teardownTimeMinutes || 0
        });
        const response = await fetch(`${APP_CONFIG.API_BASE_URL}/rooms/availability?${params}`);
        if (response.ok) {
          availability = await response.json();
        }
      } catch (err) {
        // Silently fail - form will re-fetch if needed
        logger.debug('Pre-fetch availability failed, form will re-fetch:', err.message);
      }
    }

    setPrefetchedAvailability(availability);
    setCurrentItem(item);
    setEditableData(item);
    setOriginalChangeKey(item.changeKey);
    setHasChanges(false);
    setEditScope(scope);
    setIsOpen(true);
  }, [apiToken, holdError]);

  /**
   * Close modal and release any holds
   * @param {boolean} force - If true, close without showing draft dialog
   */
  const closeModal = useCallback(async (force = false) => {
    // Show draft save dialog if there are unsaved changes (for new items, not drafts already being edited)
    // Only prompt if not forcing close and has changes and not already a draft
    if (!force && hasChanges && !isDraft && currentItem?._isNewUnifiedEvent) {
      setShowDraftDialog(true);
      return;
    }

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
    setPrefetchedAvailability(null); // Clear prefetched availability data
    setIsDraft(false); // Reset draft state
    setDraftId(null);
    setShowDraftDialog(false);
  }, [currentItem, reviewHold, hasChanges, isDraft]);

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
    logger.log('[useReviewModal.updateData] Called with updates:', Object.keys(updates || {}));
    setEditableData(prev => ({
      ...prev,
      ...updates
    }));
    logger.log('[useReviewModal.updateData] Setting hasChanges to true');
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

      // Get LIVE form data from the form component (same as save flow)
      // This ensures we get the exact data the user sees on the form
      let formData = null;
      if (formDataGetterRef.current) {
        formData = formDataGetterRef.current();
        if (!formData) {
          // Validation failed in form
          if (onError) onError('Please fix validation errors before approving');
          setIsApproving(false);
          return { success: false, error: 'Validation failed' };
        }
        logger.log('[handleApprove] Got LIVE form data from formDataGetter:', {
          eventTitle: formData.eventTitle,
          eventDescription: formData.eventDescription?.substring(0, 50),
          startDateTime: formData.startDateTime,
          endDateTime: formData.endDateTime,
          hasLocations: !!formData.locations,
          locations: formData.locations
        });
      } else {
        logger.log('[handleApprove] WARNING: formDataGetter not available');
      }

      // Step 1: Save the form data to the existing record FIRST (if we have form data)
      // This ensures all form edits are persisted before creating the Graph event
      if (formData) {
        try {
          const saveEndpoint = `${APP_CONFIG.API_BASE_URL}/admin/events/${currentItem._id}`;
          logger.log('[handleApprove] Step 1: Saving form data to existing record:', currentItem._id);

          const saveResponse = await fetch(saveEndpoint, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiToken}`,
              'If-Match': originalChangeKey || currentItem.changeKey || ''
            },
            body: JSON.stringify({
              ...formData,
              graphToken // Include for any Graph sync needed
            })
          });

          if (!saveResponse.ok) {
            const errorText = await saveResponse.text();
            throw new Error(`Failed to save form data: ${saveResponse.status} - ${errorText}`);
          }

          const saveResult = await saveResponse.json();
          logger.log('[handleApprove] Form data saved successfully:', saveResult);
        } catch (saveError) {
          logger.error('Failed to save form data before approval:', saveError);
          if (onError) onError(`Failed to save changes: ${saveError.message}`);
          return { success: false, error: saveError.message };
        }
      }

      // Step 2: Call approve endpoint which will create the Graph event from the saved data
      // The approve endpoint uses event.graphData which was just updated by the save
      const endpoint = `${APP_CONFIG.API_BASE_URL}/admin/events/${currentItem._id}/approve`;
      logger.log('[handleApprove] Step 2: Calling approve endpoint');

      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
          'If-Match': '' // Don't use ETag since we just updated the record
        },
        body: JSON.stringify({
          graphToken,
          notes: safeApprovalData.notes || '',
          calendarMode: safeApprovalData.calendarMode || 'production',
          createCalendarEvent: true, // Let the backend create the Graph event from the saved data
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
  }, [currentItem, editableData, originalChangeKey, apiToken, graphToken, selectedCalendarId, onSuccess, onError, closeModal, pendingApproveConfirmation]);

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
      logger.log('DEBUG: Delete button first click - showing confirmation');
      setPendingDeleteConfirmation(true);
      setPendingApproveConfirmation(false); // Clear approve confirmation if any
      setPendingRejectConfirmation(false); // Clear reject confirmation if any
      return { success: false, cancelled: true, needsConfirmation: true };
    }

    // Second click: User confirmed, proceed with deletion
    logger.log('DEBUG: Delete button second click - deleting');
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

  /**
   * Build draft payload from form data
   */
  const buildDraftPayload = useCallback((formData) => {
    // Helper function to convert time difference to minutes
    const calculateTimeBufferMinutes = (eventTime, bufferTime) => {
      if (!eventTime || !bufferTime) return 0;
      const eventDate = new Date(`1970-01-01T${eventTime}:00`);
      const bufferDate = new Date(`1970-01-01T${bufferTime}:00`);
      const diffMs = Math.abs(eventDate.getTime() - bufferDate.getTime());
      return Math.floor(diffMs / (1000 * 60));
    };

    // Combine date and time if both exist
    const startDateTime = formData.startDate && formData.startTime
      ? `${formData.startDate}T${formData.startTime}`
      : null;
    const endDateTime = formData.endDate && formData.endTime
      ? `${formData.endDate}T${formData.endTime}`
      : null;

    let setupTimeMinutes = formData.setupTimeMinutes || 0;
    let teardownTimeMinutes = formData.teardownTimeMinutes || 0;

    if (formData.setupTime && formData.startTime) {
      setupTimeMinutes = calculateTimeBufferMinutes(formData.startTime, formData.setupTime);
    }
    if (formData.teardownTime && formData.endTime) {
      teardownTimeMinutes = calculateTimeBufferMinutes(formData.endTime, formData.teardownTime);
    }

    return {
      eventTitle: formData.eventTitle,
      eventDescription: formData.eventDescription,
      startDateTime,
      endDateTime,
      attendeeCount: parseInt(formData.attendeeCount) || 0,
      requestedRooms: formData.requestedRooms || formData.locations || [],
      requiredFeatures: formData.requiredFeatures || [],
      specialRequirements: formData.specialRequirements || '',
      department: formData.department || '',
      phone: formData.phone || '',
      setupTimeMinutes,
      teardownTimeMinutes,
      setupTime: formData.setupTime || null,
      teardownTime: formData.teardownTime || null,
      doorOpenTime: formData.doorOpenTime || null,
      doorCloseTime: formData.doorCloseTime || null,
      setupNotes: formData.setupNotes || '',
      doorNotes: formData.doorNotes || '',
      eventNotes: formData.eventNotes || '',
      isOnBehalfOf: formData.isOnBehalfOf || false,
      contactName: formData.contactName || '',
      contactEmail: formData.contactEmail || '',
      mecCategories: formData.categories || formData.mecCategories || [],  // Read from 'categories' (mecCategories is deprecated)
      services: formData.services || {},
      recurrence: formData.recurrence || null,
      virtualMeetingUrl: formData.virtualMeetingUrl || null,
      isOffsite: formData.isOffsite || false,
      offsiteName: formData.offsiteName || '',
      offsiteAddress: formData.offsiteAddress || '',
      offsiteLat: formData.offsiteLat || null,
      offsiteLon: formData.offsiteLon || null
    };
  }, []);

  /**
   * Save form data as a draft
   */
  const handleSaveDraft = useCallback(async () => {
    // Get form data from the form component
    const formData = formDataGetterRef.current?.();
    if (!formData) {
      logger.error('handleSaveDraft: No form data getter available');
      if (onError) onError('Unable to get form data');
      return { success: false, error: 'No form data' };
    }

    // Minimal validation - only eventTitle required
    if (!formData.eventTitle?.trim()) {
      if (onError) onError('Event title is required to save as draft');
      return { success: false, error: 'Event title required' };
    }

    setSavingDraft(true);

    try {
      const payload = buildDraftPayload(formData);

      const endpoint = draftId
        ? `${APP_CONFIG.API_BASE_URL}/room-reservations/draft/${draftId}`
        : `${APP_CONFIG.API_BASE_URL}/room-reservations/draft`;

      const method = draftId ? 'PUT' : 'POST';

      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save draft');
      }

      const result = await response.json();
      logger.log('Draft saved:', result);

      // Update draft state
      if (!draftId) {
        setDraftId(result._id);
      }
      setIsDraft(true);
      setHasChanges(false);
      setShowDraftDialog(false);

      if (onSuccess) onSuccess({ ...result, savedAsDraft: true });
      return { success: true, data: result };

    } catch (error) {
      logger.error('Error saving draft:', error);
      if (onError) onError(error.message);
      return { success: false, error: error.message };
    } finally {
      setSavingDraft(false);
    }
  }, [apiToken, draftId, buildDraftPayload, onSuccess, onError]);

  /**
   * Submit an existing draft for approval
   */
  const handleSubmitDraft = useCallback(async () => {
    if (!draftId) {
      if (onError) onError('No draft to submit');
      return { success: false, error: 'No draft ID' };
    }

    // First save any pending changes
    const formData = formDataGetterRef.current?.();
    if (formData && hasChanges) {
      const saveResult = await handleSaveDraft();
      if (!saveResult.success) {
        return saveResult;
      }
    }

    setIsSaving(true);

    try {
      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/room-reservations/draft/${draftId}/submit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          }
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        if (errorData.validationErrors) {
          throw new Error(`Incomplete draft: ${errorData.validationErrors.join(', ')}`);
        }
        if (errorData.conflicts) {
          throw new Error('Scheduling conflict detected. Please adjust your times.');
        }
        throw new Error(errorData.error || 'Failed to submit draft');
      }

      const result = await response.json();
      logger.log('Draft submitted:', result);

      setHasChanges(false);
      if (onSuccess) onSuccess({ ...result, draftSubmitted: true });
      await closeModal(true);
      return { success: true, data: result };

    } catch (error) {
      logger.error('Error submitting draft:', error);
      if (onError) onError(error.message);
      return { success: false, error: error.message };
    } finally {
      setIsSaving(false);
    }
  }, [draftId, apiToken, hasChanges, handleSaveDraft, closeModal, onSuccess, onError]);

  /**
   * Handlers for draft save dialog
   */
  const handleDraftDialogSave = useCallback(async () => {
    const result = await handleSaveDraft();
    if (result.success) {
      // After saving draft, close the modal
      await closeModal(true);
    }
  }, [handleSaveDraft, closeModal]);

  const handleDraftDialogDiscard = useCallback(async () => {
    setShowDraftDialog(false);
    setHasChanges(false);
    await closeModal(true);
  }, [closeModal]);

  const handleDraftDialogCancel = useCallback(() => {
    setShowDraftDialog(false);
  }, []);

  /**
   * Check if draft can be saved (needs eventTitle)
   */
  const canSaveDraft = useCallback(() => {
    const formData = formDataGetterRef.current?.();
    return !!formData?.eventTitle?.trim();
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
    prefetchedAvailability, // Pre-fetched room availability data

    // Draft-specific state
    isDraft,
    draftId,
    showDraftDialog,
    savingDraft,

    // Actions
    openModal,
    closeModal,
    updateData,
    setIsFormValid,
    setFormDataGetter, // Set form data getter for live form data access
    handleSave,
    handleApprove,
    handleReject,
    handleDelete,
    cancelDeleteConfirmation,
    cancelApproveConfirmation,
    cancelRejectConfirmation,
    cancelSaveConfirmation,

    // Draft-specific actions
    handleSaveDraft,
    handleSubmitDraft,
    handleDraftDialogSave,
    handleDraftDialogDiscard,
    handleDraftDialogCancel,
    canSaveDraft
  };
}
