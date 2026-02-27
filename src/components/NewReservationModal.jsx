// src/components/NewReservationModal.jsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import RoomReservationReview from './RoomReservationReview';
import ReviewModal from './shared/ReviewModal';
import { useMsal } from '@azure/msal-react';
import { usePermissions } from '../hooks/usePermissions';
import { useNotification } from '../context/NotificationContext';
import APP_CONFIG from '../config/config';
import { dispatchRefresh } from '../hooks/useDataRefreshBus';
import { logger } from '../utils/logger';

/**
 * Modal for creating new reservations from MyReservations page.
 * - Admin/Approver: "Add Event" with direct publish to Graph/Outlook
 * - Requester: "Request Event" with submit-for-approval flow
 */
export default function NewReservationModal({ apiToken, selectedCalendarId, availableCalendars }) {
  const { accounts } = useMsal();
  const { canCreateEvents } = usePermissions();
  const { showSuccess, showError, showWarning } = useNotification();

  // Modal state
  const [isOpen, setIsOpen] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isFormValid, setIsFormValid] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [formData, setFormData] = useState(null);

  // Draft state
  const [showDraftDialog, setShowDraftDialog] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftId, setDraftId] = useState(null);
  const [isDraftConfirming, setIsDraftConfirming] = useState(false);

  // Build reservation object for RoomReservationReview (same pattern as Calendar.jsx handleDayCellClick)
  const newReservation = useMemo(() => {
    const calendarOwner = availableCalendars?.find(cal => cal.id === selectedCalendarId)?.owner?.address?.toLowerCase();
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
      doorOpenTime: '',
      doorCloseTime: '',
      setupTimeMinutes: 0,
      teardownTimeMinutes: 0,
      setupNotes: '',
      doorNotes: '',
      eventNotes: '',
      attendeeCount: '',
      specialRequirements: '',
      reviewNotes: '',
      calendarId: selectedCalendarId,
      calendarOwner,
      calendarName: availableCalendars?.find(cal => cal.id === selectedCalendarId)?.name,
      virtualMeetingUrl: null,
      graphData: null,
    };
  }, [accounts, selectedCalendarId, availableCalendars]);

  // Listen for custom event from MyReservations
  useEffect(() => {
    const handleOpen = () => {
      setIsOpen(true);
      setHasChanges(false);
      setFormData(null);
      setIsConfirming(false);
      setDraftId(null);
    };
    window.addEventListener('open-new-reservation-modal', handleOpen);
    return () => window.removeEventListener('open-new-reservation-modal', handleOpen);
  }, []);

  const resetState = useCallback(() => {
    setIsOpen(false);
    setHasChanges(false);
    setIsFormValid(false);
    setIsSaving(false);
    setIsConfirming(false);
    setFormData(null);
    setShowDraftDialog(false);
    setSavingDraft(false);
    setDraftId(null);
    setIsDraftConfirming(false);
  }, []);

  const handleClose = useCallback(() => {
    if (hasChanges) {
      setShowDraftDialog(true);
      return;
    }
    resetState();
  }, [hasChanges, resetState]);

  const handleSuccess = useCallback(() => {
    resetState();
    dispatchRefresh('new-reservation-modal');
  }, [resetState]);

  // Build draft payload from form data
  const buildDraftPayload = useCallback((data) => {
    return {
      eventTitle: data.eventTitle || '',
      eventDescription: data.eventDescription || '',
      startDateTime: data.startDate && data.startTime
        ? `${data.startDate}T${data.startTime}`
        : null,
      endDateTime: data.endDate && data.endTime
        ? `${data.endDate}T${data.endTime}`
        : null,
      startDate: data.startDate || null,
      startTime: data.startTime || null,
      endDate: data.endDate || null,
      endTime: data.endTime || null,
      attendeeCount: parseInt(data.attendeeCount) || 0,
      requestedRooms: data.requestedRooms || data.locations || [],
      specialRequirements: data.specialRequirements || '',
      department: data.department || '',
      phone: data.phone || '',
      setupTime: data.setupTime || null,
      teardownTime: data.teardownTime || null,
      doorOpenTime: data.doorOpenTime || null,
      doorCloseTime: data.doorCloseTime || null,
      categories: data.categories || data.mecCategories || [],
      services: data.services || {},
      virtualMeetingUrl: data.virtualMeetingUrl || null,
      isOffsite: data.isOffsite || false,
      offsiteName: data.offsiteName || '',
      offsiteAddress: data.offsiteAddress || ''
    };
  }, []);

  // Admin: publish event directly via audit-update endpoint (same endpoint Calendar page uses)
  const handleAdminPublish = useCallback(async () => {
    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    if (!formData) return;

    setIsSaving(true);
    setIsConfirming(false);
    try {
      const selectedCalendar = availableCalendars?.find(cal => cal.id === selectedCalendarId);
      const calendarOwner = selectedCalendar?.owner?.address?.toLowerCase() || null;

      // Build datetime strings
      const startDateTime = formData.startDate && formData.startTime
        ? `${formData.startDate}T${formData.startTime}:00` : '';
      const endDateTime = formData.endDate && formData.endTime
        ? `${formData.endDate}T${formData.endTime}:00` : '';

      // Graph fields — the backend resolves room IDs to display names automatically
      const graphFields = {
        subject: formData.eventTitle || 'Untitled Event',
        start: { dateTime: startDateTime, timeZone: 'Eastern Standard Time' },
        end: { dateTime: endDateTime, timeZone: 'Eastern Standard Time' },
        body: { contentType: 'text', content: formData.eventDescription || '' },
        categories: formData.categories || formData.mecCategories || [],
        isAllDay: false,
      };

      // Internal fields — room IDs, timing, offsite, services
      const internalFields = {
        locations: formData.requestedRooms || formData.locations || [],
        setupMinutes: formData.setupTimeMinutes || 0,
        teardownMinutes: formData.teardownTimeMinutes || 0,
        setupTime: formData.setupTime || '',
        teardownTime: formData.teardownTime || '',
        doorOpenTime: formData.doorOpenTime || '',
        doorCloseTime: formData.doorCloseTime || '',
        setupNotes: formData.setupNotes || '',
        doorNotes: formData.doorNotes || '',
        eventNotes: formData.eventNotes || '',
        isOffsite: formData.isOffsite || false,
        offsiteName: formData.offsiteName || '',
        offsiteAddress: formData.offsiteAddress || '',
        offsiteLat: formData.offsiteLat || null,
        offsiteLon: formData.offsiteLon || null,
        services: formData.services || {},
      };

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/new/audit-update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({
          graphFields,
          internalFields,
          calendarId: selectedCalendarId,
          calendarOwner,
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create event');
      }

      showSuccess('Event created successfully');
      handleSuccess();
    } catch (error) {
      logger.error('Error creating event:', error);
      showError(error, { context: 'NewReservationModal.handleAdminPublish' });
    } finally {
      setIsSaving(false);
    }
  }, [isConfirming, formData, apiToken, selectedCalendarId, availableCalendars, showSuccess, showError, handleSuccess]);

  // Requester: submit request via direct API call
  const handleRequesterSubmit = useCallback(async () => {
    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }
    if (!formData) return;

    setIsSaving(true);
    setIsConfirming(false);
    try {
      const startDateTime = formData.startDate && formData.startTime
        ? `${formData.startDate}T${formData.startTime}` : '';
      const endDateTime = formData.endDate && formData.endTime
        ? `${formData.endDate}T${formData.endTime}` : '';

      const payload = {
        ...formData,
        startDateTime,
        endDateTime,
        attendeeCount: parseInt(formData.attendeeCount) || 0,
        calendarId: selectedCalendarId,
        calendarOwner: availableCalendars?.find(cal => cal.id === selectedCalendarId)?.owner?.address?.toLowerCase(),
      };
      delete payload.startDate;
      delete payload.startTime;
      delete payload.endDate;
      delete payload.endTime;

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to submit reservation');
      }

      showSuccess('Reservation request submitted');
      handleSuccess();
    } catch (error) {
      logger.error('Error submitting reservation:', error);
      showError(error, { context: 'NewReservationModal.handleRequesterSubmit' });
    } finally {
      setIsSaving(false);
    }
  }, [isConfirming, formData, apiToken, selectedCalendarId, availableCalendars, showSuccess, showError, handleSuccess]);

  // Save draft (two-click confirmation, same pattern as handleAdminPublish)
  const handleSaveDraft = useCallback(async () => {
    if (!formData || !formData.eventTitle?.trim()) {
      showWarning('Event title is required to save as draft');
      return;
    }

    // First click - show confirmation
    if (!isDraftConfirming) {
      setIsDraftConfirming(true);
      setIsConfirming(false); // Clear other confirmations
      return;
    }

    // Second click - execute save
    setSavingDraft(true);
    setIsDraftConfirming(false);
    try {
      const payload = buildDraftPayload(formData);
      const endpoint = draftId
        ? `${APP_CONFIG.API_BASE_URL}/room-reservations/draft/${draftId}`
        : `${APP_CONFIG.API_BASE_URL}/room-reservations/draft`;

      const response = await fetch(endpoint, {
        method: draftId ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error('Failed to save draft');
      }

      const result = await response.json();
      showSuccess('Draft saved');
      handleSuccess();
    } catch (error) {
      logger.error('Error saving draft:', error);
      showError(error, { context: 'NewReservationModal.handleSaveDraft' });
    } finally {
      setSavingDraft(false);
    }
  }, [formData, draftId, isDraftConfirming, apiToken, buildDraftPayload, showSuccess, showError, showWarning, handleSuccess]);

  // Draft dialog handlers
  const handleDraftDialogSave = useCallback(async () => {
    if (!formData || !formData.eventTitle?.trim()) {
      setShowDraftDialog(false);
      resetState();
      return;
    }

    setSavingDraft(true);
    let savedSuccessfully = false;
    try {
      const payload = buildDraftPayload(formData);
      const endpoint = draftId
        ? `${APP_CONFIG.API_BASE_URL}/room-reservations/draft/${draftId}`
        : `${APP_CONFIG.API_BASE_URL}/room-reservations/draft`;

      const response = await fetch(endpoint, {
        method: draftId ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error('Failed to save draft');
      savedSuccessfully = true;
    } catch (error) {
      logger.error('Error saving draft before close:', error);
      showError(error, { context: 'NewReservationModal.handleDraftDialogSave' });
    } finally {
      setSavingDraft(false);
    }

    setShowDraftDialog(false);
    resetState();
    if (savedSuccessfully) {
      dispatchRefresh('new-reservation-modal');
    }
  }, [formData, draftId, apiToken, buildDraftPayload, resetState, showError]);

  const handleDraftDialogDiscard = useCallback(() => {
    setShowDraftDialog(false);
    resetState();
  }, [resetState]);

  const handleDraftDialogCancel = useCallback(() => {
    setShowDraftDialog(false);
  }, []);

  return (
      <ReviewModal
        isOpen={isOpen}
        title={canCreateEvents ? 'Add Event' : 'Request Event'}
        mode={canCreateEvents ? 'edit' : 'create'}
        saveButtonLabel={canCreateEvents ? 'Publish' : null}
        onClose={handleClose}
        onSave={canCreateEvents ? handleAdminPublish : handleRequesterSubmit}
        onSaveDraft={handleSaveDraft}
        savingDraft={savingDraft}
        isDraftConfirming={isDraftConfirming}
        onCancelDraft={() => setIsDraftConfirming(false)}
        showDraftDialog={showDraftDialog}
        onDraftDialogSave={handleDraftDialogSave}
        onDraftDialogDiscard={handleDraftDialogDiscard}
        onDraftDialogCancel={handleDraftDialogCancel}
        canSaveDraft={!!(formData?.eventTitle?.trim()) && hasChanges}
        hasChanges={hasChanges}
        isFormValid={isFormValid}
        isSaving={isSaving}
        isSaveConfirming={isConfirming}
        onCancelSave={() => setIsConfirming(false)}
        showTabs={true}
      >
        {isOpen && (
          <RoomReservationReview
            reservation={newReservation}
            apiToken={apiToken}
            onDataChange={(updatedData) => {
              setFormData(prev => ({ ...(prev || {}), ...updatedData }));
              setHasChanges(true);
            }}
            onFormValidChange={setIsFormValid}
            readOnly={false}
          />
        )}
      </ReviewModal>
  );
}
