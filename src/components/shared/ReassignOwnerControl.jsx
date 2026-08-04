// src/components/shared/ReassignOwnerControl.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import APP_CONFIG from '../../config/config';
import { logger } from '../../utils/logger';
import { useNotification } from '../../context/NotificationContext';
import useScrollLock from '../../hooks/useScrollLock';
import './ReassignOwnerControl.css';

// Design D8: the result list is capped, not scrolled. Showing at most this
// many matches plus an honest overflow count keeps every match accounted for
// and makes typing the way forward — no max-height, no overflow.
const MAX_VISIBLE_MATCHES = 5;

/**
 * Approver-only transfer of event ownership (roomReservationData.requestedBy).
 *
 * The caller is responsible for the permission gate — this component renders
 * whatever it is given. The user list comes from GET /api/users, which is
 * already approver-gated, so the picker's data source and the caller's gate
 * agree by construction. The fetch is lazy (first open) so the gated call never
 * fires for sessions that never use the control.
 *
 * Collapsed at rest (one trigger line); the trigger opens a centered modal
 * (same category-modal pattern as ClergySelectorModal) so the picker never
 * reflows the surrounding grid. Selecting a user collapses the search to the
 * pending transfer: current owner, chosen owner, commit.
 *
 * @param {string} eventId - Mongo _id of the event being reassigned
 * @param {string} apiToken
 * @param {string} currentOwnerName - Shown in the pending-transfer summary
 * @param {string} currentOwnerEmail - Excluded from the picker
 * @param {number|null} expectedVersion - OCC guard sent with the request
 * @param {Function} onReassigned - (result|null) => void. Result on success
 *   (carries the server's new _version and requestedBy); null on a 409, which
 *   means "server state moved, reload the event".
 * @param {string} triggerClassName - Styling hook for the trigger button; the
 *   caller decides whether it reads as a link or a header chip.
 * @param {React.ReactNode} triggerContent - Visible trigger content.
 * @param {string|null} triggerAriaLabel - Accessible name when the visible
 *   content alone does not say what the button does (e.g. a cell header).
 */
export default function ReassignOwnerControl({
  eventId,
  apiToken,
  currentOwnerName = '',
  currentOwnerEmail = '',
  expectedVersion = null,
  onReassigned = null,
  triggerClassName = 'reassign-owner-trigger',
  triggerContent = 'Reassign',
  triggerAriaLabel = null,
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

  function resetPickerState() {
    setSearch('');
    setSelectedUser(null);
    setIsConfirming(false);
    setError('');
  }

  const handleClose = useCallback(() => {
    setIsOpen(false);
    resetPickerState();
  }, []);

  const handleToggle = useCallback(() => {
    setIsOpen(prev => {
      const next = !prev;
      if (next) loadUsers();
      else resetPickerState();
      return next;
    });
  }, [loadUsers]);

  // Lock body scroll and close on ESC while the modal is open
  useScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, handleClose]);

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) handleClose();
  };

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

  // Cap, don't scroll: every hidden match is counted, never silently cut off.
  const shownUsers = visibleUsers.slice(0, MAX_VISIBLE_MATCHES);
  const hiddenCount = Math.max(0, visibleUsers.length - MAX_VISIBLE_MATCHES);

  const handleSelect = (user) => {
    setSelectedUser(user);
    setIsConfirming(false);
    setError('');
  };

  const handleChangeSelection = () => {
    setSelectedUser(null);
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
      handleClose();
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
        className={triggerClassName}
        data-testid="reassign-owner-trigger"
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={triggerAriaLabel || undefined}
      >
        {triggerContent}
      </button>

      {isOpen && (
        <div className="category-modal-overlay" onClick={handleOverlayClick}>
          <div className="category-modal reassign-owner-modal">
            <div className="category-modal-header">
              <h3 className="category-modal-title">Reassign Owner</h3>
              <button
                type="button"
                className="category-modal-close"
                data-testid="reassign-owner-close"
                onClick={handleClose}
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <div className="category-modal-content reassign-owner-picker" data-testid="reassign-owner-picker">
              {selectedUser ? (
                // Selection collapses the search to the pending transfer
                <div className="reassign-owner-pending" data-testid="reassign-owner-pending">
                  <span className="reassign-owner-pending-party">
                    <span className="reassign-owner-option-name">{currentOwnerName || currentOwnerEmail || 'Current owner'}</span>
                    {currentOwnerEmail && <span className="reassign-owner-option-email">{currentOwnerEmail}</span>}
                  </span>
                  <span className="reassign-owner-pending-arrow" aria-hidden="true">&rarr;</span>
                  <span className="reassign-owner-pending-party">
                    <span className="reassign-owner-option-name">{selectedUser.displayName || selectedUser.email}</span>
                    <span className="reassign-owner-option-email">{selectedUser.email}</span>
                  </span>
                  <button
                    type="button"
                    className="reassign-owner-change"
                    data-testid="reassign-owner-change"
                    onClick={handleChangeSelection}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  {(currentOwnerName || currentOwnerEmail) && (
                    <div className="reassign-owner-current">
                      Current owner: <strong>{currentOwnerName || currentOwnerEmail}</strong>
                      {currentOwnerName && currentOwnerEmail && (
                        <span className="reassign-owner-option-email"> {currentOwnerEmail}</span>
                      )}
                    </div>
                  )}

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

                  {!loadingUsers && shownUsers.length > 0 && (
                    <ul className="reassign-owner-list">
                      {shownUsers.map(user => (
                        <li key={user._id}>
                          <button
                            type="button"
                            className="reassign-owner-option"
                            data-testid={`reassign-owner-option-${user._id}`}
                            onClick={() => handleSelect(user)}
                          >
                            <span className="reassign-owner-option-name">{user.displayName || user.email}</span>
                            <span className="reassign-owner-option-email">{user.email}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {!loadingUsers && hiddenCount > 0 && (
                    <div className="reassign-owner-overflow" data-testid="reassign-owner-overflow">
                      {hiddenCount} more match{hiddenCount === 1 ? '' : 'es'} &mdash; keep typing to narrow the list.
                    </div>
                  )}
                </>
              )}

              {error && (
                <div className="reassign-owner-error" data-testid="reassign-owner-error" role="alert">
                  {error}
                </div>
              )}
            </div>

            <div className="category-modal-footer">
              <button
                type="button"
                className="category-btn category-btn-cancel"
                data-testid="reassign-owner-cancel"
                onClick={handleClose}
              >
                Cancel
              </button>
              {selectedUser && (
                <button
                  type="button"
                  className={`reassign-owner-commit${isConfirming ? ' confirm' : ''}`}
                  data-testid="reassign-owner-commit"
                  onClick={handleCommit}
                  disabled={isSubmitting}
                >
                  {commitLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
