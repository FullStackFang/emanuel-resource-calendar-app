// src/components/shared/ReassignOwnerControl.jsx
import React, { useCallback, useMemo, useRef, useState } from 'react';
import APP_CONFIG from '../../config/config';
import { logger } from '../../utils/logger';
import { useNotification } from '../../context/NotificationContext';
import './ReassignOwnerControl.css';

/**
 * Approver-only transfer of event ownership (roomReservationData.requestedBy).
 *
 * The caller is responsible for the permission gate — this component renders
 * whatever it is given. The user list comes from GET /api/users, which is
 * already approver-gated, so the picker's data source and the caller's gate
 * agree by construction. The fetch is lazy (first open) so the gated call never
 * fires for sessions that never use the control.
 *
 * @param {string} eventId - Mongo _id of the event being reassigned
 * @param {string} apiToken
 * @param {string} currentOwnerEmail - Excluded from the picker
 * @param {number|null} expectedVersion - OCC guard sent with the request
 * @param {Function} onReassigned - (result|null) => void. Result on success
 *   (carries the server's new _version and requestedBy); null on a 409, which
 *   means "server state moved, reload the event".
 */
export default function ReassignOwnerControl({
  eventId,
  apiToken,
  currentOwnerEmail = '',
  expectedVersion = null,
  onReassigned = null,
}) {
  const { showSuccess, showError } = useNotification();

  const [isOpen, setIsOpen] = useState(false);
  const [users, setUsers] = useState(null);        // null = not yet loaded
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Guards against a second fetch when the picker is reopened. `users` alone
  // can't do this — a failed load leaves it null and should be retryable.
  const hasLoadedRef = useRef(false);

  const loadUsers = useCallback(async () => {
    if (hasLoadedRef.current || loadingUsers) return;
    setLoadingUsers(true);
    setError('');
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/users`, {
        headers: { 'Authorization': `Bearer ${apiToken}` },
      });
      if (!response.ok) throw new Error(`Failed to load users (${response.status})`);
      const data = await response.json();
      setUsers(Array.isArray(data) ? data : []);
      hasLoadedRef.current = true;
    } catch (err) {
      logger.error('ReassignOwnerControl: failed to load users', err);
      setError('Could not load the user list. Close and try again.');
    } finally {
      setLoadingUsers(false);
    }
  }, [apiToken, loadingUsers]);

  const handleToggle = useCallback(() => {
    setIsOpen(prev => {
      const next = !prev;
      if (next) loadUsers();
      else resetPickerState();
      return next;
    });
  }, [loadUsers]);

  function resetPickerState() {
    setSearch('');
    setSelectedUser(null);
    setIsConfirming(false);
    setError('');
  }

  const normalizedOwner = (currentOwnerEmail || '').toLowerCase();

  const visibleUsers = useMemo(() => {
    const list = (users || []).filter(
      u => u.email && u.email.toLowerCase() !== normalizedOwner
    );
    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter(u =>
      (u.displayName || '').toLowerCase().includes(term) ||
      (u.email || '').toLowerCase().includes(term)
    );
  }, [users, normalizedOwner, search]);

  const handleSelect = (user) => {
    setSelectedUser(user);
    setIsConfirming(false);
    setError('');
  };

  const handleCommit = async () => {
    if (!selectedUser || isSubmitting) return;

    // Standard in-button confirmation: first click arms, second click commits.
    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/events/${eventId}/reassign`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`,
          },
          body: JSON.stringify({ targetUserId: selectedUser._id, expectedVersion }),
        }
      );

      const result = await response.json().catch(() => ({}));

      if (response.status === 409) {
        // A single-field transfer doesn't warrant the full ConflictDialog —
        // one line plus a parent reload is the whole remedy.
        setError('This event changed while the picker was open. Refreshing — try again.');
        setIsConfirming(false);
        onReassigned?.(null);
        return;
      }

      if (!response.ok) {
        throw new Error(result.error || `Reassignment failed (${response.status})`);
      }

      showSuccess(`Event reassigned to ${selectedUser.displayName || selectedUser.email}.`);
      setIsOpen(false);
      resetPickerState();
      onReassigned?.(result);
    } catch (err) {
      logger.error('ReassignOwnerControl: reassignment failed', err);
      setIsConfirming(false);
      showError(err.message || 'Failed to reassign this event.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const commitLabel = isSubmitting
    ? 'Reassigning...'
    : isConfirming
      ? 'Confirm?'
      : 'Reassign';

  return (
    <div className="reassign-owner">
      <button
        type="button"
        className="reassign-owner-trigger"
        data-testid="reassign-owner-trigger"
        onClick={handleToggle}
        aria-expanded={isOpen}
      >
        Reassign
      </button>

      {isOpen && (
        <div className="reassign-owner-picker" data-testid="reassign-owner-picker">
          <input
            type="text"
            className="reassign-owner-search"
            data-testid="reassign-owner-search"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search users"
          />

          {loadingUsers && (
            <div className="reassign-owner-empty">Loading users...</div>
          )}

          {!loadingUsers && visibleUsers.length === 0 && (
            <div className="reassign-owner-empty">No matching users.</div>
          )}

          {!loadingUsers && visibleUsers.length > 0 && (
            <ul className="reassign-owner-list">
              {visibleUsers.map(user => (
                <li key={user._id}>
                  <button
                    type="button"
                    className={`reassign-owner-option${selectedUser?._id === user._id ? ' is-selected' : ''}`}
                    data-testid={`reassign-owner-option-${user._id}`}
                    onClick={() => handleSelect(user)}
                    aria-pressed={selectedUser?._id === user._id}
                  >
                    <span className="reassign-owner-option-name">{user.displayName || user.email}</span>
                    <span className="reassign-owner-option-email">{user.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <div className="reassign-owner-error" data-testid="reassign-owner-error" role="alert">
              {error}
            </div>
          )}

          <button
            type="button"
            className={`reassign-owner-commit${isConfirming ? ' confirm' : ''}`}
            data-testid="reassign-owner-commit"
            onClick={handleCommit}
            disabled={!selectedUser || isSubmitting}
          >
            {commitLabel}
          </button>
        </div>
      )}
    </div>
  );
}
