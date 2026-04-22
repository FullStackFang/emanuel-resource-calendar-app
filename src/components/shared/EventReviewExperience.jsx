/**
 * EventReviewExperience — Unified rendering of ReviewModal + RoomReservationReview + ConflictDialogs.
 *
 * Centralizes the structural wiring that was previously duplicated across
 * Calendar.jsx, MyReservations.jsx, and ReservationRequests.jsx:
 *   - ReviewModal with all shared props (spread from getReviewModalProps + satellite state)
 *   - RoomReservationReview with key={reinitKey} (cannot be forgotten)
 *   - ConflictDialog for version conflicts
 *   - ConflictDialog for soft scheduling conflicts
 *
 * Consumers only pass: the experience object, permissions, title/mode, and
 * genuinely-unique props (calendar selection, navigation, withdrawal, etc.).
 */
import React from 'react';
import ReviewModal from './ReviewModal';
import RoomReservationReview from '../RoomReservationReview';
import ConflictDialog from './ConflictDialog';
import { useCurrentUserGates } from '../../hooks/useCurrentUserGates';

export default function EventReviewExperience({
  // The hook instance (return value from useEventReviewExperience)
  experience: exp,

  // --- Consumer-computed values ---
  title,              // string — modal title
  modalMode,          // 'review' | 'edit' | 'new'
  canRequestEdit,     // boolean — caller refines gate with pendingEditRequest state
  canRequestCancellation, // boolean — caller refines gate with pendingCancellationRequest state

  // --- Consumer-specific ReviewModal props (optional, pre-gated by caller) ---
  onResubmit,
  isResubmitting,
  onRestore,
  isRestoring,
  onSavePendingEdit,
  savingPendingEdit,
  onSaveRejectedEdit,
  savingRejectedEdit,
  isNavigating,

  // --- Cancellation withdrawal (MyReservations-specific) ---
  onWithdrawCancellationRequest,
  isWithdrawingCancellationRequest,
  isWithdrawCancellationConfirming,
  onCancelWithdrawCancellation,

  // --- RoomReservationReview consumer-specific props ---
  graphToken,
  availableCalendars,
  defaultCalendar,
  selectedTargetCalendar,
  onTargetCalendarChange,
  createCalendarEvent,
  onCreateCalendarEventChange,
  onLockedEventClick,
  onNavigateToSeriesEvent,
  onIsNavigatingChange,

  // --- ConflictDialog refresh ---
  onConflictRefresh,
}) {
  // Single source of truth for per-event gates. Derived from the current user's
  // identity + role + the event's state. The previous permissions/readOnly/
  // isRequesterOnly props were removed — callers can no longer diverge.
  const gates = useCurrentUserGates(exp.currentItem);

  const itemStatus = exp.currentItem?.status || 'published';
  const isPending = itemStatus === 'pending';

  const canApproveReservations = gates.canApproveReservations;
  const canEditEvents = gates.canEditEvents;
  const effectiveCanDelete = gates.canDelete;
  const effectiveReadOnly = gates.readOnly;
  const isRequesterOnly = gates.isRequesterOnly;

  // Requester name: editableData is already flat (from transformEventToFlatStructure)
  const requesterName = exp.editableData?.requesterName || '';

  // Compute detected changes once per render (not twice in JSX props)
  const detectedChanges = exp.isEditRequestMode ? exp.computeDetectedChanges() : [];

  return (
    <>
      <ReviewModal
        {...exp.getReviewModalProps()}
        // Context-dependent props
        title={title || exp.editableData?.eventTitle || 'Event'}
        modalMode={modalMode || (isPending ? 'review' : 'edit')}
        mode={isPending ? 'review' : 'edit'}
        isPending={isPending}
        isNavigating={isNavigating}
        isRequesterOnly={isRequesterOnly}
        itemStatus={itemStatus}
        requesterName={requesterName}
        hasChanges={exp.isEditRequestMode ? detectedChanges.length > 0 : exp.hasChanges}
        // Permission-gated core actions (override spread defaults)
        onApprove={gates.canApprove ? exp.handleApprove : null}
        onReject={gates.canReject ? exp.handleReject : null}
        onSave={gates.canSave && !exp.isDraft && canEditEvents ? exp.handleSave : null}
        onDelete={effectiveCanDelete && itemStatus !== 'deleted' ? exp.handleDelete : null}
        onRestore={onRestore || (gates.canRestore ? exp.handleRestore : null)}
        // Gate-derived recurrence editability — replaces ReviewModal's legacy
        // default=true behavior. Now always explicit.
        canEditRecurrence={gates.canEditRecurrence}
        isRestoring={isRestoring}
        // Requester actions (pre-gated by caller)
        onResubmit={onResubmit}
        isResubmitting={isResubmitting}
        onSavePendingEdit={onSavePendingEdit}
        savingPendingEdit={savingPendingEdit}
        onSaveRejectedEdit={onSaveRejectedEdit}
        savingRejectedEdit={savingRejectedEdit}
        // Edit request viewing (from experience hook)
        existingEditRequest={exp.existingEditRequest}
        isViewingEditRequest={exp.isViewingEditRequest}
        loadingEditRequest={exp.loadingEditRequest}
        onViewEditRequest={exp.handleViewEditRequest}
        onViewOriginalEvent={exp.handleViewOriginalEvent}
        // Edit request mode (from experience hook)
        canRequestEdit={canRequestEdit}
        onRequestEdit={exp.handleRequestEdit}
        isEditRequestMode={exp.isEditRequestMode}
        onSubmitEditRequest={exp.handleSubmitEditRequest}
        onCancelEditRequest={exp.handleCancelEditRequest}
        originalData={exp.flatOriginalEventData}
        detectedChanges={detectedChanges}
        // Edit request approve/reject (from experience hook, permission-gated)
        onApproveEditRequest={canApproveReservations ? exp.handleApproveEditRequest : null}
        onRejectEditRequest={canApproveReservations ? exp.handleRejectEditRequest : null}
        // Cancel pending edit request (from experience hook)
        onCancelPendingEditRequest={exp.handleCancelPendingEditRequest}
        isCancelingEditRequest={exp.isCancelingEditRequest}
        isCancelEditRequestConfirming={exp.isCancelEditRequestConfirming}
        onCancelCancelEditRequest={exp.cancelCancelEditRequestConfirmation}
        // Cancellation request (from experience hook)
        canRequestCancellation={canRequestCancellation}
        onRequestCancellation={exp.handleRequestCancellation}
        isCancellationRequestMode={exp.isCancellationRequestMode}
        cancellationReason={exp.cancellationReason}
        onCancellationReasonChange={exp.setCancellationReason}
        onSubmitCancellationRequest={exp.handleSubmitCancellationRequest}
        onCancelCancellationRequest={exp.handleCancelCancellationRequest}
        isSubmittingCancellationRequest={exp.isSubmittingCancellationRequest}
        existingCancellationRequest={exp.currentItem?.pendingCancellationRequest}
        onApproveCancellationRequest={canApproveReservations ? exp.handleApproveCancellationRequest : null}
        onRejectCancellationRequest={canApproveReservations ? exp.handleRejectCancellationRequest : null}
        // Cancellation withdrawal (MyReservations-specific)
        onWithdrawCancellationRequest={onWithdrawCancellationRequest}
        isWithdrawingCancellationRequest={isWithdrawingCancellationRequest}
        isWithdrawCancellationConfirming={isWithdrawCancellationConfirming}
        onCancelWithdrawCancellation={onCancelWithdrawCancellation}
      >
        {exp.currentItem && (
          <RoomReservationReview
            key={exp.reinitKey}
            reservation={exp.editableData}
            prefetchedAvailability={exp.prefetchedAvailability}
            prefetchedSeriesEvents={exp.prefetchedSeriesEvents}
            apiToken={exp.apiToken}
            graphToken={graphToken}
            onDataChange={exp.updateData}
            onFormDataReady={exp.setFormDataGetter}
            onFormValidChange={exp.setIsFormValid}
            readOnly={effectiveReadOnly}
            editScope={exp.editScope}
            onSchedulingConflictsChange={(hasConflicts, conflictInfo) => {
              exp.setSchedulingConflictInfo(conflictInfo || null);
            }}
            onHoldChange={exp.setIsHold}
            // Calendar-specific
            onNavigateToSeriesEvent={onNavigateToSeriesEvent}
            onIsNavigatingChange={onIsNavigatingChange}
            // ReservationRequests-specific
            availableCalendars={availableCalendars}
            defaultCalendar={defaultCalendar}
            selectedTargetCalendar={selectedTargetCalendar}
            onTargetCalendarChange={onTargetCalendarChange}
            createCalendarEvent={createCalendarEvent}
            onCreateCalendarEventChange={onCreateCalendarEventChange}
            onLockedEventClick={onLockedEventClick}
          />
        )}
      </ReviewModal>

      {/* Conflict Dialog for version conflicts */}
      <ConflictDialog
        isOpen={!!exp.conflictInfo}
        onClose={() => {
          exp.dismissConflict();
          exp.closeModal(true);
          onConflictRefresh?.();
        }}
        onRefresh={() => {
          exp.dismissConflict();
          exp.closeModal(true);
          onConflictRefresh?.();
        }}
        conflictType={exp.conflictInfo?.conflictType}
        eventTitle={exp.conflictInfo?.eventTitle}
        details={exp.conflictInfo?.details}
        staleData={exp.conflictInfo?.staleData}
      />

      {/* Soft Conflict Confirmation Dialog */}
      {exp.softConflictConfirmation && (
        <ConflictDialog
          isOpen={true}
          onClose={exp.dismissSoftConflictConfirmation}
          onConfirm={exp.softConflictConfirmation.retryFn}
          conflictType="soft_conflict"
          eventTitle={exp.currentItem?.eventTitle || 'Event'}
          details={{ message: exp.softConflictConfirmation.message }}
        />
      )}
    </>
  );
}
