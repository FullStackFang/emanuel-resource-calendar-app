// src/hooks/useCurrentUserGates.js
import { useMemo } from 'react';
import { useMsal } from '@azure/msal-react';
import { usePermissions } from './usePermissions';

/**
 * Single source of truth for per-event permission gates.
 *
 * Invariant: the same (currentUser, event) pair must yield the same gates
 * regardless of the entrypoint calling this hook. Callers pass only the event;
 * identity and role come from hooks. Per-caller permission derivation is the
 * thing this module exists to replace.
 *
 * Consumers should read the returned fields directly and never re-derive
 * permission-like decisions from the raw permission flags.
 */
export function useCurrentUserGates(event) {
  const { accounts } = useMsal();
  const permissions = usePermissions();
  return useMemo(
    () => deriveGates(event, permissions, accounts),
    [event, permissions, accounts]
  );
}

/**
 * Pure gate derivation — exported for direct unit testing without React mocks.
 * Same inputs → same outputs, always.
 *
 * @param {Object|null} event
 * @param {Object} permissions - shape from usePermissions()
 * @param {Array<{username?: string}>} accounts - from useMsal()
 * @returns {Gates}
 */
export function deriveGates(event, permissions = {}, accounts = []) {
  const currentUserEmail = (accounts?.[0]?.username || '').toLowerCase();
  const requesterEmail = (
    event?.roomReservationData?.requestedBy?.email
    || event?.calendarData?.requesterEmail
    || event?.requesterEmail
    || ''
  ).toLowerCase();
  const isOwner = !!currentUserEmail && !!requesterEmail && currentUserEmail === requesterEmail;

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
  } = permissions;

  const role = simulatedRole || actualRole;
  const isAdminEditor = canEditEvents || canApproveReservations;
  const isRequesterOnly = !isAdminEditor;
  // Owner-edit requires the role-level submission capability. A user without
  // canSubmitReservation cannot edit even events mistakenly attributed to them.
  // Published requester events must route through the request-edit flow.
  const isOwnerEditable =
    isOwner && canSubmitReservation && (isDraft || isPending || isRejected);
  const canSave = !isDeleted && (isAdminEditor || isOwnerEditable);

  // Recurrence pattern edit: applies to seriesMaster (modify) and
  // singleInstance (promote to recurring). Never on occurrence or
  // exception/addition docs — the pattern is master-owned there.
  const canEditRecurrence = (isSeriesMaster || isSingleInstance) && canSave;

  // Occurrence-level overrides (time/location of a single instance via exception doc).
  const canEditOccurrence = isOccurrence && (isAdminEditor || (isOwner && (isDraft || isPending)));

  const canDelete = !isDeleted && (canDeleteEvents || (isOwner && isPending));
  const canRestore = canDeleteEvents && isDeleted;

  const canRequestEdit =
    canSubmitReservation && !isAdminEditor && isPublished && isOwner;

  const canRequestCancellation = canRequestEdit;

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
