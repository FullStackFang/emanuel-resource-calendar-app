// Pure, dependency-free rule module. The function BODIES are byte-identical to
// the CJS twin backend/utils/eventEditability.js; only the export boundary differs.
// Parity is locked by the shared fixture
// backend/__tests__/__fixtures__/eventEditabilityCases.json, run by both
// Jest (backend) and Vitest (here).

const SERIES_CHILD_TYPES = ['occurrence', 'exception', 'addition'];

export function normalizeDepartment(d) {
  return (d || '').toLowerCase().trim();
}

export function resolveEventDepartment(event) {
  // Canonical: department stored on the event at creation. The flat
  // roomReservationData.department and the migration-unset calendarData.department
  // are intentionally NOT read (see spec decision e).
  return normalizeDepartment(event && event.roomReservationData
    && event.roomReservationData.requestedBy
    && event.roomReservationData.requestedBy.department);
}

export function resolveOwnerEmail(event) {
  const rb = event && event.roomReservationData && event.roomReservationData.requestedBy;
  const cd = event && event.calendarData;
  return (
    (rb && rb.email) ||
    (cd && cd.requesterEmail) ||
    (event && event.requesterEmail) ||
    ''
  ).toLowerCase();
}

export function isEventOwner(event, email) {
  const e = (email || '').toLowerCase();
  return !!e && resolveOwnerEmail(event) === e;
}

export function isSameDepartment(event, userDepartment) {
  const ed = resolveEventDepartment(event);
  const ud = normalizeDepartment(userDepartment);
  return !!(ud && ed && ud === ed);
}

export function isAdminEditor(user) {
  const u = user || {};
  return !!(u.canEditEvents || u.canApproveReservations);
}

export function isSeriesChild(event) {
  const t = (event && (event.eventType || (event.graphData && event.graphData.type))) || null;
  return SERIES_CHILD_TYPES.includes(t);
}

export function hasPendingEditRequest(event) {
  return !!(event && event.pendingEditRequest && event.pendingEditRequest.status === 'pending');
}

/**
 * Data-layer editability rules for events.
 *
 * `user` shape:
 *   { email, department, canSubmitReservation, canEditEvents, canApproveReservations }
 *
 * Scope note: `canRequestEditEvent` deliberately does NOT check
 * `isEditRequestMode` / `isViewingEditRequest`. Those are modal/UI-state guards
 * that the FE caller (`deriveGates`) layers on top of this rule; this module is
 * the data-layer rule only.
 *
 * Ownership/department policy: request-edit (and the request-cancellation gate
 * that the FE derives from it) is intentionally NOT restricted to the owner or
 * a same-department colleague. Any user with `canSubmitReservation` who is not
 * an admin-editor may request an edit on any published, non-series-child event
 * with no pending edit request. The former owner/same-dept/ownerless/rsched
 * gate (`isCommunityEditable`) was removed because it produced too many false
 * negatives. The pending/rejected direct-edit path (`canDirectEditEvent`)
 * remains owner-or-same-department gated.
 */
export function canRequestEditEvent(event, user) {
  const u = user || {};
  return (
    !!u.canSubmitReservation &&
    !isAdminEditor(u) &&
    !!event && event.status === 'published' &&
    !isSeriesChild(event) &&
    !hasPendingEditRequest(event)
  );
}

export function canDirectEditEvent(event, user) {
  const u = user || {};
  const status = event && event.status;
  return (
    !isAdminEditor(u) &&
    !!u.canSubmitReservation &&
    (isEventOwner(event, u.email) || isSameDepartment(event, u.department)) &&
    (status === 'pending' || status === 'rejected')
  );
}
