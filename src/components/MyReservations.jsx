// src/components/MyReservations.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { logger } from '../utils/logger';
import { useNotification } from '../context/NotificationContext';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import { usePermissions } from '../hooks/usePermissions';
import { transformEventsToFlatStructure } from '../utils/eventTransformers';
import LoadingSpinner from './shared/LoadingSpinner';
import CommunicationHistory from './CommunicationHistory';
import './MyReservations.css';

export default function MyReservations({ apiToken }) {
  const { canSubmitReservation, permissionsLoading } = usePermissions();
  const { showWarning, showSuccess, showError } = useNotification();
  const [allReservations, setAllReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('draft');
  const [page, setPage] = useState(1);
  const [selectedReservation, setSelectedReservation] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [isCancelConfirming, setIsCancelConfirming] = useState(false);
  const [deletingDraftId, setDeletingDraftId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [restoringId, setRestoringId] = useState(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState(null);
  const [restoreConflicts, setRestoreConflicts] = useState(null);

  // Resubmit state (in-button confirmation pattern)
  const [resubmittingId, setResubmittingId] = useState(null);
  const [confirmResubmitId, setConfirmResubmitId] = useState(null);

  // Use room context for efficient room name resolution
  const { getRoomDetails } = useRooms();
  
  const loadMyReservations = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      // Load all user's reservations including deleted (API automatically filters by user)
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/list?view=my-events&limit=1000&includeDeleted=true`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (!response.ok) throw new Error('Failed to load reservations');

      const data = await response.json();
      // Transform events to flatten calendarData fields to top-level for easier access
      const transformedReservations = transformEventsToFlatStructure(data.events || []);
      setAllReservations(transformedReservations);
    } catch (err) {
      logger.error('Error loading user reservations:', err);
      setError('Failed to load your reservation requests');
    } finally {
      setLoading(false);
    }
  }, [apiToken]);

  // Load all user's reservations once on mount
  useEffect(() => {
    if (apiToken) {
      loadMyReservations();
    }
  }, [loadMyReservations]);

  // Listen for refresh event (triggered after draft submission)
  useEffect(() => {
    const handleRefresh = () => loadMyReservations();
    window.addEventListener('refresh-my-reservations', handleRefresh);
    return () => window.removeEventListener('refresh-my-reservations', handleRefresh);
  }, [loadMyReservations]);

  // Client-side filtering with memoization
  const filteredReservations = useMemo(() => {
    if (activeTab === 'draft') {
      return allReservations.filter(r => r.status === 'draft');
    }
    if (activeTab === 'pending') {
      return allReservations.filter(r => r.status === 'pending');
    }
    if (activeTab === 'published') {
      // Published = published status WITHOUT a pending edit request
      return allReservations.filter(r =>
        r.status === 'published' &&
        (!r.pendingEditRequest || r.pendingEditRequest.status !== 'pending')
      );
    }
    if (activeTab === 'published_edit') {
      // Published Edit = published status WITH a pending edit request
      return allReservations.filter(r =>
        r.status === 'published' &&
        r.pendingEditRequest?.status === 'pending'
      );
    }
    if (activeTab === 'rejected') {
      return allReservations.filter(r => r.status === 'rejected');
    }
    if (activeTab === 'cancelled') {
      return allReservations.filter(r => r.status === 'cancelled');
    }
    if (activeTab === 'deleted') {
      return allReservations.filter(r => r.status === 'deleted');
    }
    return allReservations.filter(reservation => reservation.status === activeTab);
  }, [allReservations, activeTab]);

  // Count for each status tab
  const statusCounts = useMemo(() => ({
    draft: allReservations.filter(r => r.status === 'draft').length,
    pending: allReservations.filter(r => r.status === 'pending').length,
    published: allReservations.filter(r =>
      r.status === 'published' &&
      (!r.pendingEditRequest || r.pendingEditRequest.status !== 'pending')
    ).length,
    published_edit: allReservations.filter(r =>
      r.status === 'published' &&
      r.pendingEditRequest?.status === 'pending'
    ).length,
    rejected: allReservations.filter(r => r.status === 'rejected').length,
    cancelled: allReservations.filter(r => r.status === 'cancelled').length,
    deleted: allReservations.filter(r => r.status === 'deleted').length,
  }), [allReservations]);

  // Pagination for filtered results
  const itemsPerPage = 20;
  const totalPages = Math.ceil(filteredReservations.length / itemsPerPage);
  const startIndex = (page - 1) * itemsPerPage;
  const paginatedReservations = filteredReservations.slice(startIndex, startIndex + itemsPerPage);

  // Reset page when tab changes
  const handleTabChange = (newTab) => {
    setActiveTab(newTab);
    setPage(1);
  };
  
  // Handle cancel click - two-click confirmation pattern with inline reason input
  const handleCancelClick = (reservation) => {
    if (isCancelConfirming) {
      // Already in confirm state, check for reason and proceed
      if (!cancelReason.trim()) {
        showWarning('Please enter a cancellation reason');
        return;
      }
      handleCancelRequest(reservation);
    } else {
      // First click - enter confirm state (shows reason input)
      setIsCancelConfirming(true);
      // Auto-reset after 15 seconds if not confirmed (longer for typing reason)
      setTimeout(() => {
        setIsCancelConfirming(prev => {
          if (prev) {
            setCancelReason('');
          }
          return false;
        });
      }, 15000);
    }
  };

  const handleCancelRequest = async (reservation) => {
    try {
      setCancelling(true);
      setIsCancelConfirming(false);

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/room-reservations/${reservation._id}/cancel`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({ reason: cancelReason, _version: reservation._version || null })
      });

      if (!response.ok) throw new Error('Failed to cancel reservation');

      // Update local state
      setAllReservations(prev => prev.map(r =>
        r._id === reservation._id
          ? { ...r, status: 'cancelled', actionDate: new Date(), cancelReason: cancelReason }
          : r
      ));

      setSelectedReservation(null);
      setCancelReason('');
      showSuccess(`"${reservation.eventTitle}" has been cancelled`);
    } catch (err) {
      logger.error('Error cancelling reservation:', err);
      showError(err, { context: 'MyReservations.handleCancelRequest' });
    } finally {
      setCancelling(false);
    }
  };

  // Handle resubmit - first click shows confirm, second click resubmits
  const handleResubmitClick = (reservation) => {
    if (confirmResubmitId === reservation._id) {
      // Already in confirm state, proceed with resubmit
      handleResubmit(reservation);
    } else {
      // First click - enter confirm state
      setConfirmResubmitId(reservation._id);
      // Auto-reset after 3 seconds if not confirmed
      setTimeout(() => {
        setConfirmResubmitId(prev => prev === reservation._id ? null : prev);
      }, 3000);
    }
  };

  const handleResubmit = async (reservation) => {
    try {
      setResubmittingId(reservation._id);
      setConfirmResubmitId(null);

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/room-reservations/${reservation._id}/resubmit`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({ _version: reservation._version || null })
      });

      if (!response.ok) throw new Error('Failed to resubmit reservation');

      // Update local state
      setAllReservations(prev => prev.map(r =>
        r._id === reservation._id ? { ...r, status: 'pending' } : r
      ));
      setSelectedReservation(null);
      showSuccess(`"${reservation.eventTitle}" resubmitted for review`);
    } catch (err) {
      logger.error('Error resubmitting reservation:', err);
      showError(err, { context: 'MyReservations.handleResubmit' });
    } finally {
      setResubmittingId(null);
    }
  };

  // Handle continue editing a draft - dispatch event to open modal
  const handleEditDraft = (draft) => {
    // Dispatch custom event to open draft in modal (handled by App.jsx)
    window.dispatchEvent(new CustomEvent('open-draft-modal', {
      detail: { draft }
    }));
  };

  // Handle delete draft - first click shows confirm, second click deletes
  const handleDeleteClick = (draft) => {
    if (confirmDeleteId === draft._id) {
      // Already in confirm state, proceed with delete
      handleDeleteDraft(draft);
    } else {
      // First click - enter confirm state
      setConfirmDeleteId(draft._id);
      // Auto-reset after 3 seconds if not confirmed
      setTimeout(() => {
        setConfirmDeleteId(prev => prev === draft._id ? null : prev);
      }, 3000);
    }
  };

  const handleDeleteDraft = async (draft) => {
    try {
      setDeletingDraftId(draft._id);
      setConfirmDeleteId(null);

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/room-reservations/draft/${draft._id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (!response.ok) throw new Error('Failed to delete draft');

      // Update status to 'deleted' so counts update correctly (draft -1, deleted +1)
      setAllReservations(prev => prev.map(r =>
        r._id === draft._id ? { ...r, status: 'deleted' } : r
      ));
      setSelectedReservation(null);
      showSuccess(`"${draft.eventTitle || 'Draft'}" moved to deleted`);
    } catch (err) {
      logger.error('Error deleting draft:', err);
      showError(err, { context: 'MyReservations.handleDeleteDraft' });
    } finally {
      setDeletingDraftId(null);
    }
  };

  // Handle restore - first click shows confirm, second click restores
  const handleRestoreClick = (reservation) => {
    if (confirmRestoreId === reservation._id) {
      // Already in confirm state, proceed with restore
      handleRestore(reservation);
    } else {
      // First click - enter confirm state
      setConfirmRestoreId(reservation._id);
      // Auto-reset after 3 seconds if not confirmed
      setTimeout(() => {
        setConfirmRestoreId(prev => prev === reservation._id ? null : prev);
      }, 3000);
    }
  };

  const handleRestore = async (reservation) => {
    try {
      setRestoringId(reservation._id);
      setConfirmRestoreId(null);

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/room-reservations/${reservation._id}/restore`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({ _version: reservation._version || null })
      });

      if (response.status === 409) {
        const data = await response.json();
        if (data.error === 'SchedulingConflict') {
          setRestoreConflicts({ ...data, eventTitle: reservation.eventTitle });
          return;
        }
        throw new Error(data.message || 'Version conflict');
      }

      if (!response.ok) throw new Error('Failed to restore reservation');

      const result = await response.json();

      // Update local state with restored status
      setAllReservations(prev => prev.map(r =>
        r._id === reservation._id ? { ...r, status: result.status } : r
      ));
      setSelectedReservation(null);
      showSuccess(`"${reservation.eventTitle}" restored to ${result.status}`);
    } catch (err) {
      logger.error('Error restoring reservation:', err);
      showError(err, { context: 'MyReservations.handleRestore' });
    } finally {
      setRestoringId(null);
    }
  };

  // Calculate days until draft auto-deletes
  const getDaysUntilDelete = (draftCreatedAt) => {
    if (!draftCreatedAt) return null;
    const createdDate = new Date(draftCreatedAt);
    const deleteDate = new Date(createdDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const now = new Date();
    const daysRemaining = Math.ceil((deleteDate - now) / (24 * 60 * 60 * 1000));
    return Math.max(0, daysRemaining);
  };
  
  // Format date/time for modal display
  const formatDateTime = (date) => {
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  // Get display status for UI
  const getDisplayStatus = (reservation) => {
    if (reservation.status === 'published') {
      // Check if there's a pending edit request
      if (reservation.pendingEditRequest?.status === 'pending') {
        return 'Published Edit';
      }
      return 'Published';
    }
    // Capitalize first letter for display
    return reservation.status.charAt(0).toUpperCase() + reservation.status.slice(1);
  };

  const getStatusBadgeClass = (reservation) => {
    const status = reservation.status;
    if (status === 'published') {
      // Check if there's a pending edit request
      if (reservation.pendingEditRequest?.status === 'pending') {
        return 'status-published-edit';
      }
      return 'status-published';
    }
    switch (status) {
      case 'pending': return 'status-pending';
      case 'rejected': return 'status-rejected';
      case 'deleted': return 'status-deleted';
      case 'draft': return 'status-draft';
      default: return '';
    }
  };

  // Show loading while permissions are being determined
  if (permissionsLoading) {
    return <LoadingSpinner />;
  }

  // Access control - hide for Viewer role
  if (!canSubmitReservation) {
    return (
      <div className="my-reservations">
        <div className="access-denied">
          <h2>Access Restricted</h2>
          <p>You do not have permission to view reservations.</p>
        </div>
      </div>
    );
  }

  if (loading && allReservations.length === 0) {
    return <LoadingSpinner />;
  }

  return (
    <div className="my-reservations">
      {/* Page Header - Editorial Style */}
      <div className="my-reservations-header">
        <div className="my-reservations-header-content">
          <h1>My Reservations</h1>
          <p className="my-reservations-header-subtitle">Track and manage your room reservation requests</p>
        </div>
        <button
          className="new-reservation-btn"
          onClick={() => window.dispatchEvent(new CustomEvent('open-new-reservation-modal'))}
          disabled={!canSubmitReservation}
          title={!canSubmitReservation ? 'You do not have permission to submit reservations' : 'Create a new reservation request'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14"></path>
          </svg>
          New Reservation
        </button>
      </div>

      {error && (
        <div className="error-message">
          ❌ {error}
        </div>
      )}
      
      {/* Tab Navigation */}
      <div className="tabs-container">
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'draft' ? 'active' : ''}`}
            onClick={() => handleTabChange('draft')}
          >
            Draft
            <span className="count draft-count">({statusCounts.draft})</span>
          </button>
          <button
            className={`tab ${activeTab === 'pending' ? 'active' : ''}`}
            onClick={() => handleTabChange('pending')}
          >
            Pending
            <span className="count">({statusCounts.pending})</span>
          </button>
          <button
            className={`tab ${activeTab === 'published' ? 'active' : ''}`}
            onClick={() => handleTabChange('published')}
          >
            Published
            <span className="count">({statusCounts.published})</span>
          </button>
          <button
            className={`tab ${activeTab === 'published_edit' ? 'active' : ''}`}
            onClick={() => handleTabChange('published_edit')}
          >
            Published Edit
            <span className="count">({statusCounts.published_edit})</span>
          </button>
          <button
            className={`tab ${activeTab === 'rejected' ? 'active' : ''}`}
            onClick={() => handleTabChange('rejected')}
          >
            Rejected
            <span className="count">({statusCounts.rejected})</span>
          </button>
          <button
            className={`tab ${activeTab === 'cancelled' ? 'active' : ''}`}
            onClick={() => handleTabChange('cancelled')}
          >
            Cancelled
            <span className="count">({statusCounts.cancelled})</span>
          </button>
          <button
            className={`tab ${activeTab === 'deleted' ? 'active' : ''}`}
            onClick={() => handleTabChange('deleted')}
          >
            Deleted
            <span className="count">({statusCounts.deleted})</span>
          </button>
        </div>
      </div>
      
      {/* Reservations List */}
      <div className="mr-reservations-list">
        {paginatedReservations.map(reservation => {
          const isOnBehalfOf = reservation.roomReservationData?.contactPerson?.isOnBehalfOf;
          const contactName = reservation.roomReservationData?.contactPerson?.name;
          const isDraft = reservation.status === 'draft';

          return (
            <div key={reservation._id} className={`mr-card ${isDraft ? 'mr-card-draft' : ''}`}>
              {/* Card Header - Event Title + Actions */}
              <div className="mr-card-header">
                <div className="mr-card-title-row">
                  <h3 className="mr-card-title">{reservation.eventTitle || 'Untitled'}</h3>
                  {reservation.attendeeCount > 0 && (
                    <span className="mr-attendee-pill">{reservation.attendeeCount} attendees</span>
                  )}
                  {isOnBehalfOf && contactName && (
                    <span className="mr-delegation-pill">On behalf of {contactName}</span>
                  )}
                </div>
                <div className="mr-card-actions">
                  <button
                    className="mr-btn mr-btn-primary"
                    onClick={() => setSelectedReservation(reservation)}
                  >
                    View Details
                  </button>
                </div>
              </div>

              {/* Card Body - Key Info Grid */}
              <div className="mr-card-body">
                {/* When */}
                <div className="mr-info-block">
                  <span className="mr-info-label">When</span>
                  <div className="mr-info-value mr-datetime">
                    {reservation.startDateTime && reservation.endDateTime ? (
                      <>
                        <span className="mr-date">
                          {new Date(reservation.startDateTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </span>
                        <span className="mr-time">
                          {new Date(reservation.startDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          {' – '}
                          {new Date(reservation.endDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        </span>
                      </>
                    ) : (
                      <span className="mr-not-set">Not set</span>
                    )}
                  </div>
                </div>

                {/* Where */}
                <div className="mr-info-block">
                  <span className="mr-info-label">Where</span>
                  <div className="mr-info-value mr-rooms">
                    {reservation.requestedRooms && reservation.requestedRooms.length > 0 ? (
                      reservation.requestedRooms.map(roomId => {
                        const roomDetails = getRoomDetails(roomId);
                        return (
                          <span key={roomId} className="mr-room-tag" title={roomDetails.location || ''}>
                            {roomDetails.name}
                          </span>
                        );
                      })
                    ) : (
                      <span className="mr-not-set">None selected</span>
                    )}
                  </div>
                </div>

                {/* Submitted/Saved */}
                <div className="mr-info-block">
                  <span className="mr-info-label">{isDraft ? 'Saved' : 'Submitted'}</span>
                  <div className="mr-info-value mr-submitted">
                    {new Date(isDraft
                      ? (reservation.lastDraftSaved || reservation.submittedAt)
                      : reservation.submittedAt
                    ).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>

                {/* Status Info (contextual) */}
                <div className="mr-info-block">
                  <span className="mr-info-label">
                    {isDraft ? 'Expires' : reservation.rejectionReason ? 'Reason' : 'Updated'}
                  </span>
                  <div className="mr-info-value mr-status-info">
                    {isDraft && reservation.draftCreatedAt ? (
                      <span className="mr-expires">in {getDaysUntilDelete(reservation.draftCreatedAt)} days</span>
                    ) : reservation.rejectionReason ? (
                      <span className="mr-rejection" title={reservation.rejectionReason}>{reservation.rejectionReason}</span>
                    ) : reservation.actionDate && reservation.status !== 'pending' ? (
                      <span>{new Date(reservation.actionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    ) : (
                      <span className="mr-not-set">—</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Description Preview (if exists) */}
              {reservation.eventDescription && (
                <div className="mr-card-description">
                  {reservation.eventDescription}
                </div>
              )}
            </div>
          );
        })}

        {paginatedReservations.length === 0 && !loading && (
          <div className="mr-empty-state">
            <div className="mr-empty-icon">
              {activeTab === 'draft' ? '📝' : activeTab === 'pending' ? '⏳' : activeTab === 'published' ? '✅' : activeTab === 'rejected' ? '❌' : activeTab === 'deleted' ? '🗑️' : '📁'}
            </div>
            <h3>No {activeTab === 'published_edit' ? 'pending edits' : activeTab} reservations</h3>
            <p>
              {activeTab === 'draft'
                ? "You don't have any saved drafts."
                : activeTab === 'pending'
                ? "You don't have any pending requests."
                : activeTab === 'published'
                ? "You don't have any published reservations."
                : activeTab === 'published_edit'
                ? "No reservations with pending edit requests."
                : activeTab === 'rejected'
                ? "You don't have any rejected reservations."
                : activeTab === 'deleted'
                ? "You don't have any deleted reservations."
                : `You don't have any ${activeTab} reservations.`}
            </p>
          </div>
        )}
      </div>
      
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <button
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span className="page-info">Page {page} of {totalPages}</span>
          <button
            disabled={page === totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
      
      {/* Details/Cancel Modal */}
      {selectedReservation && (
        <div className="details-modal-overlay">
          <div className="details-modal">
            <h2>Reservation Details</h2>
            
            <div className="reservation-details">
              <div className="detail-row">
                <label>Event:</label>
                <div>{selectedReservation.eventTitle}</div>
              </div>

              {selectedReservation.isOnBehalfOf && selectedReservation.contactName && (
                <div className="detail-row">
                  <label>Submitted for:</label>
                  <div>
                    {selectedReservation.contactName} ({selectedReservation.contactEmail})
                    <div className="delegation-note">Updates will be sent to this contact</div>
                  </div>
                </div>
              )}
              
              <div className="detail-row">
                <label>Date & Time:</label>
                <div>
                  {formatDateTime(selectedReservation.startDateTime)} - {formatDateTime(selectedReservation.endDateTime)}
                </div>
              </div>
              
              <div className="detail-row">
                <label>Rooms:</label>
                <div>
                  {selectedReservation.requestedRooms.map(roomId => {
                    const roomDetails = getRoomDetails(roomId);
                    return roomDetails.location ? 
                      `${roomDetails.name} (${roomDetails.location})` : 
                      roomDetails.name;
                  }).join(', ')}
                </div>
              </div>

              <div className="detail-row">
                <label>Status:</label>
                <div>
                  <span className={`status-badge ${getStatusBadgeClass(selectedReservation)}`}>
                    {getDisplayStatus(selectedReservation)}
                  </span>
                </div>
              </div>
              
              
              {selectedReservation.eventDescription && (
                <div className="detail-row">
                  <label>Description:</label>
                  <div>{selectedReservation.eventDescription}</div>
                </div>
              )}

              {selectedReservation.specialRequirements && (
                <div className="detail-row">
                  <label>Special Requirements:</label>
                  <div>{selectedReservation.specialRequirements}</div>
                </div>
              )}

              {selectedReservation.rejectionReason && (
                <div className="detail-row">
                  <label>Rejection Reason:</label>
                  <div className="rejection-text">{selectedReservation.rejectionReason}</div>
                </div>
              )}

              {selectedReservation.cancelReason && (
                <div className="detail-row">
                  <label>Cancellation Reason:</label>
                  <div className="cancel-text">{selectedReservation.cancelReason}</div>
                </div>
              )}
            </div>

            {/* Communication History */}
            {selectedReservation.communicationHistory && selectedReservation.communicationHistory.length > 0 && (
              <CommunicationHistory reservation={selectedReservation} />
            )}

            <div className="modal-actions">
              {/* Draft actions: Edit + Delete */}
              {selectedReservation.status === 'draft' && (
                <>
                  <button
                    className="edit-request-btn"
                    onClick={() => {
                      setSelectedReservation(null);
                      handleEditDraft(selectedReservation);
                    }}
                    title="Edit this draft"
                  >
                    Edit
                  </button>
                  <button
                    className={`mr-btn mr-btn-danger ${confirmDeleteId === selectedReservation._id ? 'confirm' : ''}`}
                    onClick={() => handleDeleteClick(selectedReservation)}
                    disabled={deletingDraftId === selectedReservation._id}
                  >
                    {deletingDraftId === selectedReservation._id
                      ? 'Deleting...'
                      : confirmDeleteId === selectedReservation._id
                        ? 'Confirm?'
                        : 'Delete'}
                  </button>
                </>
              )}
              {/* Pending actions: Cancel Request + Edit */}
              {selectedReservation.status === 'pending' && (
                <>
                  <div className="cancel-confirm-group">
                    {isCancelConfirming && (
                      <input
                        type="text"
                        className="cancel-reason-input"
                        placeholder="Cancellation reason (required)"
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        disabled={cancelling}
                        autoFocus
                      />
                    )}
                    <button
                      className={`confirm-cancel-btn ${isCancelConfirming ? 'confirming' : ''}`}
                      onClick={() => handleCancelClick(selectedReservation)}
                      disabled={cancelling || (isCancelConfirming && !cancelReason.trim())}
                    >
                      {cancelling ? 'Cancelling...' : (isCancelConfirming ? 'Confirm Cancel?' : 'Cancel Request')}
                    </button>
                    {isCancelConfirming && (
                      <button
                        type="button"
                        className="cancel-confirm-x"
                        onClick={() => {
                          setIsCancelConfirming(false);
                          setCancelReason('');
                        }}
                        title="Cancel"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <button
                    className="edit-request-btn"
                    onClick={() => {
                      const reservation = selectedReservation;
                      setSelectedReservation(null);
                      window.dispatchEvent(new CustomEvent('open-edit-pending-modal', {
                        detail: { event: reservation }
                      }));
                    }}
                    title="Edit this pending reservation"
                  >
                    Edit
                  </button>
                </>
              )}
              {selectedReservation.status === 'published' && !selectedReservation.pendingEditRequest?.status && (
                <button
                  className="edit-request-btn"
                  onClick={() => {
                    const reservation = selectedReservation;
                    setSelectedReservation(null);
                    window.dispatchEvent(new CustomEvent('open-edit-request-modal', {
                      detail: { event: reservation }
                    }));
                  }}
                  title="Request changes to this published reservation"
                >
                  Request Edit
                </button>
              )}
              {selectedReservation.status === 'published' && selectedReservation.pendingEditRequest?.status === 'pending' && (
                <div className="pending-edit-notice">
                  Edit request pending approval
                </div>
              )}
              {selectedReservation.status === 'rejected' && selectedReservation.resubmissionAllowed !== false && (
                <button
                  className={`resubmit-btn ${confirmResubmitId === selectedReservation._id ? 'confirm' : ''}`}
                  onClick={() => handleResubmitClick(selectedReservation)}
                  disabled={resubmittingId === selectedReservation._id}
                  title="Resubmit this reservation for review"
                >
                  {resubmittingId === selectedReservation._id
                    ? 'Resubmitting...'
                    : confirmResubmitId === selectedReservation._id
                      ? 'Confirm?'
                      : 'Resubmit'}
                </button>
              )}
              {selectedReservation.status === 'cancelled' && (
                <button
                  className={`restore-btn ${confirmRestoreId === selectedReservation._id ? 'confirm' : ''}`}
                  onClick={() => handleRestoreClick(selectedReservation)}
                  disabled={restoringId === selectedReservation._id}
                  title="Restore this reservation to its previous status"
                >
                  {restoringId === selectedReservation._id
                    ? 'Restoring...'
                    : confirmRestoreId === selectedReservation._id
                      ? 'Confirm?'
                      : 'Restore'}
                </button>
              )}
              {selectedReservation.status === 'deleted' && (
                <button
                  className={`restore-btn ${confirmRestoreId === selectedReservation._id ? 'confirm' : ''}`}
                  onClick={() => handleRestoreClick(selectedReservation)}
                  disabled={restoringId === selectedReservation._id}
                  title="Restore this reservation to its previous status"
                >
                  {restoringId === selectedReservation._id
                    ? 'Restoring...'
                    : confirmRestoreId === selectedReservation._id
                      ? 'Confirm?'
                      : 'Restore'}
                </button>
              )}
              <button
                className="close-btn"
                onClick={() => {
                  setSelectedReservation(null);
                  setCancelReason('');
                  setIsCancelConfirming(false);
                }}
                disabled={cancelling}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scheduling Conflict Modal */}
      {restoreConflicts && (
        <div className="mr-modal-overlay" onClick={() => setRestoreConflicts(null)}>
          <div className="mr-scheduling-conflict-modal" onClick={e => e.stopPropagation()}>
            <h3>Scheduling Conflict</h3>
            <p>
              Cannot restore &quot;{restoreConflicts.eventTitle}&quot; because
              {' '}{restoreConflicts.conflicts.length} conflicting event{restoreConflicts.conflicts.length > 1 ? 's' : ''} now
              {' '}occupy the same room and time.
            </p>
            <ul className="mr-conflict-list">
              {restoreConflicts.conflicts.map(c => (
                <li key={c.id}>
                  <strong>{c.eventTitle}</strong>
                  <span className="mr-conflict-time">
                    {formatDateTime(c.startDateTime)} &ndash; {formatDateTime(c.endDateTime)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mr-conflict-guidance">
              Please submit a new reservation with different times, or contact an admin to override.
            </p>
            <div className="mr-conflict-actions">
              <button
                className="mr-btn-close"
                onClick={() => setRestoreConflicts(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}