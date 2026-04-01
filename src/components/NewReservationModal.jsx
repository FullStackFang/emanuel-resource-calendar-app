// src/components/NewReservationModal.jsx
//
// Thin shell that listens for the 'open-new-reservation-modal' custom event
// (dispatched by MyReservations "New Reservation" button) and delegates all
// creation orchestration to the shared useEventCreation hook.
import { useEffect } from 'react';
import RoomReservationReview from './RoomReservationReview';
import ReviewModal from './shared/ReviewModal';
import { useEventCreation } from '../hooks/useEventCreation';

export default function NewReservationModal({ apiToken, selectedCalendarId, availableCalendars }) {
  const creation = useEventCreation({
    apiToken,
    selectedCalendarId,
    availableCalendars,
    refreshSource: 'new-reservation-modal',
  });

  // Listen for custom event (supports optional detail payload for prefill)
  useEffect(() => {
    const handleOpen = (e) => creation.open(e.detail || {});
    window.addEventListener('open-new-reservation-modal', handleOpen);
    return () => window.removeEventListener('open-new-reservation-modal', handleOpen);
  }, [creation.open]);

  return (
    <ReviewModal
      isOpen={creation.isOpen}
      title="Event"
      modalMode="new"
      mode={creation.mode === 'event' ? 'edit' : 'create'}
      saveButtonLabel={creation.mode === 'event' ? 'Publish' : null}
      onClose={creation.close}
      onSave={creation.handleSave}
      onSaveDraft={creation.handleSaveDraft}
      savingDraft={creation.savingDraft}
      isDraftConfirming={creation.isDraftConfirming}
      onCancelDraft={creation.cancelDraftConfirmation}
      showDraftDialog={creation.showDraftDialog}
      onDraftDialogSave={creation.handleDraftDialogSave}
      onDraftDialogDiscard={creation.handleDraftDialogDiscard}
      onDraftDialogCancel={creation.handleDraftDialogCancel}
      canSaveDraft={creation.canSaveDraft()}
      hasChanges={creation.hasChanges}
      isFormValid={creation.isFormValid}
      isSaving={creation.isSaving}
      isSaveConfirming={creation.isConfirming}
      onCancelSave={creation.cancelSaveConfirmation}
      isHold={creation.isHold}
      showTabs={true}
    >
      {creation.isOpen && (
        <RoomReservationReview
          reservation={creation.prefillData}
          apiToken={apiToken}
          onDataChange={creation.updateFormData}
          onFormDataReady={creation.setFormDataReady}
          onFormValidChange={creation.setIsFormValid}
          onHoldChange={creation.setIsHold}
          readOnly={false}
        />
      )}
    </ReviewModal>
  );
}
