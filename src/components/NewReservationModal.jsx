// src/components/NewReservationModal.jsx
//
// Thin shell that listens for the 'open-new-reservation-modal' custom event
// (dispatched by MyReservations "New Reservation" or "Duplicate" button) and
// delegates all creation orchestration to the shared useEventCreation hook.
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

  // Listen for custom event from MyReservations (supports optional detail payload for duplicate prefill)
  useEffect(() => {
    const handleOpen = (e) => creation.open(e.detail || {});
    window.addEventListener('open-new-reservation-modal', handleOpen);
    return () => window.removeEventListener('open-new-reservation-modal', handleOpen);
  }, [creation.open]);

  return (
    <ReviewModal
      isOpen={creation.isOpen}
      title={creation.isDuplicateMode ? 'Duplicate Event' : 'Event'}
      modalMode="new"
      mode={creation.mode === 'event' ? 'edit' : 'create'}
      saveButtonLabel={creation.mode === 'event' ? 'Publish' : null}
      onClose={creation.close}
      onSave={creation.isDuplicateMode ? null : creation.handleSave}
      onSaveDraft={creation.isDuplicateMode ? null : creation.handleSaveDraft}
      savingDraft={creation.savingDraft}
      isDraftConfirming={creation.isDraftConfirming}
      onCancelDraft={creation.cancelDraftConfirmation}
      showDraftDialog={creation.showDraftDialog}
      onDraftDialogSave={creation.handleDraftDialogSave}
      onDraftDialogDiscard={creation.handleDraftDialogDiscard}
      onDraftDialogCancel={creation.handleDraftDialogCancel}
      canSaveDraft={creation.isDuplicateMode ? false : creation.canSaveDraft()}
      hasChanges={creation.isDuplicateMode ? creation.duplicateDates.length > 0 : creation.hasChanges}
      isFormValid={creation.isFormValid}
      isSaving={creation.isSaving || creation.submittingDuplicate}
      isSaveConfirming={creation.isConfirming}
      onCancelSave={creation.cancelSaveConfirmation}
      isHold={creation.isHold}
      showTabs={true}
      onDuplicate={creation.isDuplicateMode ? creation.handleDuplicateSubmit : null}
      duplicateDateCount={creation.duplicateDates.length}
      submittingDuplicate={creation.submittingDuplicate}
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
          isDuplicateMode={creation.isDuplicateMode}
          duplicateDates={creation.duplicateDates}
          onDuplicateDatesChange={creation.setDuplicateDates}
          sourceEventDate={creation.sourceEventDate}
        />
      )}
    </ReviewModal>
  );
}
