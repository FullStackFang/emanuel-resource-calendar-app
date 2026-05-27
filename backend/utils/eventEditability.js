// Pure, dependency-free rule module. The function BODIES are byte-identical to
// the ESM twin src/utils/eventEditability.js; only the export boundary differs.
// Parity is locked by the shared fixture
// backend/__tests__/__fixtures__/eventEditabilityCases.json, run by both
// Jest (here) and Vitest (frontend).

const SERIES_CHILD_TYPES = ['occurrence', 'exception', 'addition'];

function normalizeDepartment(d) {
  return (d || '').toLowerCase().trim();
}

function resolveEventDepartment(event) {
  // Canonical: department stored on the event at creation. The flat
  // roomReservationData.department and the migration-unset calendarData.department
  // are intentionally NOT read (see spec decision e).
  return normalizeDepartment(event && event.roomReservationData
    && event.roomReservationData.requestedBy
    && event.roomReservationData.requestedBy.department);
}

function resolveOwnerEmail(event) {
  const rb = event && event.roomReservationData && event.roomReservationData.requestedBy;
  const cd = event && event.calendarData;
  return (
    (rb && rb.email) ||
    (cd && cd.requesterEmail) ||
    (event && event.requesterEmail) ||
    ''
  ).toLowerCase();
}

function isEventOwner(event, email) {
  const e = (email || '').toLowerCase();
  return !!e && resolveOwnerEmail(event) === e;
}

function isEventOwnerless(event) {
  return !(event && event.roomReservationData
    && event.roomReservationData.requestedBy
    && event.roomReservationData.requestedBy.email);
}

function isRschedImported(event) {
  return !!event && event.source === 'rsSched';
}

function isSameDepartment(event, userDepartment) {
  const ed = resolveEventDepartment(event);
  const ud = normalizeDepartment(userDepartment);
  return !!(ud && ed && ud === ed);
}

function isCommunityEditable(event, user) {
  const u = user || {};
  return (
    isEventOwner(event, u.email) ||
    isSameDepartment(event, u.department) ||
    isEventOwnerless(event) ||
    isRschedImported(event)
  );
}

function isAdminEditor(user) {
  const u = user || {};
  return !!(u.canEditEvents || u.canApproveReservations);
}

function isSeriesChild(event) {
  const t = (event && (event.eventType || (event.graphData && event.graphData.type))) || null;
  return SERIES_CHILD_TYPES.includes(t);
}

function hasPendingEditRequest(event) {
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
 * Department source: `resolveEventDepartment` reads ONLY the creation-time
 * `roomReservationData.requestedBy.department` by design — that is the single
 * canonical source. `calendarData.department` (migration-unset) and the flat
 * `roomReservationData.department` (display-only) are intentionally ignored.
 *
 * Owner email fallbacks (`resolveOwnerEmail`): `calendarData.requesterEmail`
 * covers legacy rsched imports; top-level `requesterEmail` covers broadcast
 * payloads.
 */
function canRequestEditEvent(event, user) {
  const u = user || {};
  return (
    !!u.canSubmitReservation &&
    !isAdminEditor(u) &&
    !!event && event.status === 'published' &&
    !isSeriesChild(event) &&
    isCommunityEditable(event, u) &&
    !hasPendingEditRequest(event)
  );
}

function canDirectEditEvent(event, user) {
  const u = user || {};
  const status = event && event.status;
  return (
    !isAdminEditor(u) &&
    !!u.canSubmitReservation &&
    (isEventOwner(event, u.email) || isSameDepartment(event, u.department)) &&
    (status === 'pending' || status === 'rejected')
  );
}

module.exports = {
  normalizeDepartment,
  resolveEventDepartment,
  resolveOwnerEmail,
  isEventOwner,
  isEventOwnerless,
  isRschedImported,
  isSameDepartment,
  isCommunityEditable,
  isAdminEditor,
  isSeriesChild,
  hasPendingEditRequest,
  canRequestEditEvent,
  canDirectEditEvent,
};
