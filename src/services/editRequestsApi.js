/**
 * editRequestsApi — thin wrapper around the Phase 1b first-class
 * /api/edit-requests endpoint surface. Each method returns the parsed JSON
 * body on success or throws on non-2xx responses.
 *
 * Callers must supply an authenticated fetch (`authFetch`) that includes the
 * bearer token. This module does not own auth.
 *
 * Phase 1c migration: replaces the legacy embedded-model URLs:
 *   POST   /events/:id/request-edit          → POST   /edit-requests
 *   GET    /events/:id/edit-requests         → GET    /edit-requests?eventId=...
 *   GET    /admin/edit-requests              → GET    /edit-requests?status=pending
 *   PUT    /events/edit-requests/:id/cancel  → PUT    /edit-requests/:id/withdraw
 *   PUT    /admin/events/:id/publish-edit    → PUT    /edit-requests/:id/approve
 *   PUT    /admin/events/:id/reject-edit     → PUT    /edit-requests/:id/reject
 */

import APP_CONFIG from '../config/config';

const BASE = `${APP_CONFIG.API_BASE_URL}/edit-requests`;

async function readJsonOrThrow(response, fallbackMessage) {
  if (response.ok) return response.json();
  let body;
  try {
    body = await response.json();
  } catch (_) {
    body = {};
  }
  // Prefer body.message (human-readable) over body.error (often a code like
  // DUPLICATE_PENDING_REQUEST). Both stay attached on the error for consumers
  // that want to branch on the code.
  const error = new Error(body.message || body.error || fallbackMessage);
  error.status = response.status;
  error.body = body;
  error.code = body.error || null;
  throw error;
}

/**
 * POST /api/edit-requests — create a new edit request.
 * Caller responsibility: payload includes `eventId` plus the proposed-changes
 * fields. Returns { editRequestId, requestId, eventId, _version, ... }.
 */
export async function createEditRequest(authFetch, payload) {
  const response = await authFetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readJsonOrThrow(response, 'Failed to submit edit request');
}

/**
 * GET /api/edit-requests — list with filters.
 * Returns { editRequests: [...], totalCount, limit, skip }.
 */
export async function listEditRequests(authFetch, { eventId, userId, status, limit, skip, sort } = {}) {
  const params = new URLSearchParams();
  if (eventId) params.set('eventId', eventId);
  if (userId) params.set('userId', userId);
  if (status) params.set('status', status);
  if (limit != null) params.set('limit', String(limit));
  if (skip != null) params.set('skip', String(skip));
  if (sort) params.set('sort', sort);

  const url = params.toString() ? `${BASE}?${params.toString()}` : BASE;
  const response = await authFetch(url);
  return readJsonOrThrow(response, 'Failed to list edit requests');
}

/**
 * GET /api/edit-requests/:id — single request + parent event hydration +
 * baselineShifted advisory.
 */
export async function getEditRequest(authFetch, editRequestDocId) {
  const response = await authFetch(`${BASE}/${editRequestDocId}`);
  return readJsonOrThrow(response, 'Failed to fetch edit request');
}

/**
 * PUT /api/edit-requests/:id/withdraw — requester self-withdraws.
 */
export async function withdrawEditRequest(authFetch, editRequestDocId, { editRequestVersion } = {}) {
  const response = await authFetch(`${BASE}/${editRequestDocId}/withdraw`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(editRequestVersion != null && { editRequestVersion }),
    }),
  });
  return readJsonOrThrow(response, 'Failed to withdraw edit request');
}

/**
 * PUT /api/edit-requests/:id/reject — approver rejects with required reason.
 */
export async function rejectEditRequest(authFetch, editRequestDocId, { reason, editRequestVersion } = {}) {
  const response = await authFetch(`${BASE}/${editRequestDocId}/reject`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reason,
      ...(editRequestVersion != null && { editRequestVersion }),
    }),
  });
  return readJsonOrThrow(response, 'Failed to reject edit request');
}

/**
 * PUT /api/edit-requests/:id/approve — approver applies the edit.
 * Two-write OCC: editRequestVersion + eventVersion. On Write 2 409, the
 * response body carries `partialFailure: true`.
 */
export async function approveEditRequest(authFetch, editRequestDocId, payload = {}) {
  const response = await authFetch(`${BASE}/${editRequestDocId}/approve`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readJsonOrThrow(response, 'Failed to approve edit request');
}

/**
 * Lower-level approve that returns the full Response object for callers that
 * need to inspect 409 bodies (scheduling conflicts, partialFailure) inline
 * rather than catching thrown errors.
 */
export async function approveEditRequestRaw(authFetch, editRequestDocId, payload = {}) {
  return authFetch(`${BASE}/${editRequestDocId}/approve`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
