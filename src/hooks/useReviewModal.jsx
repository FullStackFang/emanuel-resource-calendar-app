// src/hooks/useReviewModal.jsx
import { useState, useCallback, useRef } from 'react';
import { logger } from '../utils/logger';
import { extractOccurrenceOverrideFields } from '../utils/recurrenceUtils';
import {
  buildDraftPayload, buildOwnerEditPayload, buildEditRequestPayload,
  buildRequesterPayload, buildGraphFields, buildInternalFields,
} from '../utils/eventPayloadBuilder';
import { transformEventToDuplicatePrefill, transformEventToFlatStructure } from '../utils/eventTransformers';
import { usePermissions } from './usePermissions';
import { dispatchRefresh } from './useDataRefreshBus';
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
  const { canCreateEvents, canSubmitReservation } = usePermissions();
  const [isOpen, setIsOpen] = useState(false);
  const [currentItem, setCurrentItem] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSavingOwnerEdit, setIsSavingOwnerEdit] = useState(false);
  const [isSubmittingEditRequest, setIsSubmittingEditRequest] = useState(false);
  const [pendingEditRequestConfirmation, setPendingEditRequestConfirmation] = useState(false);
  const [isApprovingEditRequest, setIsApprovingEditRequest] = useState(false);
  const [pendingEditRequestApproveConfirmation, setPendingEditRequestApproveConfirmation] = useState(false);
  const [isRejectingEditRequest, setIsRejectingEditRequest] = useState(false);
  const [pendingEditRequestRejectConfirmation, setPendingEditRequestRejectConfirmation] = useState(false);
  const [editRequestRejectionReason, setEditRequestRejectionReason] = useState('');
  // Cancellation request approval/rejection state
  const [isApprovingCancellation, setIsApprovingCancellation] = useState(false);
  const [pendingCancellationApproveConfirmation, setPendingCancellationApproveConfirmation] = useState(false);
  const [isRejectingCancellation, setIsRejectingCancellation] = useState(false);
  const [pendingCancellationRejectConfirmation, setPendingCancellationRejectConfirmation] = useState(false);
  const [cancellationRejectionReason, setCancellationRejectionReason] = useState('');
  const [isApproving, setIsApproving] = useState(false);
  const [editableData, setEditableData] = useState(null);
  const [eventVersion, setEventVersion] = useState(null);

  // Conflict dialog state (for 409 VERSION_CONFLICT responses)
  const [conflictInfo, setConflictInfo] = useState(null);

  // Soft conflict confirmation state (for scheduling conflicts with pending edits)
  const [softConflictConfirmation, setSoftConflictConfirmation] = useState(null);

  // Inline confirmation state for delete action
  const [pendingDeleteConfirmation, setPendingDeleteConfirmation] = useState(false);
  // Delete reason (required for owner deleting own pending)
  const [deleteReason, setDeleteReason] = useState('');

  // Inline confirmation state for approve/reject actions
  const [pendingApproveConfirmation, setPendingApproveConfirmation] = useState(false);
  const [pendingRejectConfirmation, setPendingRejectConfirmation] = useState(false);

  // Rejection reason state (for inline rejection reason input)
  const [rejectionReason, setRejectionReason] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);

  // Inline confirmation state for save action
  const [pendingSaveConfirmation, setPendingSaveConfirmation] = useState(false);

  // Wrapper: call onSuccess then immediately refresh nav badge counts
  const notifySuccess = useCallback((...args) => {
    if (onSuccess) onSuccess(...args);
    dispatchRefresh('review-modal', 'navigation-counts');
  }, [onSuccess]);


  // Refs for inline reason inputs — more reliable than autoFocus on re-renders
  const rejectInputRef = useRef(null);
  const deleteInputRef = useRef(null);

  // Edit scope for recurring events: 'thisEvent' | 'allEvents' | null
  const [editScope, setEditScope] = useState(null);

  // Scheduling conflict state — owned by the hook so openModal() can reset it synchronously
  // (useEffect-based resets fire AFTER render, causing a brief flash of stale content)
  const [schedulingConflictInfo, setSchedulingConflictInfo] = useState(null);

  // Pre-fetched availability data (fetched before modal opens)
  const [prefetchedAvailability, setPrefetchedAvailability] = useState(null);

  // Pre-fetched series events data (fetched in parallel with availability)
  const [prefetchedSeriesEvents, setPrefetchedSeriesEvents] = useState(null);

  // Counter to force child remount when currentItem is swapped (e.g., occurrence -> master)
  const [reinitKey, setReinitKey] = useState(0);

  // Form validity state (controlled by child form component)
  const [isFormValid, setIsFormValid] = useState(true);

  // Hold status (no event times but has reservation times — event will display as [Hold])
  const [isHold, setIsHold] = useState(false);

  // Draft-specific state
  const [isDraft, setIsDraft] = useState(false);
  const [draftId, setDraftId] = useState(null);
  const [showDraftDialog, setShowDraftDialog] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [pendingDraftConfirmation, setPendingDraftConfirmation] = useState(false);

  // Derived: true when viewing a single occurrence of a draft recurring series
  const isDraftOccurrenceEdit = isDraft && editScope === 'thisEvent';

  // Recurrence warning dialog state (for uncommitted recurrence edits on draft save)
  const [hasUncommittedRecurrence, setHasUncommittedRecurrence] = useState(false);
  const [showRecurrenceWarning, setShowRecurrenceWarning] = useState(false);
  const createRecurrenceRef = useRef(null);

  // Duplicate dialog state
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [submittingDuplicate, setSubmittingDuplicate] = useState(false);

  // Ref to hold form data getter function (set by child form component)
  const formDataGetterRef = useRef(null);

  /**
   * Set the form data getter function (called from child component via callback)
   */
  const setFormDataGetter = useCallback((getter) => {
    formDataGetterRef.current = getter;
  }, []);

  /**
   * Get live form data from the form component.
   * Wraps formDataGetterRef so parent components (MyReservations, Calendar)
   * can read the same live data that handleApprove/handleSave use internally.
   */
  const getFormData = useCallback((options) => {
    return formDataGetterRef.current?.(options) || null;
  }, []);

  /**
   * Pre-mutation freshness check.
   * Calls GET /api/events/:id/version and compares _version with the modal's eventVersion.
   * Returns true if fresh (or check fails gracefully), false if stale (resets confirmation).
   */
  const checkVersionFreshness = useCallback(async (itemId) => {
    if (!itemId || !apiToken) return true; // No ID or token — skip check
    try {
      const res = await fetch(`${APP_CONFIG.API_BASE_URL}/events/${itemId}/version`, {
        headers: { 'Authorization': `Bearer ${apiToken}` }
      });
      if (!res.ok) return true; // Endpoint error — proceed anyway, OCC catches conflicts
      const data = await res.json();
      if (data._version != null && eventVersion != null && data._version !== eventVersion) {
        const modifiedBy = data.lastModifiedBy ? ` by ${data.lastModifiedBy}` : '';
        if (onError) onError(`This event was modified${modifiedBy} since you opened it. Please review the latest changes before proceeding.`);
        return false; // Stale — caller should abort
      }
      return true; // Fresh
    } catch {
      return true; // Network error — proceed anyway, OCC catches conflicts
    }
  }, [apiToken, eventVersion, onError]);

  /**
   * Fetch the latest _version from the server and update local state.
   * Used by edit/cancellation request handlers where the version may have drifted
   * since the modal was opened (e.g., delta sync or admin save on the same event).
   * Returns the fresh version number, or falls back to the current eventVersion.
   */
  const fetchFreshVersion = useCallback(async (itemId) => {
    if (!itemId || !apiToken) return eventVersion;
    try {
      const res = await fetch(`${APP_CONFIG.API_BASE_URL}/events/${itemId}/version`, {
        headers: { 'Authorization': `Bearer ${apiToken}` }
      });
      if (!res.ok) return eventVersion;
      const data = await res.json();
      if (data._version != null) {
        if (data._version !== eventVersion) {
          logger.debug('[useReviewModal] Version drift detected, refreshing:', {
            stale: eventVersion, fresh: data._version
          });
          setEventVersion(data._version);
        }
        return data._version;
      }
      return eventVersion;
    } catch {
      return eventVersion; // Network error — use existing version, OCC catches real conflicts
    }
  }, [apiToken, eventVersion]);

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

    // Extract room/date info from any event format (raw MongoDB, flat, or Graph).
    // The item hasn't been through transformEventToFlatStructure yet — fields live in
    // different places depending on the source (Calendar, MyReservations, etc.).
    const itemRooms = item.locations || item.requestedRooms ||
      item.roomReservationData?.requestedRooms ||
      item.calendarData?.locations || [];
    // Extract date/time via string operations (timezone-safe — no new Date() on local-time strings)
    const itemStartDate = item.startDate || item.calendarData?.startDate ||
      (item.startDateTime ? item.startDateTime.split('T')[0] : null) ||
      (item.start?.dateTime ? item.start.dateTime.split('T')[0] : null);
    const itemStartTime = item.startTime || item.reservationStartTime ||
      item.calendarData?.startTime || item.calendarData?.reservationStartTime ||
      (item.startDateTime ? item.startDateTime.split('T')[1]?.substring(0, 5) : null) ||
      (item.start?.dateTime ? item.start.dateTime.split('T')[1]?.substring(0, 5) : null);
    const roomIds = itemRooms
      .map(loc => typeof loc === 'string' ? loc : (loc._id || String(loc)))
      .filter(Boolean);
    const hasRooms = roomIds.length > 0;
    const hasDates = !!(itemStartDate && itemStartTime);

    // Open modal IMMEDIATELY — no blocking fetches.
    // The content gate is now data-derived: it opens when prefetchedAvailability arrives
    // (for events with rooms + dates) or immediately (no rooms / no dates).
    // Form content is NOT rendered until the gate opens (conditional rendering, not CSS hiding).
    setSchedulingConflictInfo(null);
    setPrefetchedAvailability(null);
    setPrefetchedSeriesEvents(null);
    // Store extracted gate fields alongside the raw item so the gate IIFE can check them
    // without re-parsing the raw format on every render.
    setCurrentItem({ ...item, _gateRooms: hasRooms, _gateDates: hasDates });
    setEditableData(item);
    setEventVersion(item._version || null);
    setHasChanges(false);
    setEditScope(scope);
    setIsOpen(true);

    // Prefetch availability and series events in background (non-blocking).
    const hasSeriesId = !!item.eventSeriesId;
    if ((hasDates && hasRooms) || hasSeriesId) {
      const promises = [];

      // Availability prefetch — uses full-day + room-specific params to match
      // checkDayAvailability() exactly, so the form won't re-fetch on mount.
      if (hasDates && hasRooms) {
        const availabilityPromise = (async () => {
          try {
            const startDateTime = `${itemStartDate}T00:00:00`;
            const endDateTime = `${itemStartDate}T23:59:59`;
            const params = new URLSearchParams({
              startDateTime,
              endDateTime,
              roomIds: roomIds.join(','),
              setupTimeMinutes: 0,
              teardownTimeMinutes: 0
            });
            if (item._id) params.append('excludeEventId', item._id);
            const response = await fetch(`${APP_CONFIG.API_BASE_URL}/rooms/availability?${params}`);
            if (response.ok) {
              return await response.json();
            }
          } catch (err) {
            logger.debug('Pre-fetch availability failed, form will re-fetch:', err.message);
          }
          return []; // Empty array (not null) so the content gate still opens
        })();
        promises.push(availabilityPromise);
      } else {
        promises.push(Promise.resolve([]));
      }

      // Series events prefetch
      if (hasSeriesId) {
        const seriesPromise = (async () => {
          try {
            const headers = { 'Content-Type': 'application/json' };
            if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;
            const response = await fetch(
              `${APP_CONFIG.API_BASE_URL}/events/series/${item.eventSeriesId}`,
              { headers }
            );
            if (response.ok) {
              const data = await response.json();
              return data.events || [];
            }
          } catch (err) {
            logger.debug('Pre-fetch series events failed, form will re-fetch:', err.message);
          }
          return null;
        })();
        promises.push(seriesPromise);
      } else {
        promises.push(Promise.resolve(null));
      }

      const [availResult, seriesResult] = await Promise.allSettled(promises);

      const availability = availResult.status === 'fulfilled' ? availResult.value : [];
      const seriesEvents = seriesResult.status === 'fulfilled' ? seriesResult.value : null;

      setPrefetchedAvailability(availability);
      if (seriesEvents !== null) {
        setPrefetchedSeriesEvents(seriesEvents);
      }
    } else if (hasRooms) {
      // Rooms but no dates — nothing to prefetch, but open the gate
      setPrefetchedAvailability([]);
    }
  }, [apiToken]);

  /**
   * Close modal
   * @param {boolean} force - If true, close without showing draft dialog
   */
  const closeModal = useCallback(async (force = false) => {
    // Show draft save dialog only for NEW items (no existing status) with unsaved changes.
    // Don't show for existing events (published, pending, etc.) — those can't become drafts.
    if (!force && hasChanges && !isDraft && !currentItem?.status) {
      setShowDraftDialog(true);
      return;
    }

    setIsOpen(false);
    setCurrentItem(null);
    setEditableData(null);
    setEventVersion(null);
    setConflictInfo(null);
    setSchedulingConflictInfo(null); // Clear scheduling conflict state
    setHasChanges(false);
    setPendingDeleteConfirmation(false); // Reset delete confirmation
    setDeleteReason(''); // Reset delete reason
    setPendingDraftConfirmation(false); // Reset draft confirmation
    setEditScope(null); // Reset edit scope for recurring events
    setPrefetchedAvailability(null); // Clear prefetched availability data
    setPrefetchedSeriesEvents(null); // Clear prefetched series events data
    setIsDraft(false); // Reset draft state
    setDraftId(null);
    setShowDraftDialog(false);
    setIsHold(false); // Reset hold state
    setHasUncommittedRecurrence(false); // Reset recurrence warning state
    setShowRecurrenceWarning(false);
  }, [hasChanges, isDraft, currentItem]);

  /**
   * Update the current item (e.g., when swapping occurrence for series master).
   * Increments reinitKey to force child form remount.
   */
  const updateCurrentItem = useCallback((newItem) => {
    setCurrentItem(newItem);
    setEditableData(newItem);
    setEventVersion(newItem._version || null);
    setReinitKey(prev => prev + 1);
  }, []);

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
   * Restore data without marking as changed.
   * Used for view-only toggles (e.g., "View Original" after viewing edit request).
   */
  const restoreData = useCallback((data) => {
    logger.log('[useReviewModal.restoreData] Restoring data without hasChanges');
    setEditableData(data);
  }, []);

  /**
   * Replace editableData wholesale and force child form remount.
   * Used for data swaps that need the form to re-initialize (e.g., viewing edit requests,
   * restoring original data). Unlike updateData, this does NOT set hasChanges — callers
   * handle that separately if needed.
   *
   * The reinitKey bump causes RoomReservationReview (keyed on reinitKey) to unmount/remount,
   * which re-runs the useMemo(transformEventToFlatStructure) on the new data.
   */
  const replaceEditableData = useCallback((newData) => {
    logger.log('[useReviewModal.replaceEditableData] Replacing data and forcing remount');
    setEditableData(newData);
    setReinitKey(prev => prev + 1);
  }, []);

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
    // Pre-mutation freshness check
    const isFresh = await checkVersionFreshness(currentItem._id);
    if (!isFresh) {
      setPendingSaveConfirmation(false);
      return;
    }

    setPendingSaveConfirmation(false);
    setIsSaving(true);
    try {
      // All events (including pending reservations) are now stored in templeEvents__Events
      // Use the unified events endpoint for all saves
      const isGraphEvent = !!(currentItem.calendarId && (currentItem.calendarOwner || !currentItem.status));
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

      // Protect backend-owned fields: eventType, exceptionEventIds
      delete bodyData.eventType;
      delete bodyData.exceptionEventIds;

      if (editScope === 'thisEvent') {
        // For thisEvent scope: save overrides before deletion, then merge as fallback
        const savedOverrides = editableData.occurrenceOverrides || [];
        delete bodyData.occurrenceOverrides;

        // Merge occurrence-specific fields into body as top-level props.
        // Backend reads override values from top-level updates.* (e.g., updates.startTime),
        // so we extract stored overrides and use them as FALLBACK only — form data (already
        // in bodyData via editableData spread) is the source of truth for user edits.
        if (bodyData.occurrenceDate) {
          const overrideFields = extractOccurrenceOverrideFields(
            bodyData.occurrenceDate,
            savedOverrides
          );
          for (const [key, value] of Object.entries(overrideFields)) {
            if (bodyData[key] === undefined) bodyData[key] = value;
          }
        }
      } else {
        // For allEvents/no-scope: replace stale editableData overrides with live
        // overrides from the Recurrence tab (editableData doesn't track those edits)
        delete bodyData.occurrenceOverrides;
        const liveFormData = formDataGetterRef.current?.({ skipValidation: true });
        if (liveFormData?.occurrenceOverrides?.length > 0) {
          bodyData.occurrenceOverrides = liveFormData.occurrenceOverrides;
        }
      }

      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({
          ...bodyData,
          _version: eventVersion
        })
      });

      if (response.status === 409) {
        const data = await response.json();
        if (data.details?.code === 'VERSION_CONFLICT') {
          setConflictInfo({
            conflictType: 'data_changed',
            eventTitle: currentItem.eventTitle || 'Event',
            details: data.details || {},
            staleData: editableData
          });
          return { success: false, error: 'VERSION_CONFLICT' };
        }
        if (data.error === 'SchedulingConflict') {
          // Tiered conflict handling
          if (data.conflictTier === 'soft') {
            // Soft conflicts: show confirmation dialog instead of auto-retrying
            setSoftConflictConfirmation({
              message: `This time slot has ${data.softConflicts?.length || 1} pending edit proposal(s). Proceeding will override them.`,
              conflicts: data.softConflicts || data.conflicts || [],
              retryFn: async () => {
                setSoftConflictConfirmation(null);
                setIsSaving(true);
                try {
                  const retryResponse = await fetch(endpoint, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
                    body: JSON.stringify({ ...bodyData, _version: eventVersion, acknowledgeSoftConflicts: true })
                  });
                  if (retryResponse.ok) {
                    const retryResult = await retryResponse.json();
                    notifySuccess('Changes saved (pending edit conflicts acknowledged)', retryResult.event || retryResult);
                    setEventVersion(retryResult.event?._version || retryResult._version);
                    setHasChanges(false);
                    return { success: true, event: retryResult.event || retryResult };
                  }
                  const retryData = await retryResponse.json().catch(() => ({}));
                  const retryMsg = retryData.message || 'Cannot save: scheduling conflict(s) detected';
                  if (onError) onError(retryMsg, retryData.conflicts);
                  return { success: false, error: 'SchedulingConflict', conflicts: retryData.conflicts };
                } finally {
                  setIsSaving(false);
                }
              }
            });
            return { success: false, error: 'SoftConflictPending' };
          }
          if (data.conflictTier === 'hard' && data.canForce && data.forceField) {
            // Hard conflicts with admin force override available - show in error
            const msg = `Cannot save: ${data.hardConflicts?.length || 0} scheduling conflict(s) with published events. Use force override to proceed.`;
            if (onError) onError(msg, data.conflicts);
            return { success: false, error: 'SchedulingConflict', conflicts: data.conflicts, canForce: true, forceField: data.forceField };
          }
          // Hard conflicts without force option
          const msg = `Cannot save: ${data.hardConflicts?.length || 0} scheduling conflict(s) with published events. Adjust times or rooms.`;
          if (onError) onError(msg, data.conflicts);
          return { success: false, error: 'SchedulingConflict', conflicts: data.conflicts };
        }
        // Legacy 409
        const message = data.error || 'Conflict detected. Please refresh and try again.';
        if (onError) onError(message);
        return { success: false, error: message };
      }

      if (!response.ok) {
        throw new Error(`Failed to save changes: ${response.status}`);
      }

      const result = await response.json();
      setEventVersion(result._version || eventVersion);
      setHasChanges(false);

      notifySuccess(result);
      return { success: true, data: result };
    } catch (error) {
      logger.error('Error saving changes:', error);
      if (onError) onError(error.message);
      return { success: false, error: error.message };
    } finally {
      setIsSaving(false);
    }
  }, [hasChanges, currentItem, editableData, eventVersion, apiToken, graphToken, editScope, notifySuccess, onError, pendingSaveConfirmation, checkVersionFreshness]);

  /**
   * Approve the reservation/event
   * Uses two-step inline confirmation
   */
  const handleApprove = useCallback(async (approvalData = {}) => {
    if (!currentItem) return;

    // Two-step confirmation: First click shows confirmation
    if (!pendingApproveConfirmation) {
      setPendingApproveConfirmation(true);
      setPendingRejectConfirmation(false); // Clear reject confirmation if any
      setPendingDeleteConfirmation(false); // Clear delete confirmation if any
      return { success: false, cancelled: true, needsConfirmation: true };
    }

    // Second click: User confirmed, proceed with approval
    // Pre-mutation freshness check
    const isFresh = await checkVersionFreshness(currentItem._id);
    if (!isFresh) {
      setPendingApproveConfirmation(false);
      return { success: false, error: 'Stale data' };
    }

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

      // Track the latest version locally (React state won't update within this closure)
      let latestVersion = eventVersion;

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
              'Authorization': `Bearer ${apiToken}`
            },
            body: JSON.stringify({
              ...formData,
              graphToken, // Include for any Graph sync needed
              _version: latestVersion,
              ...(safeApprovalData.acknowledgeSoftConflicts ? { acknowledgeSoftConflicts: true } : {})
            })
          });

          if (saveResponse.status === 409) {
            const saveData = await saveResponse.json();
            if (saveData.details?.code === 'VERSION_CONFLICT') {
              setConflictInfo({
                conflictType: 'data_changed',
                eventTitle: currentItem.eventTitle || 'Event',
                details: saveData.details || {},
                staleData: editableData
              });
              return { success: false, error: 'VERSION_CONFLICT' };
            }
            if (saveData.error === 'SchedulingConflict') {
              if (saveData.conflictTier === 'soft') {
                // Soft conflicts: show confirmation dialog
                setSoftConflictConfirmation({
                  message: `This time slot has ${saveData.softConflicts?.length || 1} pending edit proposal(s). Proceeding will override them.`,
                  conflicts: saveData.softConflicts || saveData.conflicts || [],
                  retryFn: async () => {
                    setSoftConflictConfirmation(null);
                    // Re-invoke handleApprove — the save step will include acknowledgeSoftConflicts
                    return handleApprove({ ...safeApprovalData, acknowledgeSoftConflicts: true });
                  }
                });
                setIsApproving(false);
                return { success: false, error: 'SoftConflictPending' };
              } else {
                // Hard conflicts
                const msg = `Cannot publish: ${saveData.hardConflicts?.length || saveData.conflicts?.length || 0} scheduling conflict(s) with published events.`;
                if (onError) onError(msg, saveData.conflicts);
                setIsApproving(false);
                return { success: false, error: 'SchedulingConflict', conflicts: saveData.conflicts, canForce: saveData.canForce, forceField: saveData.forceField };
              }
            }
          }

          if (!saveResponse.ok) {
            const errorText = await saveResponse.text();
            throw new Error(`Failed to save form data: ${saveResponse.status} - ${errorText}`);
          }

          const saveResult = await saveResponse.json();
          // Update version after successful save so approve step uses latest
          if (saveResult._version) {
            latestVersion = saveResult._version;
            setEventVersion(saveResult._version);
          }
          logger.log('[handleApprove] Form data saved successfully:', saveResult);
        } catch (saveError) {
          logger.error('Failed to save form data before approval:', saveError);
          if (onError) onError(`Failed to save changes: ${saveError.message}`);
          return { success: false, error: saveError.message };
        }
      }

      // Step 2: Call approve endpoint which will create the Graph event from the saved data
      // The approve endpoint uses event.graphData which was just updated by the save
      const endpoint = `${APP_CONFIG.API_BASE_URL}/admin/events/${currentItem._id}/publish`;
      logger.log('[handleApprove] Step 2: Calling approve endpoint');

      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({
          graphToken,
          notes: safeApprovalData.notes || '',
          calendarMode: safeApprovalData.calendarMode || 'production',
          createCalendarEvent: true, // Let the backend create the Graph event from the saved data
          forcePublish: safeApprovalData.forcePublish || false,
          targetCalendar: safeApprovalData.targetCalendar || selectedCalendarId || '',
          _version: latestVersion
        })
      });

      if (response.status === 409) {
        const data = await response.json();
        if (data.details?.code === 'VERSION_CONFLICT') {
          // Determine conflict type based on current status
          const currentStatus = data.details?.currentStatus;
          let conflictType = 'data_changed';
          if (currentStatus === 'published' || currentStatus === 'rejected') {
            conflictType = 'already_actioned';
          } else if (currentStatus && currentStatus !== 'pending') {
            conflictType = 'status_changed';
          }
          setConflictInfo({
            conflictType,
            eventTitle: currentItem.eventTitle || 'Event',
            details: data.details || {},
            staleData: editableData
          });
          return { success: false, error: 'VERSION_CONFLICT' };
        }
        if (data.error === 'SchedulingConflict') {
          if (data.conflictTier === 'soft') {
            // Soft conflicts: show confirmation dialog
            setSoftConflictConfirmation({
              message: `This time slot has ${data.softConflicts?.length || 1} pending edit proposal(s). Proceeding will override them.`,
              conflicts: data.softConflicts || data.conflicts || [],
              retryFn: async () => {
                setSoftConflictConfirmation(null);
                setIsApproving(true);
                try {
                  const retryResponse = await fetch(endpoint, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
                    body: JSON.stringify({
                      graphToken,
                      notes: safeApprovalData.notes || '',
                      calendarMode: safeApprovalData.calendarMode || 'production',
                      createCalendarEvent: true,
                      forcePublish: safeApprovalData.forcePublish || false,
                      targetCalendar: safeApprovalData.targetCalendar || selectedCalendarId || '',
                      _version: latestVersion,
                      acknowledgeSoftConflicts: true,
                    })
                  });
                  if (retryResponse.ok) {
                    const retryResult = await retryResponse.json();
                    notifySuccess(retryResult);
                    await closeModal(true);
                    return { success: true, data: retryResult };
                  }
                  const retryData = await retryResponse.json().catch(() => ({}));
                  const retryMsg = retryData.message || 'Cannot publish: scheduling conflict(s) detected';
                  if (onError) onError(retryMsg, retryData.conflicts);
                  return { success: false, error: retryMsg, conflicts: retryData.conflicts };
                } finally {
                  setIsApproving(false);
                }
              }
            });
            return { success: false, error: 'SoftConflictPending' };
          }
          // Hard conflicts
          const message = `Cannot publish: ${data.hardConflicts?.length || data.conflicts?.length || 0} scheduling conflict(s) with published events.`;
          if (onError) onError(message, data.conflicts);
          return { success: false, error: message, conflicts: data.conflicts, canForce: data.canForce, forceField: data.forceField };
        }
      }

      if (!response.ok) {
        throw new Error(`Failed to publish: ${response.status}`);
      }

      const result = await response.json();
      notifySuccess(result);
      await closeModal(true);
      return {
        success: true,
        data: result,
        recurringConflicts: result.recurringConflicts || null,
      };
    } catch (error) {
      logger.error('Error approving:', error);
      if (onError) onError(error.message);
      return { success: false, error: error.message };
    } finally {
      setIsApproving(false);
    }
  }, [currentItem, editableData, eventVersion, apiToken, graphToken, selectedCalendarId, notifySuccess, onError, closeModal, pendingApproveConfirmation, checkVersionFreshness]);

  /**
   * Reject the reservation/event
   * Uses two-step inline confirmation with rejection reason input
   * @param {string} [reasonOverride] - Optional reason override (if not provided, uses rejectionReason state)
   */
  const handleReject = useCallback(async (reasonOverride) => {
    // Use provided reason or fall back to state
    const reason = typeof reasonOverride === 'string' ? reasonOverride : rejectionReason;

    // Two-step confirmation: First click shows inline reason input (no auto-reset — user needs time to type)
    if (!pendingRejectConfirmation) {
      setPendingRejectConfirmation(true);
      setPendingApproveConfirmation(false); // Clear approve confirmation if any
      setPendingDeleteConfirmation(false); // Clear delete confirmation if any
      // No timer — reason-required inputs stay open until explicit cancel or submit
      return { success: false, cancelled: true, needsConfirmation: true };
    }

    // Second click: User confirmed, proceed with rejection
    if (!currentItem || !reason?.trim()) {
      const message = 'Please provide a reason for rejection';
      if (onError) onError(message);
      return { success: false, error: message };
    }

    // Pre-mutation freshness check
    const isFresh = await checkVersionFreshness(currentItem._id);
    if (!isFresh) {
      setPendingRejectConfirmation(false);
      return { success: false, error: 'Stale data' };
    }

    setIsRejecting(true);
    setPendingRejectConfirmation(false);

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
        body: JSON.stringify({ reason: reason.trim(), _version: eventVersion })
      });

      if (response.status === 409) {
        const data = await response.json();
        if (data.details?.code === 'VERSION_CONFLICT') {
          const currentStatus = data.details?.currentStatus;
          let conflictType = 'data_changed';
          if (currentStatus === 'published' || currentStatus === 'rejected') {
            conflictType = 'already_actioned';
          } else if (currentStatus && currentStatus !== 'pending') {
            conflictType = 'status_changed';
          }
          setConflictInfo({
            conflictType,
            eventTitle: currentItem.eventTitle || 'Event',
            details: data.details || {},
            staleData: transformEventToFlatStructure(currentItem)
          });
          return { success: false, error: 'VERSION_CONFLICT' };
        }
      }

      if (!response.ok) {
        throw new Error('Failed to reject');
      }

      const result = await response.json();
      setRejectionReason(''); // Clear the reason after successful rejection
      notifySuccess(result);
      await closeModal(true);
      return { success: true, data: result };
    } catch (error) {
      logger.error('Error rejecting:', error);
      if (onError) onError(error.message);
      return { success: false, error: error.message };
    } finally {
      setIsRejecting(false);
    }
  }, [currentItem, apiToken, eventVersion, rejectionReason, notifySuccess, onError, closeModal, pendingRejectConfirmation, checkVersionFreshness]);

  /**
   * Cancel the pending reject confirmation
   */
  const cancelRejectConfirmation = useCallback(() => {
    setPendingRejectConfirmation(false);
    setRejectionReason('');
  }, []);

  /**
   * Delete the event (Graph event or internal event)
   * Uses two-step inline confirmation instead of browser popup
   */
  const handleDelete = useCallback(async () => {
    if (!currentItem) return;

    // Two-step confirmation: First click shows confirmation (no auto-reset for consistency with reason-required inputs)
    if (!pendingDeleteConfirmation) {
      // First click: Set pending confirmation state and return
      logger.log('DEBUG: Delete button first click - showing confirmation');
      setPendingDeleteConfirmation(true);
      setPendingApproveConfirmation(false); // Clear approve confirmation if any
      setPendingRejectConfirmation(false); // Clear reject confirmation if any
      // No timer — ✕ cancel button provides explicit cancellation
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
          calendarId: currentItem.calendarId,
          _version: eventVersion,
          reason: deleteReason?.trim() || undefined
        })
      });

      if (response.status === 409) {
        const data = await response.json();
        if (data.details?.code === 'VERSION_CONFLICT') {
          setConflictInfo({
            conflictType: data.details?.currentStatus !== currentItem.status ? 'status_changed' : 'data_changed',
            eventTitle: currentItem.eventTitle || 'Event',
            details: data.details || {},
            staleData: transformEventToFlatStructure(currentItem)
          });
          return { success: false, error: 'VERSION_CONFLICT' };
        }
      }

      if (!response.ok) {
        throw new Error(`Failed to delete: ${response.status}`);
      }

      const result = await response.json();
      if (result.occurrenceExcluded) {
        // Single occurrence was excluded from series - series still alive
        notifySuccess({ ...result, occurrenceExcluded: true });
      } else {
        notifySuccess({ ...result, deleted: true });
      }
      await closeModal(true);
      return { success: true, data: result };
    } catch (error) {
      logger.error('Error deleting:', error);
      if (onError) onError(error.message);
      return { success: false, error: error.message };
    } finally {
      setIsDeleting(false);
    }
  }, [currentItem, apiToken, graphToken, editScope, eventVersion, notifySuccess, onError, closeModal, pendingDeleteConfirmation, deleteReason]);

  // Cancel confirmation functions
  const cancelDeleteConfirmation = useCallback(() => {
    setPendingDeleteConfirmation(false);
  }, []);

  const cancelApproveConfirmation = useCallback(() => {
    setPendingApproveConfirmation(false);
  }, []);

  // Note: cancelRejectConfirmation is defined earlier (after handleReject)
  // to include clearing the rejection reason

  const cancelSaveConfirmation = useCallback(() => {
    setPendingSaveConfirmation(false);
  }, []);

  /**
   * Restore a deleted event to its previous status.
   * Uses the admin restore endpoint. Confirmation is handled locally in ReviewModal.
   */
  const handleRestore = useCallback(async () => {
    if (!currentItem) return;
    setIsRestoring(true);
    try {
      const endpoint = `${APP_CONFIG.API_BASE_URL}/admin/events/${currentItem._id}/restore`;
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          _version: eventVersion,
          forceRestore: false
        })
      });

      if (response.status === 409) {
        const data = await response.json();
        if (data.details?.code === 'VERSION_CONFLICT') {
          setConflictInfo({
            conflictType: data.details?.currentStatus !== currentItem.status ? 'status_changed' : 'data_changed',
            eventTitle: currentItem.eventTitle || 'Event',
            details: data.details || {},
            staleData: transformEventToFlatStructure(currentItem)
          });
          return { success: false, error: 'VERSION_CONFLICT' };
        }
        if (data.error === 'SchedulingConflict') {
          throw new Error(data.message || 'Scheduling conflict prevents restore');
        }
      }

      if (response.status === 403) {
        throw new Error('You do not have permission to restore this event');
      }

      if (!response.ok) {
        throw new Error(`Failed to restore: ${response.status}`);
      }

      const result = await response.json();
      notifySuccess({ ...result, restored: true });
      await closeModal(true);
      return { success: true };
    } catch (error) {
      logger.error('Restore failed:', error);
      if (onError) onError(error.message);
      return { success: false, error: error.message };
    } finally {
      setIsRestoring(false);
    }
  }, [currentItem, apiToken, eventVersion, notifySuccess, onError, closeModal]);

  /**
   * Owner edit handler for pending/rejected events.
   * Replaces 4 duplicate handlers (handleSavePendingEdit + handleSaveRejectedEdit
   * in both Calendar.jsx and MyReservations.jsx).
   *
   * Uses getFormData() for live form data (fixes stale-data bug where Calendar.jsx
   * previously read editableData, missing ref-managed fields like categories/services).
   * Uses buildOwnerEditPayload() for complete field coverage (fixes 13+ silently dropped fields).
   */
  const handleOwnerEdit = useCallback(async () => {
    if (!currentItem) return { success: false, error: 'No item' };

    // Read LIVE form data (fixes Calendar stale-data bug)
    const formData = getFormData?.({ skipValidation: true }) || editableData;
    if (!formData) return { success: false, error: 'No form data' };

    // Validate required fields
    if (!formData.eventTitle?.trim()) {
      if (onError) onError('Event title is required');
      return { success: false, error: 'Event title is required' };
    }
    if (!formData.startDate || !formData.endDate) {
      if (onError) onError('Start date and end date are required');
      return { success: false, error: 'Start date and end date are required' };
    }
    if (!(formData.startTime || formData.reservationStartTime) || !(formData.endTime || formData.reservationEndTime)) {
      if (onError) onError('Reservation start time and end time are required');
      return { success: false, error: 'Reservation start time and end time are required' };
    }

    setIsSavingOwnerEdit(true);
    try {
      const payload = buildOwnerEditPayload(formData, { eventVersion });

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/room-reservations/${currentItem._id}/edit`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify(payload)
        }
      );

      if (response.status === 409) {
        const errorData = await response.json();
        if (errorData.error === 'SchedulingConflict') {
          if (onError) onError(`Cannot save: ${errorData.conflicts?.length || 0} scheduling conflict(s). Adjust times or rooms.`);
          return { success: false, error: 'SchedulingConflict', conflicts: errorData.conflicts };
        }
        // VERSION_CONFLICT
        if (errorData.details?.code === 'VERSION_CONFLICT') {
          setConflictInfo({
            conflictType: errorData.details?.currentStatus !== currentItem.status ? 'status_changed' : 'data_changed',
            eventTitle: currentItem.eventTitle || 'Event',
            details: errorData.details || {},
            staleData: transformEventToFlatStructure(currentItem)
          });
          return { success: false, error: 'VERSION_CONFLICT' };
        }
        throw new Error(errorData.error || 'Conflict detected');
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save changes');
      }

      const result = await response.json();
      notifySuccess({ ownerEdit: true });
      await closeModal(true);
      return { success: true, data: result };
    } catch (error) {
      logger.error('Error saving owner edit:', error);
      if (onError) onError(error.message);
      return { success: false, error: error.message };
    } finally {
      setIsSavingOwnerEdit(false);
    }
  }, [currentItem, apiToken, eventVersion, editableData, notifySuccess, onError, closeModal, getFormData]);

  /**
   * Submit an edit request for a published event (owner-only).
   * Replaces 2 duplicate handlers in Calendar.jsx and MyReservations.jsx.
   * Uses two-click confirmation (consistent with other actions in this hook).
   *
   * @param {Function} computeDetectedChanges - Returns array of detected changes (for zero-change guard)
   */
  const handleSubmitEditRequest = useCallback(async (computeDetectedChanges) => {
    if (!currentItem) return { success: false, error: 'No item' };

    // Guard: recurring series masters require editScope (set by RecurringScopeDialog in Calendar).
    // MyReservations has no scope dialog, so block before confirmation to avoid confusing UX.
    if (currentItem?.eventType === 'seriesMaster' && !editScope) {
      if (onError) onError('Please edit recurring events from the calendar view to select which occurrence to change.');
      return { success: false, error: 'Missing editScope for recurring event' };
    }

    // Check for changes (zero-change guard)
    if (computeDetectedChanges) {
      const detectedChanges = computeDetectedChanges();
      if (detectedChanges.length === 0) {
        if (onError) onError('No changes detected. Please modify some fields before submitting.');
        return { success: false, error: 'No changes detected' };
      }
    }

    // Two-click confirmation
    if (!pendingEditRequestConfirmation) {
      setPendingEditRequestConfirmation(true);
      return { success: false, cancelled: true, needsConfirmation: true };
    }

    // Second click: proceed
    setPendingEditRequestConfirmation(false);

    // Read live form data
    const liveFormData = getFormData?.({ skipValidation: true });
    if (!liveFormData) {
      if (onError) onError('Unable to read form data');
      return { success: false, error: 'No form data' };
    }

    setIsSubmittingEditRequest(true);
    try {
      const eventId = currentItem._id || currentItem.eventId;
      const payload = buildEditRequestPayload(liveFormData, {
        eventVersion,
        editScope,
        occurrenceDate: editScope === 'thisEvent'
          ? (currentItem?.startDate || currentItem?.start?.dateTime?.split('T')[0])
          : undefined,
        seriesMasterId: editScope
          ? (currentItem?.seriesMasterId || currentItem?.graphData?.seriesMasterId || currentItem?.graphData?.id)
          : undefined,
      });

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/events/${eventId}/request-edit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify(payload)
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit edit request');
      }

      const result = await response.json();
      notifySuccess({ editRequestSubmitted: true });
      await closeModal(true);
      return { success: true, data: result };
    } catch (error) {
      logger.error('Error submitting edit request:', error);
      if (onError) onError(error.message || 'Failed to submit edit request');
      return { success: false, error: error.message };
    } finally {
      setIsSubmittingEditRequest(false);
    }
  }, [currentItem, apiToken, eventVersion, editScope, notifySuccess, onError, closeModal, getFormData, pendingEditRequestConfirmation]);

  const cancelEditRequestConfirmation = useCallback(() => {
    setPendingEditRequestConfirmation(false);
  }, []);

  /**
   * Approve an edit request on a published event (admin/approver only).
   * Replaces 3 in-modal copies across Calendar.jsx, MyReservations.jsx, ReservationRequests.jsx.
   * Uses two-click confirmation.
   *
   * @param {Object|null} approverChanges - Pre-computed approver modifications (from computeApproverChanges)
   */
  const handleApproveEditRequest = useCallback(async (approverChanges) => {
    if (!currentItem) return { success: false, error: 'No item' };

    // Two-click confirmation
    if (!pendingEditRequestApproveConfirmation) {
      setPendingEditRequestApproveConfirmation(true);
      return { success: false, cancelled: true, needsConfirmation: true };
    }

    setPendingEditRequestApproveConfirmation(false);
    setIsApprovingEditRequest(true);
    try {
      const eventId = currentItem._id || currentItem.eventId;

      // Refresh version to avoid false VERSION_CONFLICT from stale modal data
      const freshVersion = await fetchFreshVersion(eventId);

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/events/${eventId}/publish-edit`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify({
            notes: '',
            _version: freshVersion ?? null,
            ...(approverChanges && { approverChanges })
          })
        }
      );

      if (response.status === 409) {
        const errorData = await response.json();
        if (errorData.error === 'SchedulingConflict') {
          if (onError) onError(errorData.message || 'Scheduling conflict detected');
          return { success: false, error: 'SchedulingConflict', conflictData: errorData };
        }
        // OCC version conflict
        if (errorData.details?.code === 'VERSION_CONFLICT') {
          setConflictInfo({
            conflictType: errorData.details?.currentStatus !== currentItem.status ? 'status_changed' : 'data_changed',
            eventTitle: currentItem.eventTitle || 'Event',
            details: errorData.details || {},
            staleData: transformEventToFlatStructure(currentItem)
          });
          return { success: false, error: 'VERSION_CONFLICT' };
        }
        if (onError) onError(errorData.error || 'This event was modified by another user');
        return { success: false, error: errorData.error };
      }
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to approve edit request');
      }

      const result = await response.json();
      notifySuccess({ editRequestApproved: true });
      await closeModal(true);
      return { success: true, data: result };
    } catch (error) {
      logger.error('Error approving edit request:', error);
      if (onError) onError(error.message);
      return { success: false, error: error.message };
    } finally {
      setIsApprovingEditRequest(false);
      setPendingEditRequestApproveConfirmation(false);
    }
  }, [currentItem, apiToken, fetchFreshVersion, notifySuccess, onError, closeModal, pendingEditRequestApproveConfirmation]);

  const cancelEditRequestApproveConfirmation = useCallback(() => {
    setPendingEditRequestApproveConfirmation(false);
  }, []);

  /**
   * Reject an edit request on a published event (admin/approver only).
   * Replaces 3 in-modal copies across Calendar.jsx, MyReservations.jsx, ReservationRequests.jsx.
   * Uses two-click confirmation with reason required.
   */
  const handleRejectEditRequest = useCallback(async () => {
    if (!currentItem) return { success: false, error: 'No item' };

    // Two-click confirmation
    if (!pendingEditRequestRejectConfirmation) {
      setPendingEditRequestRejectConfirmation(true);
      return { success: false, cancelled: true, needsConfirmation: true };
    }

    // Reason required
    if (!editRequestRejectionReason.trim()) {
      if (onError) onError('Please provide a reason for rejecting the edit request.');
      return { success: false, error: 'Reason required' };
    }

    setPendingEditRequestRejectConfirmation(false);
    setIsRejectingEditRequest(true);
    try {
      const eventId = currentItem._id || currentItem.eventId;

      // Refresh version to avoid false VERSION_CONFLICT from stale modal data
      const freshVersion = await fetchFreshVersion(eventId);

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/events/${eventId}/reject-edit`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify({
            reason: editRequestRejectionReason.trim(),
            _version: freshVersion ?? null,
          })
        }
      );

      if (response.status === 409) {
        const errorData = await response.json();
        if (errorData.details?.code === 'VERSION_CONFLICT') {
          setConflictInfo({
            conflictType: errorData.details?.currentStatus !== currentItem.status ? 'status_changed' : 'data_changed',
            eventTitle: currentItem.eventTitle || 'Event',
            details: errorData.details || {},
            staleData: transformEventToFlatStructure(currentItem)
          });
          return { success: false, error: 'VERSION_CONFLICT' };
        }
        if (onError) onError(errorData.error || 'This event was modified by another user');
        return { success: false, error: errorData.error };
      }
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to reject edit request');
      }

      const result = await response.json();
      setEditRequestRejectionReason('');
      notifySuccess({ editRequestRejected: true });
      await closeModal(true);
      return { success: true, data: result };
    } catch (error) {
      logger.error('Error rejecting edit request:', error);
      if (onError) onError(error.message);
      return { success: false, error: error.message };
    } finally {
      setIsRejectingEditRequest(false);
      setPendingEditRequestRejectConfirmation(false);
    }
  }, [currentItem, apiToken, fetchFreshVersion, editRequestRejectionReason, notifySuccess, onError, closeModal, pendingEditRequestRejectConfirmation]);

  const cancelEditRequestRejectConfirmation = useCallback(() => {
    setPendingEditRequestRejectConfirmation(false);
    setEditRequestRejectionReason('');
  }, []);

  // =========================================================================
  // CANCELLATION REQUEST APPROVE/REJECT (approver/admin only)
  // =========================================================================

  const handleApproveCancellationRequest = useCallback(async () => {
    if (!currentItem) return { success: false, error: 'No item' };

    // Two-click confirmation
    if (!pendingCancellationApproveConfirmation) {
      setPendingCancellationApproveConfirmation(true);
      return { success: false, cancelled: true, needsConfirmation: true };
    }

    setPendingCancellationApproveConfirmation(false);
    setIsApprovingCancellation(true);
    try {
      const eventId = currentItem._id || currentItem.eventId;

      // Refresh version to avoid false VERSION_CONFLICT from stale modal data
      const freshVersion = await fetchFreshVersion(eventId);

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/events/${eventId}/approve-cancellation`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify({
            notes: '',
            _version: freshVersion ?? null,
          })
        }
      );

      if (response.status === 409) {
        const errorData = await response.json();
        if (errorData.details?.code === 'VERSION_CONFLICT') {
          setConflictInfo({
            conflictType: errorData.details?.currentStatus !== currentItem.status ? 'status_changed' : 'data_changed',
            eventTitle: currentItem.eventTitle || 'Event',
            details: errorData.details || {},
            staleData: transformEventToFlatStructure(currentItem)
          });
          return { success: false, error: 'VERSION_CONFLICT' };
        }
        if (onError) onError(errorData.error || 'This event was modified by another user');
        return { success: false, error: errorData.error };
      }
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to approve cancellation request');
      }

      const result = await response.json();
      notifySuccess({ cancellationApproved: true });
      await closeModal(true);
      return { success: true, data: result };
    } catch (error) {
      logger.error('Error approving cancellation request:', error);
      if (onError) onError(error.message);
      return { success: false, error: error.message };
    } finally {
      setIsApprovingCancellation(false);
      setPendingCancellationApproveConfirmation(false);
    }
  }, [currentItem, apiToken, fetchFreshVersion, notifySuccess, onError, closeModal, pendingCancellationApproveConfirmation]);

  const cancelCancellationApproveConfirmation = useCallback(() => {
    setPendingCancellationApproveConfirmation(false);
  }, []);

  const handleRejectCancellationRequest = useCallback(async () => {
    if (!currentItem) return { success: false, error: 'No item' };

    // Two-click confirmation
    if (!pendingCancellationRejectConfirmation) {
      setPendingCancellationRejectConfirmation(true);
      return { success: false, cancelled: true, needsConfirmation: true };
    }

    // Reason required
    if (!cancellationRejectionReason.trim()) {
      if (onError) onError('Please provide a reason for rejecting the cancellation request.');
      return { success: false, error: 'Reason required' };
    }

    setPendingCancellationRejectConfirmation(false);
    setIsRejectingCancellation(true);
    try {
      const eventId = currentItem._id || currentItem.eventId;

      // Refresh version to avoid false VERSION_CONFLICT from stale modal data
      const freshVersion = await fetchFreshVersion(eventId);

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/events/${eventId}/reject-cancellation`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify({
            reason: cancellationRejectionReason.trim(),
            _version: freshVersion ?? null,
          })
        }
      );

      if (response.status === 409) {
        const errorData = await response.json();
        if (errorData.details?.code === 'VERSION_CONFLICT') {
          setConflictInfo({
            conflictType: errorData.details?.currentStatus !== currentItem.status ? 'status_changed' : 'data_changed',
            eventTitle: currentItem.eventTitle || 'Event',
            details: errorData.details || {},
            staleData: transformEventToFlatStructure(currentItem)
          });
          return { success: false, error: 'VERSION_CONFLICT' };
        }
        if (onError) onError(errorData.error || 'This event was modified by another user');
        return { success: false, error: errorData.error };
      }
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to reject cancellation request');
      }

      const result = await response.json();
      setCancellationRejectionReason('');
      notifySuccess({ cancellationRejected: true });
      await closeModal(true);
      return { success: true, data: result };
    } catch (error) {
      logger.error('Error rejecting cancellation request:', error);
      if (onError) onError(error.message);
      return { success: false, error: error.message };
    } finally {
      setIsRejectingCancellation(false);
      setPendingCancellationRejectConfirmation(false);
    }
  }, [currentItem, apiToken, fetchFreshVersion, cancellationRejectionReason, notifySuccess, onError, closeModal, pendingCancellationRejectConfirmation]);

  const cancelCancellationRejectConfirmation = useCallback(() => {
    setPendingCancellationRejectConfirmation(false);
    setCancellationRejectionReason('');
  }, []);

  /**
   * Dismiss the conflict dialog
   */
  const dismissConflict = useCallback(() => {
    setConflictInfo(null);
  }, []);

  /**
   * Dismiss the soft conflict confirmation dialog
   */
  const dismissSoftConflictConfirmation = useCallback(() => {
    setSoftConflictConfirmation(null);
  }, []);

  // buildDraftPayload is now imported from ../utils/eventPayloadBuilder

  /**
   * Internal: execute draft save without confirmation gate or modal close.
   * Used by handleSaveDraft (after confirmation) and handleSubmitDraft (directly).
   */
  const _executeDraftSave = useCallback(async () => {
    const formData = formDataGetterRef.current?.({ skipValidation: true });
    if (!formData) {
      logger.error('_executeDraftSave: No form data getter available');
      if (onError) onError('Unable to get form data');
      return { success: false, error: 'No form data' };
    }

    if (!formData.eventTitle?.trim()) {
      if (onError) onError('Event title is required to save as draft');
      return { success: false, error: 'Event title required' };
    }
    if (!formData.startDate || !formData.endDate) {
      if (onError) onError('Start date and end date are required to save as draft');
      return { success: false, error: 'Dates required' };
    }

    setSavingDraft(true);

    try {
      const payload = buildDraftPayload(formData);

      // For thisEvent scope, add scope context and strip master-level fields
      if (editScope === 'thisEvent') {
        payload.editScope = 'thisEvent';
        payload.occurrenceDate = currentItem?.startDate || currentItem?.start?.dateTime?.split('T')[0];
        delete payload.recurrence;   // Don't overwrite master's recurrence
        delete payload.eventType;    // Don't overwrite master's eventType

        // Merge stored override fields as FALLBACK only — payload already has the
        // user's current form values from buildDraftPayload, which are the source of truth.
        const overrideFields = extractOccurrenceOverrideFields(
          payload.occurrenceDate,
          formData.occurrenceOverrides || []
        );
        for (const [key, value] of Object.entries(overrideFields)) {
          if (payload[key] === undefined) payload[key] = value;
        }
      } else if (editScope === 'allEvents') {
        payload.editScope = 'allEvents';
        // Only clear occurrence overrides when recurrence pattern/range changes
        // (shifted dates make old overrides invalid)
        const oldRecurrence = currentItem?.calendarData?.recurrence || currentItem?.recurrence || null;
        const newRecurrence = formData.recurrence || null;
        if (JSON.stringify(oldRecurrence?.pattern) !== JSON.stringify(newRecurrence?.pattern) ||
            JSON.stringify(oldRecurrence?.range) !== JSON.stringify(newRecurrence?.range)) {
          payload.clearOccurrenceOverrides = true;
        }
      }

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

      setHasChanges(false);
      setShowDraftDialog(false);
      return { success: true, data: result };

    } catch (error) {
      logger.error('Error saving draft:', error);
      if (onError) onError(error.message);
      return { success: false, error: error.message };
    } finally {
      setSavingDraft(false);
    }
  }, [apiToken, draftId, onError, editScope, currentItem]);

  /**
   * Save form data as a draft (two-click confirmation pattern)
   */
  const handleSaveDraft = useCallback(async () => {
    // Validate before showing confirmation
    const formData = formDataGetterRef.current?.({ skipValidation: true });
    if (!formData) {
      logger.error('handleSaveDraft: No form data getter available');
      if (onError) onError('Unable to get form data');
      return { success: false, error: 'No form data' };
    }
    if (!formData.eventTitle?.trim()) {
      if (onError) onError('Event title is required to save as draft');
      return { success: false, error: 'Event title required' };
    }
    if (!formData.startDate || !formData.endDate) {
      if (onError) onError('Start date and end date are required to save as draft');
      return { success: false, error: 'Dates required' };
    }

    // Check for uncommitted recurrence edits before confirmation
    if (hasUncommittedRecurrence && !pendingDraftConfirmation) {
      setShowRecurrenceWarning(true);
      return { success: false, cancelled: true, needsRecurrenceDecision: true };
    }

    // First click - show confirmation
    if (!pendingDraftConfirmation) {
      setPendingDraftConfirmation(true);
      setPendingApproveConfirmation(false);
      setPendingRejectConfirmation(false);
      setPendingDeleteConfirmation(false);
      setPendingSaveConfirmation(false);
      return { success: false, cancelled: true, needsConfirmation: true };
    }

    // Second click - execute save
    setPendingDraftConfirmation(false);
    const result = await _executeDraftSave();
    if (result.success) {
      notifySuccess({ ...result.data, savedAsDraft: true });
      await closeModal(true);
    }
    return result;
  }, [pendingDraftConfirmation, hasUncommittedRecurrence, _executeDraftSave, closeModal, notifySuccess, onError]);

  /**
   * Submit an existing draft for approval
   */
  const handleSubmitDraft = useCallback(async () => {
    if (!draftId) {
      if (onError) onError('No draft to submit');
      return { success: false, error: 'No draft ID' };
    }

    // Save any pending changes directly (bypass confirmation gate)
    const formData = formDataGetterRef.current?.();
    if (formData && hasChanges) {
      const saveResult = await _executeDraftSave();
      if (!saveResult.success) {
        return saveResult;
      }
    }

    setIsSaving(true);

    try {
      const submitHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`
      };
      // Pass simulated role to backend when role simulation is active
      const simSession = localStorage.getItem('role_simulation_session');
      if (simSession) {
        try { submitHeaders['X-Simulated-Role'] = JSON.parse(simSession).roleKey; } catch (e) { /* ignore */ }
      }

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/room-reservations/draft/${draftId}/submit`,
        {
          method: 'POST',
          headers: submitHeaders
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
      notifySuccess({ ...result, draftSubmitted: true });
      await closeModal(true);
      return { success: true, data: result };

    } catch (error) {
      logger.error('Error submitting draft:', error);
      if (onError) onError(error.message);
      return { success: false, error: error.message };
    } finally {
      setIsSaving(false);
    }
  }, [draftId, apiToken, hasChanges, _executeDraftSave, closeModal, notifySuccess, onError]);

  /**
   * Handlers for draft save dialog
   */
  const handleDraftDialogSave = useCallback(async () => {
    // Dialog itself serves as user confirmation — bypass the confirmation gate
    const result = await _executeDraftSave();
    if (result.success) {
      notifySuccess({ ...result.data, savedAsDraft: true });
      await closeModal(true);
    }
  }, [_executeDraftSave, closeModal, notifySuccess]);

  const handleDraftDialogDiscard = useCallback(async () => {
    setShowDraftDialog(false);
    setHasChanges(false);
    await closeModal(true);
  }, [closeModal]);

  const handleDraftDialogCancel = useCallback(() => {
    setShowDraftDialog(false);
  }, []);

  const cancelDraftConfirmation = useCallback(() => {
    setPendingDraftConfirmation(false);
  }, []);

  /**
   * Recurrence warning dialog handlers
   */
  const handleRecurrenceWarningCreateAndSave = useCallback(async () => {
    setShowRecurrenceWarning(false);
    // Programmatically trigger "Create Recurrence" in RecurrenceTabContent
    if (createRecurrenceRef.current) {
      createRecurrenceRef.current();
    }
    // Let state propagate, then execute draft save
    setTimeout(async () => {
      const result = await _executeDraftSave();
      if (result.success) {
        notifySuccess({ ...result.data, savedAsDraft: true });
        await closeModal(true);
      }
    }, 0);
  }, [_executeDraftSave, closeModal, notifySuccess]);

  const handleRecurrenceWarningSaveWithout = useCallback(async () => {
    setShowRecurrenceWarning(false);
    setHasUncommittedRecurrence(false);
    const result = await _executeDraftSave();
    if (result.success) {
      notifySuccess({ ...result.data, savedAsDraft: true });
      await closeModal(true);
    }
  }, [_executeDraftSave, closeModal, notifySuccess]);

  const handleRecurrenceWarningCancel = useCallback(() => {
    setShowRecurrenceWarning(false);
  }, []);

  /**
   * Check if draft can be saved (needs eventTitle)
   */
  const canSaveDraft = useCallback(() => {
    const formData = formDataGetterRef.current?.();
    return !!formData?.eventTitle?.trim();
  }, []);

  // ── Duplicate handlers ──

  const handleDuplicateOpen = useCallback(() => {
    if (!editableData) return;
    if (currentItem?.status === 'deleted' || currentItem?.status === 'draft' || currentItem?.eventType === 'seriesMaster') return;
    setShowDuplicateDialog(true);
  }, [editableData, currentItem]);

  const handleDuplicateClose = useCallback(() => {
    setShowDuplicateDialog(false);
  }, []);

  /**
   * Create duplicate events for each selected date.
   * Admin/Approver → auto-published via /events/new/audit-update
   * Requester → pending via /events/request
   */
  const handleDuplicateSubmit = useCallback(async (selectedDates) => {
    if (!selectedDates?.length || !editableData) return;
    setSubmittingDuplicate(true);

    // Use the form's live data (properly flattened via transformEventToFlatStructure)
    // instead of raw editableData which may be a nested MongoDB document.
    const sourceData = getFormData?.({ skipValidation: true }) || editableData;
    const prefill = transformEventToDuplicatePrefill(sourceData);
    const calendarOwner = currentItem?.calendarOwner || null;
    const calendarId = currentItem?.calendarId || selectedCalendarId || null;

    // Calculate duration for multi-day events
    const durationDays = prefill._durationDays || 0;

    let successCount = 0;
    let failCount = 0;

    for (const dateStr of selectedDates) {
      // Compute end date preserving original event duration
      let endDate = dateStr;
      if (durationDays > 0) {
        const d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() + durationDays);
        endDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }

      const formData = { ...prefill, startDate: dateStr, endDate };

      try {
        if (canCreateEvents) {
          const graphFields = buildGraphFields(formData);
          // Guard: Graph API rejects empty start/end datetimes
          if (!graphFields.start?.dateTime || !graphFields.end?.dateTime) {
            logger.error(`[useReviewModal] Duplicate skipped for ${dateStr}: empty start/end dateTime`, {
              startTime: formData.startTime, endTime: formData.endTime,
              reservationStartTime: formData.reservationStartTime,
              reservationEndTime: formData.reservationEndTime,
            });
            failCount++;
            continue;
          }
          const internalFields = buildInternalFields(formData);
          const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/new/audit-update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
            body: JSON.stringify({ graphFields, internalFields, calendarId, calendarOwner }),
          });
          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Failed to create event (${response.status})`);
          }
        } else {
          const payload = buildRequesterPayload(formData, { calendarId, calendarOwner });
          const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
            body: JSON.stringify(payload),
          });
          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Failed to submit reservation (${response.status})`);
          }
        }
        successCount++;
      } catch (err) {
        failCount++;
        logger.error(`[useReviewModal] Duplicate failed for ${dateStr}:`, err);
      }
    }

    setSubmittingDuplicate(false);
    setShowDuplicateDialog(false);

    if (successCount > 0) {
      notifySuccess({
        duplicated: true,
        count: successCount,
        failCount,
        autoPublished: canCreateEvents,
        dates: selectedDates,
      });
      dispatchRefresh('duplicate');
      await closeModal(true);
    }
    if (failCount > 0 && successCount === 0 && onError) {
      onError('Failed to create reservations');
    }
  }, [editableData, currentItem, canCreateEvents, apiToken, selectedCalendarId, notifySuccess, onError, getFormData, closeModal]);

  return {
    // State
    isOpen,
    currentItem,
    editableData,
    hasChanges,
    isFormValid,
    isHold,
    isSaving,
    isDeleting,
    isApproving,
    isRejecting,
    pendingDeleteConfirmation,
    pendingApproveConfirmation,
    pendingRejectConfirmation,
    pendingSaveConfirmation,
    eventVersion, // Current document version for optimistic concurrency
    conflictInfo, // Conflict dialog data (set on 409 VERSION_CONFLICT)
    softConflictConfirmation, // Soft conflict confirmation dialog data
    editScope, // For recurring events: 'thisEvent' | 'allEvents' | null
    prefetchedAvailability, // Pre-fetched room availability data
    prefetchedSeriesEvents, // Pre-fetched series events data
    reinitKey, // Counter to force child remount on item swap

    // Scheduling conflict state
    schedulingConflictInfo,
    setSchedulingConflictInfo,
    // Gate: data-derived. Opens when availability prefetch resolves (events with rooms + dates),
    // or immediately (no rooms, or rooms but no dates). Content is not rendered until true.
    // Uses _gateRooms/_gateDates flags computed once in openModal (avoids re-parsing raw formats).
    isSchedulingCheckComplete: (() => {
      if (!currentItem) return true;
      if (!currentItem._gateRooms) return true; // No rooms → no scheduling check needed
      if (!currentItem._gateDates) return true;  // No dates → no conflicts to compute
      return prefetchedAvailability !== null;     // Wait for availability prefetch
    })(),
    hasSchedulingConflicts: schedulingConflictInfo?.hasHardConflicts || false,
    hasSoftConflicts: schedulingConflictInfo?.hasSoftConflicts || false,
    hasPendingReservationConflicts: schedulingConflictInfo?.hasPendingReservationConflicts || false,

    // Rejection reason state (for inline input)
    rejectionReason,
    setRejectionReason,
    rejectInputRef,

    // Delete reason state (for owner-pending delete)
    deleteReason,
    setDeleteReason,
    deleteInputRef,

    // Draft-specific state
    isDraft,
    isDraftOccurrenceEdit,
    draftId,
    showDraftDialog,
    savingDraft,
    pendingDraftConfirmation,

    // Actions
    openModal,
    closeModal,
    updateData,
    restoreData, // Update data without marking as changed (for view-only toggles)
    replaceEditableData, // Wholesale data replacement with forced remount (for view-edit-request/restore flows)
    updateCurrentItem, // Swap current item (e.g., occurrence -> master) with forced remount
    setIsFormValid,
    setIsHold,
    setFormDataGetter, // Set form data getter for live form data access
    getFormData, // Get live form data (for edit request handlers in parent components)
    handleSave,
    handleApprove,
    handleReject,
    handleDelete,
    handleRestore,
    isRestoring,
    handleOwnerEdit,
    isSavingOwnerEdit,
    handleSubmitEditRequest,
    isSubmittingEditRequest,
    pendingEditRequestConfirmation,
    cancelEditRequestConfirmation,
    handleApproveEditRequest,
    isApprovingEditRequest,
    pendingEditRequestApproveConfirmation,
    cancelEditRequestApproveConfirmation,
    handleRejectEditRequest,
    isRejectingEditRequest,
    pendingEditRequestRejectConfirmation,
    cancelEditRequestRejectConfirmation,
    editRequestRejectionReason,
    setEditRequestRejectionReason,
    // Cancellation request approval/rejection
    handleApproveCancellationRequest,
    isApprovingCancellation,
    pendingCancellationApproveConfirmation,
    cancelCancellationApproveConfirmation,
    handleRejectCancellationRequest,
    isRejectingCancellation,
    pendingCancellationRejectConfirmation,
    cancelCancellationRejectConfirmation,
    cancellationRejectionReason,
    setCancellationRejectionReason,
    cancelDeleteConfirmation,
    cancelApproveConfirmation,
    cancelRejectConfirmation,
    cancelSaveConfirmation,
    dismissConflict, // Dismiss the conflict dialog
    dismissSoftConflictConfirmation, // Dismiss the soft conflict confirmation dialog

    // Draft-specific actions
    handleSaveDraft,
    handleSubmitDraft,
    handleDraftDialogSave,
    handleDraftDialogDiscard,
    handleDraftDialogCancel,
    cancelDraftConfirmation,
    canSaveDraft,

    // Recurrence warning state and actions
    hasUncommittedRecurrence,
    setHasUncommittedRecurrence,
    showRecurrenceWarning,
    createRecurrenceRef,
    handleRecurrenceWarningCreateAndSave,
    handleRecurrenceWarningSaveWithout,
    handleRecurrenceWarningCancel,

    // Duplicate dialog
    showDuplicateDialog,
    handleDuplicateOpen,
    handleDuplicateClose,
    handleDuplicateSubmit,
    submittingDuplicate,

    // ── Pre-mapped props for ReviewModal ──
    // Callers can spread this instead of mapping 80+ individual props:
    //   <ReviewModal {...reviewModal.getReviewModalProps()} title={...} ...localOverrides />
    // Props NOT included: title, modalMode, mode, isPending, isRequesterOnly, itemStatus,
    // requesterName, showActionButtons, showTabs, saveButtonLabel, children,
    // attachmentCount, historyCount, modalClassName, overlayClassName,
    // and all caller-local state (edit request mode, cancellation workflow, owner-edit actions).
    getReviewModalProps: () => ({
      // Modal control
      isOpen,
      onClose: closeModal,

      // Event state
      hasChanges,
      isFormValid,
      isHold,
      eventVersion,

      // Scheduling state
      isSchedulingCheckComplete: (() => {
        if (!currentItem) return true;
        if (!currentItem._gateRooms) return true;
        if (!currentItem._gateDates) return true;
        return prefetchedAvailability !== null;
      })(),
      hasSchedulingConflicts: schedulingConflictInfo?.hasHardConflicts || false,
      hasSoftConflicts: schedulingConflictInfo?.hasSoftConflicts || false,
      hasPendingReservationConflicts: schedulingConflictInfo?.hasPendingReservationConflicts || false,

      // Core actions
      onApprove: handleApprove,
      onReject: handleReject,
      onSave: handleSave,
      onDelete: handleDelete,
      onRestore: handleRestore,

      // Core action state
      isSaving,
      isDeleting,
      isApproving,
      isRejecting,
      isRestoring,

      // Confirmation states
      isApproveConfirming: pendingApproveConfirmation,
      onCancelApprove: cancelApproveConfirmation,
      isRejectConfirming: pendingRejectConfirmation,
      onCancelReject: cancelRejectConfirmation,
      isSaveConfirming: pendingSaveConfirmation,
      onCancelSave: cancelSaveConfirmation,
      isDeleteConfirming: pendingDeleteConfirmation,
      onCancelDelete: cancelDeleteConfirmation,

      // Rejection reason
      rejectionReason,
      onRejectionReasonChange: setRejectionReason,
      rejectInputRef,

      // Delete reason
      deleteReason,
      onDeleteReasonChange: setDeleteReason,
      deleteInputRef,

      // Draft workflow
      isDraft,
      isDraftOccurrenceEdit,
      onSaveDraft: isDraft ? handleSaveDraft : null,
      onSubmitDraft: isDraft ? handleSubmitDraft : null,
      savingDraft,
      isDraftConfirming: pendingDraftConfirmation,
      onCancelDraft: cancelDraftConfirmation,
      canSaveDraft,
      showDraftDialog,
      onDraftDialogSave: handleDraftDialogSave,
      onDraftDialogDiscard: handleDraftDialogDiscard,
      onDraftDialogCancel: handleDraftDialogCancel,

      // Edit request submission
      onSubmitEditRequest: handleSubmitEditRequest,
      isSubmittingEditRequest,
      isEditRequestConfirming: pendingEditRequestConfirmation,
      onCancelEditRequestConfirm: cancelEditRequestConfirmation,

      // Edit request approval/rejection
      onApproveEditRequest: handleApproveEditRequest,
      isApprovingEditRequest,
      isEditRequestApproveConfirming: pendingEditRequestApproveConfirmation,
      onCancelEditRequestApprove: cancelEditRequestApproveConfirmation,
      onRejectEditRequest: handleRejectEditRequest,
      isRejectingEditRequest,
      isEditRequestRejectConfirming: pendingEditRequestRejectConfirmation,
      onCancelEditRequestReject: cancelEditRequestRejectConfirmation,
      editRequestRejectionReason,
      onEditRequestRejectionReasonChange: setEditRequestRejectionReason,

      // Cancellation request approval/rejection
      onApproveCancellationRequest: handleApproveCancellationRequest,
      isApprovingCancellationRequest: isApprovingCancellation,
      isCancellationApproveConfirming: pendingCancellationApproveConfirmation,
      onCancelCancellationApprove: cancelCancellationApproveConfirmation,
      onRejectCancellationRequest: handleRejectCancellationRequest,
      isRejectingCancellationRequest: isRejectingCancellation,
      isCancellationRejectConfirming: pendingCancellationRejectConfirmation,
      onCancelCancellationReject: cancelCancellationRejectConfirmation,
      cancellationRejectionReason,
      onCancellationRejectionReasonChange: setCancellationRejectionReason,

      // Recurrence warnings
      showRecurrenceWarning,
      onRecurrenceWarningCreateAndSave: handleRecurrenceWarningCreateAndSave,
      onRecurrenceWarningSaveWithout: handleRecurrenceWarningSaveWithout,
      onRecurrenceWarningCancel: handleRecurrenceWarningCancel,
      createRecurrenceRef,
      onHasUncommittedRecurrence: setHasUncommittedRecurrence,

      // Reservation data (for recurrence tab auto-detection)
      reservation: currentItem,

      // Duplicate (available for pending/published non-recurring events, requires create or submit permission)
      onDuplicate: (
        (canCreateEvents || canSubmitReservation)
        && currentItem?.status !== 'deleted'
        && currentItem?.status !== 'draft'
        && currentItem?.eventType !== 'seriesMaster'
      ) ? handleDuplicateOpen : null,
      showDuplicateDialog,
      onDuplicateClose: handleDuplicateClose,
      onDuplicateSubmit: handleDuplicateSubmit,
      submittingDuplicate,
      duplicateEventTitle: editableData?.eventTitle || '',
      duplicateSourceDate: editableData?.startDate || '',
    })
  };
}
