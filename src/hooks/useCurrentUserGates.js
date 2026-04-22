// src/hooks/useCurrentUserGates.js
import { useMemo } from 'react';
import { useMsal } from '@azure/msal-react';
import { usePermissions } from './usePermissions';

/**
 * Single source of truth for per-event permission gates.
 *
 * Invariant: the same (currentUser, event, modalContext) triple yields the
 * same gates regardless of which entrypoint calls this hook.
 *
 * @param {Object|null} event
 * @param {Object} modalContext - transient modal state that affects editability
 * @param {boolean} modalContext.isEditRequestMode - composing an edit-request
 *   proposal (save creates a pendingEditRequest, not a direct event mutation)
 * @param {boolean} modalContext.isViewingEditRequest - browsing an existing
 *   pending edit request (read-only preview, even for owners)
 */
export function useCurrentUserGates(event, modalContext = {}) {
  const { accounts } = useMsal();
  const permissions = usePermissions();
  const { isEditRequestMode = false, isViewingEditRequest = false } = modalContext;
  return useMemo(
    () => deriveGates(event, permissions, accounts, { isEditRequestMode, isViewingEditRequest }),
    [event, permissions, accounts, isEditRequestMode, isViewingEditRequest]
  );
}

/**
 * Pure gate derivation — exported for direct unit testing without React mocks.
 * Same inputs → same outputs, always.
 *
 * @param {Object|null} event
 * @param {Object} permissions - shape from usePermissions()
 * @param {Array<{username?: string}>} accounts - from useMsal()
 * @param {Object} modalContext - { isEditRequestMode, isViewingEditRequest }
 * @returns {Gates}
 */
export function deriveGates(event, permissions = {}, accounts = [], modalContext = {}) {
  const { isEditRequestMode = false, isViewingEditRequest = false } = modalContext;
  const currentUserEmail = (accounts?.[0]?.username || '').toLowerCase();
  const requesterEmail = (
    event?.roomReservationData?.requestedBy?.email
    || event?.calendarData?.requesterEmail
    || event?.requesterEmail
    || ''
  ).toLowerCase();
  const isOwner = !!currentUserEmail && !!requesterEmail && currentUserEmail === requesterEmail;
  // Ownerless: events imported from Graph sync without a roomReservationData
  // requester record. In the old Calendar formula any requester could
  // propose edits on these (treated as "open for community stewardship").
  const isOwnerless = !event?.roomReservationData?.requestedBy?.email;
  const hasPendingEditRequest = event?.pendingEditRequest?.status === 'pending';
  const hasPendingCancellationRequest = event?.pendingCancellationRequest?.status === 'pending';

  const status = event?.status || null;
  const eventType = event?.eventType || event?.graphData?.type || null;

  const isDraft = status === 'draft';
  const isPending = status === 'pending';
  const isPublished = status === 'published';
  const isRejected = status === 'rejected';
  const isDeleted = status === 'deleted';

  const isSeriesMaster = eventType === 'seriesMaster';
  const isOccurrence = eventType === 'occurrence';
  const isSingleInstance = eventType === 'singleInstance' || !eventType;
  const isExceptionOrAddition = eventType === 'exception' || eventType === 'addition';

  const {
    canEditEvents = false,
    canApproveReservations = false,
    canDeleteEvents = false,
    canSubmitReservation = false,
    isAdmin = false,
    actualRole = 'viewer',
    simulatedRole = null,
    department = null,
  } = permissions;

  const role = simulatedRole || actualRole;
  const isAdminEditor = canEditEvents || canApproveReservations;
  const isRequesterOnly = !isAdminEditor;
  // Owner-edit requires the role-level submission capability. A user without
  // canSubmitReservation cannot edit even events mistakenly attributed to them.
  // Published requester events must route through the request-edit flow.
  const isOwnerEditable =
    isOwner && canSubmitReservation && (isDraft || isPending || isRejected);
  // Edit-request mode: owner is composing a proposal on a published event.
  // The save creates a pendingEditRequest (not a direct event mutation), so
  // the normal "published events are read-only for requesters" rule gets lifted.
  const canProposeViaEditRequest =
    isEditRequestMode && isOwner && canSubmitReservation && isPublished;
  // Department-match editing: a colleague in the same department may edit a
  // teammate's pending or rejected event (e.g. help them refine the draft
  // before admin approval). Published events use the request-edit flow; drafts
  // are owner-only visible.
  const ownerDepartmentNormalized = (event?.creatorDepartment || '').toLowerCase().trim();
  const userDepartmentNormalized = (department || '').toLowerCase().trim();
  const departmentMatches = Boolean(userDepartmentNormalized && ownerDepartmentNormalized === userDepartmentNormalized);
  const canDeptColleagueEdit =
    departmentMatches && canSubmitReservation && !isOwner && (isPending || isRejected);
  // Viewing an existing edit request is always read-only — the user is
  // previewing a proposed change, not editing it.
  const canSave =
    !isDeleted &&
    !isViewingEditRequest &&
    (isAdminEditor || isOwnerEditable || canProposeViaEditRequest || canDeptColleagueEdit);

  // Recurrence pattern edit: applies to seriesMaster (modify) and
  // singleInstance (promote to recurring). Never on occurrence or
  // exception/addition docs — the pattern is master-owned there.
  const canEditRecurrence = (isSeriesMaster || isSingleInstance) && canSave;

  // Occurrence-level overrides (time/location of a single instance via exception doc).
  const canEditOccurrence = isOccurrence && (isAdminEditor || (isOwner && (isDraft || isPending)));

  const canDelete = !isDeleted && (canDeleteEvents || (isOwner && isPending));
  const canRestore = canDeleteEvents && isDeleted;

  // canRequestEdit: requester proposes changes to a PUBLISHED event.
  // Allowed for owner, department colleague, or any requester on an
  // ownerless (Graph-synced) event. Blocked while another edit request
  // is already pending, while the user is actively composing a request,
  // or while viewing an existing request's preview.
  const canRequestEdit =
    canSubmitReservation &&
    !isAdminEditor &&
    isPublished &&
    (isOwner || departmentMatches || isOwnerless) &&
    !hasPendingEditRequest &&
    !isEditRequestMode &&
    !isViewingEditRequest;

  // canRequestCancellation: same gate plus no cancellation already pending.
  const canRequestCancellation =
    canRequestEdit && !hasPendingCancellationRequest;

  const canResubmit = isOwner && isRejected;

  // Single readOnly truth — derived, not input.
  // "readOnly" in the UI context means: the editor should NOT be interactive.
  const readOnly = !canSave;

  // Recurrence tab visibility — keyed on event type, not role.
  // Recurring variants always show the tab (content gated by canEditRecurrence).
  // Single instances show the tab only if user can promote to recurring.
  const recurrenceTabVisible =
    isSeriesMaster || isOccurrence || isExceptionOrAddition || (isSingleInstance && canEditRecurrence);

  return {
    role,
    isOwner,
    isRequesterOnly,
    currentUserEmail,
    status,
    eventType,
    isSeriesMaster,
    isOccurrence,
    isSingleInstance,
    isExceptionOrAddition,
    isAdmin,
    canSave,
    canApprove: canApproveReservations && isPending,
    canReject: canApproveReservations && isPending,
    canDelete,
    canRestore,
    canEditRecurrence,
    canEditOccurrence,
    canRequestEdit,
    canRequestCancellation,
    canResubmit,
    readOnly,
    recurrenceTabVisible,
    canApproveReservations,
    canEditEvents,
    canDeleteEvents,
    canSubmitReservation,
  };
}

export default useCurrentUserGates;
