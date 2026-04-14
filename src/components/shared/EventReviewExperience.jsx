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

export default function EventReviewExperience({
  // The hook instance (return value from useEventReviewExperience)
  experience: exp,

  // --- Consumer-computed values ---
  title,              // string — modal title
  modalMode,          // 'review' | 'edit' | 'new'
  isRequesterOnly,    // boolean — true when user is requester (not admin/approver)
  canRequestEdit,     // boolean — fully computed by caller (Calendar has ownership logic)
  canRequestCancellation, // boolean — fully computed by caller

  // --- Permissions (standard action gating) ---
  permissions = {},
  // permissions.canApproveReservations — gates approve/reject
  // permissions.canEditEvents — gates admin save
  // permissions.canDeleteEvents — gates delete/restore

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
  readOnly,
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
  const { canApproveReservations, canEditEvents, canDeleteEvents } = permissions;
  const itemStatus = exp.currentItem?.status || 'published';
  const isPending = itemStatus === 'pending';

  // Requester name resolution (same fallback chain as Calendar)
  const requesterName =
    exp.currentItem?.roomReservationData?.requestedBy?.name
    || exp.currentItem?.calendarData?.requesterName
    || exp.currentItem?.requesterName
    || '';

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
        hasChanges={exp.isEditRequestMode ? exp.computeDetectedChanges().length > 0 : exp.hasChanges}
        // Permission-gated core actions (override spread defaults)
        onApprove={canApproveReservations ? exp.handleApprove : null}
        onReject={canApproveReservations ? exp.handleReject : null}
        onSave={canEditEvents && !exp.isDraft ? exp.handleSave : null}
        onDelete={canDeleteEvents && itemStatus !== 'deleted' ? exp.handleDelete : null}
        onRestore={onRestore || (canDeleteEvents && itemStatus === 'deleted' ? exp.handleRestore : null)}
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
        detectedChanges={exp.isEditRequestMode ? exp.computeDetectedChanges() : []}
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
            readOnly={readOnly}
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
