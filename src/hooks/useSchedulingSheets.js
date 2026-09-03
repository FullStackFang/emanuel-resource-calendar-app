// src/hooks/useSchedulingSheets.js
//
// Data layer for the Scheduling Sheets workbook and the derived My Assignments
// view. Thin wrappers over the /api/scheduling-sheets route family using the
// app's TanStack + useAuthenticatedFetch idiom (see ConflictReport.jsx).
//
// Concurrency contract (mirrors the backend's design D2):
//   - STRUCTURAL mutations send expectedVersion and can 409 (VERSION_CONFLICT);
//     callers surface one line + refetch, not the full ConflictDialog.
//   - CELL writes are ungated last-write-wins per cell; they never 409.
// Every mutation invalidates the sheet detail (and myAssignments, which is
// derived from the same documents).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { keys } from '../queries/keys';
import { useAuthenticatedFetch } from '../hooks/useAuthenticatedFetch';
import { applyCellToSheet } from '../components/scheduling/sheetEventUtils';
import { useAuth } from '../context/AuthContext';
import APP_CONFIG from '../config/config';

const BASE = () => `${APP_CONFIG.API_BASE_URL}/scheduling-sheets`;

async function readJsonOrThrow(response, fallbackMessage) {
  let body = null;
  try { body = await response.json(); } catch { /* non-JSON error body */ }
  if (!response.ok) {
    const error = new Error((body && body.error) || fallbackMessage);
    error.status = response.status;
    error.code = body && (body.code || (body.details && body.details.code));
    error.body = body;
    throw error;
  }
  return body;
}

export function useSchedulingSheetList() {
  const authFetch = useAuthenticatedFetch();
  const { apiToken } = useAuth();
  return useQuery({
    queryKey: keys.schedulingSheets.list(),
    enabled: !!apiToken,
    queryFn: async () => {
      const response = await authFetch(BASE(), { headers: { 'Content-Type': 'application/json' } });
      return readJsonOrThrow(response, 'Could not load scheduling sheets');
    },
  });
}

export function useSchedulingSheet(sheetId) {
  const authFetch = useAuthenticatedFetch();
  const { apiToken } = useAuth();
  return useQuery({
    queryKey: keys.schedulingSheets.detail(sheetId),
    enabled: !!apiToken && !!sheetId,
    queryFn: async () => {
      const response = await authFetch(`${BASE()}/${sheetId}`, { headers: { 'Content-Type': 'application/json' } });
      return readJsonOrThrow(response, 'Could not load the scheduling sheet');
    },
  });
}

/**
 * People directory for the @ picker. Fetched once (no q param — the endpoint
 * filters in memory anyway and the directory is small); the picker filters
 * client-side per keystroke, exactly like ReassignOwnerControl.
 */
export function useSheetUserLookup(enabled) {
  const authFetch = useAuthenticatedFetch();
  const { apiToken } = useAuth();
  return useQuery({
    queryKey: keys.schedulingSheets.userLookup(),
    enabled: !!apiToken && !!enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const response = await authFetch(`${BASE()}/user-lookup`, { headers: { 'Content-Type': 'application/json' } });
      const body = await readJsonOrThrow(response, 'Could not load people');
      return body.matches || [];
    },
  });
}

export function useMyAssignments() {
  const authFetch = useAuthenticatedFetch();
  const { apiToken } = useAuth();
  return useQuery({
    queryKey: keys.myAssignments.all(),
    enabled: !!apiToken,
    queryFn: async () => {
      const response = await authFetch(`${APP_CONFIG.API_BASE_URL}/my-assignments`, {
        headers: { 'Content-Type': 'application/json' },
      });
      return readJsonOrThrow(response, 'Could not load your assignments');
    },
  });
}

/** All the workbook mutations, sharing one invalidation strategy. */
export function useSchedulingSheetMutations(sheetId) {
  const authFetch = useAuthenticatedFetch();
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: keys.schedulingSheets.all() });
    queryClient.invalidateQueries({ queryKey: keys.myAssignments.all() });
  };

  const jsonRequest = (url, method, body) =>
    authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const createSheet = useMutation({
    mutationFn: async (body) =>
      readJsonOrThrow(await jsonRequest(BASE(), 'POST', body), 'Could not create the scheduling sheet'),
    onSuccess: invalidate,
  });

  const renameSheet = useMutation({
    mutationFn: async ({ id, ...body }) =>
      readJsonOrThrow(await jsonRequest(`${BASE()}/${id}`, 'PUT', body), 'Could not update the scheduling sheet'),
    onSuccess: invalidate,
  });

  const deleteSheet = useMutation({
    mutationFn: async (id) =>
      readJsonOrThrow(await jsonRequest(`${BASE()}/${id}`, 'DELETE'), 'Could not delete the scheduling sheet'),
    onSuccess: invalidate,
  });

  const createDay = useMutation({
    mutationFn: async (body) =>
      readJsonOrThrow(await jsonRequest(`${BASE()}/${sheetId}/days`, 'POST', body), 'Could not add the day'),
    onSuccess: invalidate,
  });

  const deleteDay = useMutation({
    mutationFn: async (dayId) =>
      readJsonOrThrow(await jsonRequest(`${BASE()}/${sheetId}/days/${dayId}`, 'DELETE'), 'Could not delete the day'),
    onSuccess: invalidate,
  });

  const updateStructure = useMutation({
    mutationFn: async ({ dayId, ...body }) =>
      readJsonOrThrow(
        await jsonRequest(`${BASE()}/${sheetId}/days/${dayId}/structure`, 'PUT', body),
        'Could not save the sheet structure'
      ),
    onSuccess: invalidate,
  });

  // Optimistic by design, not as an optimisation: the in-cell editor closes
  //  the moment it commits, so a cell painted only from the server response is
  //  blank for the whole round trip. Cell writes are ungated last-write-wins
  //  per cell, so the local paint cannot disagree with a version the server
  //  would have refused. A failure rolls the cache back and the settle
  //  invalidation resyncs either way.
  const updateCell = useMutation({
    mutationFn: async ({ dayId, rowId, colId, cell }) =>
      readJsonOrThrow(
        await jsonRequest(`${BASE()}/${sheetId}/days/${dayId}/cells/${rowId}/${colId}`, 'PUT', { cell }),
        'Could not save the cell'
      ),
    onMutate: async ({ dayId, rowId, colId, cell }) => {
      const queryKey = keys.schedulingSheets.detail(sheetId);
      // Stop an in-flight read from landing on top of the patch.
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old) => applyCellToSheet(old, dayId, rowId, colId, cell));
      return { previous, queryKey };
    },
    onError: (_error, _variables, context) => {
      if (context && context.previous !== undefined) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
    },
    onSettled: invalidate,
  });

  const sendSchedules = useMutation({
    mutationFn: async (body) =>
      readJsonOrThrow(await jsonRequest(`${BASE()}/${sheetId}/email`, 'POST', body), 'Could not send schedules'),
    onSuccess: invalidate,
  });

  return { createSheet, renameSheet, deleteSheet, createDay, deleteDay, updateStructure, updateCell, sendSchedules };
}
