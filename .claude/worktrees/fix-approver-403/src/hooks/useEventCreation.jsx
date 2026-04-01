// src/hooks/useEventCreation.jsx
//
// Single source of truth for all event creation orchestration.
// Handles admin publish, requester submit, and draft save flows.
// Consumed by Calendar.jsx (day-cell/timeline clicks) and NewReservationModal.
import { useState, useCallback, useRef } from 'react';
import { useMsal } from '@azure/msal-react';
import { usePermissions } from './usePermissions';
import { useNotification } from '../context/NotificationContext';
import { dispatchRefresh } from './useDataRefreshBus';
import {
  buildGraphFields,
  buildInternalFields,
  buildDraftPayload,
  buildRequesterPayload,
} from '../utils/eventPayloadBuilder';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';

/**
 * @param {Object} config
 * @param {string} config.apiToken - JWT for API calls
 * @param {string} config.selectedCalendarId - Currently selected calendar ID
 * @param {Array}  config.availableCalendars - User's calendar list
 * @param {Function} config.onSuccess - Called after successful creation (no args)
 * @param {Function} [config.onError] - Optional override for error handling
 * @param {string} [config.refreshSource] - Label for dispatchRefresh (default: 'event-creation')
 */
export function useEventCreation({
  apiToken,
  selectedCalendarId,
  availableCalendars,
  onSuccess,
  onError,
  refreshSource = 'event-creation',
}) {
  const { accounts } = useMsal();
  const { canCreateEvents, canSubmitReservation } = usePermissions();
  const { showSuccess, showError: defaultShowError } = useNotification();
  const showError = onError || defaultShowError;

  // --- Modal state ---
  const [isOpen, setIsOpen] = useState(false);
  const [prefillData, setPrefillData] = useState(null);
  const [mode, setMode] = useState('create'); // 'event' (admin) or 'create' (requester)
  const [formData, setFormData] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isFormValid, setIsFormValid] = useState(false);
  const [isHold, setIsHold] = useState(false);

  // --- Save state ---
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  // --- Multi-day state ---
  const [pendingMultiDayConfirmation, setPendingMultiDayConfirmation] = useState(null);

  // --- Draft state ---
  const [draftId, setDraftId] = useState(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [isDraftConfirming, setIsDraftConfirming] = useState(false);
  const [showDraftDialog, setShowDraftDialog] = useState(false);

  // --- Form data getter ref (set by RoomReservationReview via onFormDataReady) ---
  const formDataGetterRef = useRef(null);

  // --- Helpers ---

  const getCalendarOwner = useCallback(() => {
    return availableCalendars
      ?.find(cal => cal.id === selectedCalendarId)
      ?.owner?.address?.toLowerCase() || null;
  }, [availableCalendars, selectedCalendarId]);

  const getCalendarName = useCallback(() => {
    return availableCalendars?.find(cal => cal.id === selectedCalendarId)?.name || '';
  }, [availableCalendars, selectedCalendarId]);

  const resetState = useCallback(() => {
    setIsOpen(false);
    setPrefillData(null);
    setFormData(null);
    setHasChanges(false);
    setIsFormValid(false);
    setIsHold(false);
    setIsSaving(false);
    setIsConfirming(false);
    setPendingMultiDayConfirmation(null);
    setDraftId(null);
    setSavingDraft(false);
    setIsDraftConfirming(false);
    setShowDraftDialog(false);
    formDataGetterRef.current = null;
  }, []);

  // ── Build the default blank reservation shape ──
  const buildBlankReservation = useCallback((overrides = {}) => {
    return {
      requesterName: accounts[0]?.name || '',
      requesterEmail: accounts[0]?.username || '',
      department: '',
      phone: '',
      contactEmail: '',
      contactName: '',
      isOnBehalfOf: false,
      eventTitle: '',
      eventDescription: '',
      startDate: '',
      startTime: '',
      endDate: '',
      endTime: '',
      isAllDayEvent: false,
      locations: [],
      setupTime: '',
      teardownTime: '',
      reservationStartTime: '',
      reservationEndTime: '',
      doorOpenTime: '',
      doorCloseTime: '',
      setupTimeMinutes: 0,
      teardownTimeMinutes: 0,
      reservationStartMinutes: 0,
      reservationEndMinutes: 0,
      setupNotes: '',
      doorNotes: '',
      eventNotes: '',
      attendeeCount: '',
      specialRequirements: '',
      reviewNotes: '',
      categories: [],
      calendarId: selectedCalendarId,
      calendarOwner: getCalendarOwner(),
      calendarName: getCalendarName(),
      virtualMeetingUrl: null,
      graphData: null,
      ...overrides,
    };
  }, [accounts, selectedCalendarId, getCalendarOwner, getCalendarName]);

  // ══════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════

  /**
   * Open the creation modal.
   * @param {Object} [overrides] - Fields to prefill (date, location, category, times, etc.)
   */
  const open = useCallback((overrides = {}) => {
    const resolvedMode = canCreateEvents ? 'event' : 'create';
    const reservation = buildBlankReservation(overrides);

    setPrefillData(reservation);
    setMode(resolvedMode);
    setFormData(null);
    setHasChanges(false);
    setIsFormValid(false);
    setIsHold(false);
    setIsConfirming(false);
    setIsDraftConfirming(false);
    setPendingMultiDayConfirmation(null);
    setDraftId(null);
    setShowDraftDialog(false);
    formDataGetterRef.current = null;
    setIsOpen(true);
  }, [canCreateEvents, buildBlankReservation]);

  /**
   * Close the creation modal. Shows draft-save dialog if there are unsaved changes.
   */
  const close = useCallback((force = false) => {
    if (!force && hasChanges) {
      setShowDraftDialog(true);
      return;
    }
    resetState();
  }, [hasChanges, resetState]);

  /**
   * Called by RoomReservationReview's onDataChange to track form state.
   */
  const updateFormData = useCallback((updatedData) => {
    setFormData(prev => ({ ...(prev || {}), ...updatedData }));
    setHasChanges(true);
    // Reset confirmations when form data changes
    if (isConfirming) setIsConfirming(false);
    if (isDraftConfirming) setIsDraftConfirming(false);
    if (pendingMultiDayConfirmation) setPendingMultiDayConfirmation(null);
  }, [isConfirming, isDraftConfirming, pendingMultiDayConfirmation]);

  /**
   * Called by RoomReservationReview's onFormDataReady to register the getter.
   */
  const setFormDataReady = useCallback((getter) => {
    formDataGetterRef.current = getter;
  }, []);

  // ── Resolve the freshest form data ──
  const getFormData = useCallback((options) => {
    return formDataGetterRef.current?.(options) || formData;
  }, [formData]);

  // ══════════════════════════════════════════════
  //  ADMIN PUBLISH  (POST /api/events/new/audit-update)
  // ══════════════════════════════════════════════

  const _handleAdminPublish = useCallback(async () => {
    const data = getFormData();
    if (!data) return;

    // Validate
    const hasDateRange = data.startDate && data.endDate;
    const hasTimes = (data.startTime || data.reservationStartTime)
      && (data.endTime || data.reservationEndTime);
    if (!hasDateRange || !hasTimes) {
      showError('Date range and times are required');
      return;
    }

    // Multi-day detection
    const hasAdHocDates = data.adHocDates?.length > 0;
    const isMultiDayRange = data.startDate !== data.endDate;
    const isMultiDay = hasAdHocDates || isMultiDayRange;

    // ── Multi-day confirmation gate ──
    if (isMultiDay) {
      if (!pendingMultiDayConfirmation) {
        // Expand dates to compute count
        const allDates = new Set();
        const startDate = new Date(data.startDate);
        const endDate = new Date(data.endDate);
        const rangeDayCount = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
        for (let i = 0; i < rangeDayCount; i++) {
          const d = new Date(startDate);
          d.setDate(startDate.getDate() + i);
          allDates.add(d.toISOString().split('T')[0]);
        }
        if (hasAdHocDates) data.adHocDates.forEach(ds => allDates.add(ds));

        setPendingMultiDayConfirmation({ eventCount: allDates.size });
        setIsConfirming(true);
        return;
      }

      // Confirmed — proceed with batch creation
      setPendingMultiDayConfirmation(null);
      setIsConfirming(false);
      setIsSaving(true);

      try {
        await _batchCreate(data);
        showSuccess('Events created and published');
        _onSuccess();
      } catch (error) {
        logger.error('Multi-day creation error:', error);
        showError(error, { context: 'useEventCreation.adminPublish.multiDay' });
      } finally {
        setIsSaving(false);
      }
      return;
    }

    // ── Single-day two-click confirmation ──
    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    setIsConfirming(false);
    setIsSaving(true);
    try {
      const graphFields = buildGraphFields(data);
      const internalFields = buildInternalFields(data);

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/new/audit-update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
        },
        body: JSON.stringify({
          graphFields,
          internalFields,
          calendarId: selectedCalendarId,
          calendarOwner: getCalendarOwner(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create event');
      }

      showSuccess('Event created and published');
      _onSuccess();
    } catch (error) {
      logger.error('Error creating event:', error);
      showError(error, { context: 'useEventCreation.adminPublish' });
    } finally {
      setIsSaving(false);
    }
  }, [getFormData, isConfirming, pendingMultiDayConfirmation, apiToken, selectedCalendarId, getCalendarOwner, showError]);

  // ══════════════════════════════════════════════
  //  MULTI-DAY BATCH CREATION
  // ══════════════════════════════════════════════

  const _batchCreate = useCallback(async (data) => {
    // Expand dates (range + ad-hoc)
    const allDates = new Set();
    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);
    const rangeDayCount = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    for (let i = 0; i < rangeDayCount; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      allDates.add(d.toISOString().split('T')[0]);
    }
    if (data.adHocDates?.length > 0) {
      data.adHocDates.forEach(ds => allDates.add(ds));
    }

    const dates = Array.from(allDates).sort();
    const eventSeriesId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    logger.debug(`[useEventCreation] Batch creating ${dates.length} events`);

    let successCount = 0;
    let failCount = 0;

    // Create each event via audit-update endpoint (correct app-only auth path)
    for (let i = 0; i < dates.length; i++) {
      const dateStr = dates[i];
      const effectiveStartTime = data.startTime || data.reservationStartTime;
      const effectiveEndTime = data.endTime || data.reservationEndTime;

      // Build per-day form data for the shared builders
      const dayData = {
        ...data,
        startDate: dateStr,
        endDate: dateStr,
      };

      const graphFields = buildGraphFields(dayData);
      const internalFields = {
        ...buildInternalFields(dayData),
        eventSeriesId,
        seriesLength: dates.length,
        seriesIndex: i,
      };

      try {
        const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/new/audit-update`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`,
          },
          body: JSON.stringify({
            graphFields,
            internalFields,
            calendarId: selectedCalendarId,
            calendarOwner: getCalendarOwner(),
          }),
        });

        if (response.ok) {
          successCount++;
        } else {
          failCount++;
          logger.error(`[useEventCreation] Batch item ${i} failed:`, response.status);
        }
      } catch (err) {
        failCount++;
        logger.error(`[useEventCreation] Batch item ${i} error:`, err);
      }
    }

    logger.debug(`[useEventCreation] Batch complete: ${successCount} succeeded, ${failCount} failed`);
    if (failCount > 0 && successCount > 0) {
      showError(`Created ${successCount} events, ${failCount} failed`);
    } else if (failCount > 0 && successCount === 0) {
      throw new Error('Failed to create events');
    }
  }, [apiToken, selectedCalendarId, getCalendarOwner, showError]);

  // ══════════════════════════════════════════════
  //  REQUESTER SUBMIT  (POST /api/events/request)
  // ══════════════════════════════════════════════

  const _handleRequesterSubmit = useCallback(async () => {
    const data = getFormData();
    if (!data) return;

    // Two-click confirmation
    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    setIsConfirming(false);
    setIsSaving(true);
    try {
      const payload = buildRequesterPayload(data, {
        calendarId: selectedCalendarId,
        calendarOwner: getCalendarOwner(),
      });

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to submit reservation');
      }

      showSuccess('Request submitted for approval');
      _onSuccess();
    } catch (error) {
      logger.error('Error submitting reservation:', error);
      showError(error, { context: 'useEventCreation.requesterSubmit' });
    } finally {
      setIsSaving(false);
    }
  }, [getFormData, isConfirming, apiToken, selectedCalendarId, getCalendarOwner, showError]);

  // ── Route handleSave to the correct path based on mode ──
  const handleSave = useCallback(() => {
    // Safety: re-check permissions at save time in case role changed
    const effectiveMode = canCreateEvents ? 'event' : 'create';
    if (effectiveMode === 'event') {
      return _handleAdminPublish();
    }
    return _handleRequesterSubmit();
  }, [canCreateEvents, _handleAdminPublish, _handleRequesterSubmit]);

  const cancelSaveConfirmation = useCallback(() => {
    setIsConfirming(false);
    setPendingMultiDayConfirmation(null);
  }, []);

  // ══════════════════════════════════════════════
  //  DRAFT SAVE  (POST/PUT /api/room-reservations/draft)
  // ══════════════════════════════════════════════

  const _executeDraftSave = useCallback(async () => {
    const processedData = getFormData({ skipValidation: true });
    if (!processedData) return false;

    const payload = buildDraftPayload(processedData);
    const endpoint = draftId
      ? `${APP_CONFIG.API_BASE_URL}/room-reservations/draft/${draftId}`
      : `${APP_CONFIG.API_BASE_URL}/room-reservations/draft`;

    const response = await fetch(endpoint, {
      method: draftId ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error('Failed to save draft');
    return true;
  }, [getFormData, draftId, apiToken]);

  const handleSaveDraft = useCallback(async () => {
    const data = formData;
    if (!data?.eventTitle?.trim()) {
      showError('Event title is required to save as draft');
      return;
    }

    // Two-click confirmation
    if (!isDraftConfirming) {
      setIsDraftConfirming(true);
      setIsConfirming(false);
      return;
    }

    setIsDraftConfirming(false);
    setSavingDraft(true);
    try {
      await _executeDraftSave();
      showSuccess('Draft saved');
      _onSuccess();
    } catch (error) {
      logger.error('Error saving draft:', error);
      showError(error, { context: 'useEventCreation.saveDraft' });
    } finally {
      setSavingDraft(false);
    }
  }, [formData, isDraftConfirming, _executeDraftSave, showError]);

  const cancelDraftConfirmation = useCallback(() => {
    setIsDraftConfirming(false);
  }, []);

  // ── Draft dialog handlers (shown when closing with unsaved changes) ──

  const handleDraftDialogSave = useCallback(async () => {
    if (!formData?.eventTitle?.trim()) {
      // Can't save without a title — just close
      setShowDraftDialog(false);
      resetState();
      return;
    }

    setSavingDraft(true);
    let savedOk = false;
    try {
      savedOk = await _executeDraftSave();
    } catch (error) {
      logger.error('Error saving draft before close:', error);
      showError(error, { context: 'useEventCreation.draftDialogSave' });
    } finally {
      setSavingDraft(false);
    }

    setShowDraftDialog(false);
    resetState();
    if (savedOk) {
      showSuccess('Draft saved');
      if (onSuccess) onSuccess();      // Non-silent calendar refresh FIRST
      dispatchRefresh(refreshSource);  // Then notify other views via bus
      dispatchRefresh(refreshSource, 'navigation-counts');
    }
  }, [formData, _executeDraftSave, resetState, showError, refreshSource, onSuccess]);

  const handleDraftDialogDiscard = useCallback(() => {
    setShowDraftDialog(false);
    resetState();
  }, [resetState]);

  const handleDraftDialogCancel = useCallback(() => {
    setShowDraftDialog(false);
  }, []);

  const canSaveDraft = useCallback(() => {
    return !!(formData?.eventTitle?.trim()) && hasChanges;
  }, [formData, hasChanges]);

  // ── Shared success handler ──
  const _onSuccess = useCallback(() => {
    resetState();
    if (onSuccess) onSuccess();      // Non-silent calendar refresh FIRST
    dispatchRefresh(refreshSource);  // Then notify other views via bus
    dispatchRefresh(refreshSource, 'navigation-counts');
  }, [resetState, refreshSource, onSuccess]);

  // ══════════════════════════════════════════════
  //  RETURN
  // ══════════════════════════════════════════════

  return {
    // State (for wiring ReviewModal props)
    isOpen,
    prefillData,
    mode,
    formData,
    hasChanges,
    isFormValid,
    isHold,
    isSaving,
    isConfirming: isConfirming || !!pendingMultiDayConfirmation,
    pendingMultiDayConfirmation,
    savingDraft,
    isDraftConfirming,
    showDraftDialog,

    // Modal control
    open,
    close,

    // Form tracking (wire to RoomReservationReview)
    updateFormData,
    setFormDataReady,
    setIsFormValid,
    setIsHold,

    // Save (routes to admin or requester based on permissions)
    handleSave,
    cancelSaveConfirmation,

    // Draft
    handleSaveDraft,
    cancelDraftConfirmation,
    handleDraftDialogSave,
    handleDraftDialogDiscard,
    handleDraftDialogCancel,
    canSaveDraft,
  };
}
