// src/components/MyReservations.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { logger } from '../utils/logger';
import { useNotification } from '../context/NotificationContext';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import { usePermissions } from '../hooks/usePermissions';
import { transformEventsToFlatStructure } from '../utils/eventTransformers';
import LoadingSpinner from './shared/LoadingSpinner';
import CommunicationHistory from './CommunicationHistory';
import EditRequestForm from './EditRequestForm';
import './MyReservations.css';

export default function MyReservations({ apiToken }) {
  const navigate = useNavigate();
  const { canSubmitReservation, permissionsLoading } = usePermissions();
  const { showWarning } = useNotification();
  const [allReservations, setAllReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('draft');
  const [page, setPage] = useState(1);
  const [selectedReservation, setSelectedReservation] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [deletingDraft, setDeletingDraft] = useState(false);

  // Edit request state
  const [editRequestReservation, setEditRequestReservation] = useState(null);
  const [showEditRequestForm, setShowEditRequestForm] = useState(false);
  
  // Use room context for efficient room name resolution
  const { getRoomDetails } = useRooms();
  
  // Load all user's reservations once on mount
  useEffect(() => {
    if (apiToken) {
      loadMyReservations();
    }
  }, [apiToken]);

  // Listen for refresh event (triggered after draft submission)
  useEffect(() => {
    const handleRefresh = () => {
      if (apiToken) {
        loadMyReservations();
      }
    };

    window.addEventListener('refresh-my-reservations', handleRefresh);
    return () => window.removeEventListener('refresh-my-reservations', handleRefresh);
  }, [apiToken]);

  const loadMyReservations = async () => {
    try {
      setLoading(true);
      setError('');
      
      // Load all user's reservations (API automatically filters by user)
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/room-reservations?limit=1000`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });
      
      if (!response.ok) throw new Error('Failed to load reservations');
      
      const data = await response.json();
      // Transform reservations to flatten calendarData fields to top-level for easier access
      const transformedReservations = transformEventsToFlatStructure(data.reservations || []);
      setAllReservations(transformedReservations);
    } catch (err) {
      logger.error('Error loading user reservations:', err);
      setError('Failed to load your reservation requests');
    } finally {
      setLoading(false);
    }
  };

  // Client-side filtering with memoization
  const filteredReservations = useMemo(() => {
    if (activeTab === 'draft') {
      return allReservations.filter(r => r.status === 'draft');
    }
    if (activeTab === 'pending') {
      return allReservations.filter(r => r.status === 'pending');
    }
    if (activeTab === 'published') {
      // Published = approved status WITHOUT a pending edit request
      return allReservations.filter(r =>
        r.status === 'approved' &&
        (!r.pendingEditRequest || r.pendingEditRequest.status !== 'pending')
      );
    }
    if (activeTab === 'published_edit') {
      // Published Edit = approved status WITH a pending edit request
      return allReservations.filter(r =>
        r.status === 'approved' &&
        r.pendingEditRequest?.status === 'pending'
      );
    }
    if (activeTab === 'rejected') {
      return allReservations.filter(r => r.status === 'rejected');
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
      r.status === 'approved' &&
      (!r.pendingEditRequest || r.pendingEditRequest.status !== 'pending')
    ).length,
    published_edit: allReservations.filter(r =>
      r.status === 'approved' &&
      r.pendingEditRequest?.status === 'pending'
    ).length,
    rejected: allReservations.filter(r => r.status === 'rejected').length,
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
  
  const handleCancelRequest = async (reservation) => {
    if (!cancelReason.trim()) {
      showWarning('Please provide a reason for cancellation');
      return;
    }
    
    try {
      setCancelling(true);
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/room-reservations/${reservation._id}/cancel`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({ reason: cancelReason })
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
    } catch (err) {
      logger.error('Error cancelling reservation:', err);
      setError('Failed to cancel reservation request');
    } finally {
      setCancelling(false);
    }
  };

  const handleResubmitReservation = (reservation) => {
    // Navigate to unified booking form with resubmit mode
    navigate('/booking', {
      state: {
        reservationId: reservation._id,
        originalReservation: reservation,
        mode: 'resubmit'
      }
    });
  };

  // Handle continue editing a draft - dispatch event to open modal
  const handleEditDraft = (draft) => {
    // Dispatch custom event to open draft in modal (handled by App.jsx)
    window.dispatchEvent(new CustomEvent('open-draft-modal', {
      detail: { draft }
    }));
  };

  // Handle delete draft
  const handleDeleteDraft = async (draft) => {
    if (!window.confirm('Are you sure you want to delete this draft? This cannot be undone.')) {
      return;
    }

    try {
      setDeletingDraft(true);
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/room-reservations/draft/${draft._id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (!response.ok) throw new Error('Failed to delete draft');

      // Remove draft from local state
      setAllReservations(prev => prev.filter(r => r._id !== draft._id));
      setSelectedReservation(null);
    } catch (err) {
      logger.error('Error deleting draft:', err);
      setError('Failed to delete draft');
    } finally {
      setDeletingDraft(false);
    }
  };

  // Open edit request form for approved reservations
  const handleRequestEdit = (reservation) => {
    setEditRequestReservation(reservation);
    setShowEditRequestForm(true);
    setSelectedReservation(null); // Close the details modal
  };

  // Handle edit request form close
  const handleEditRequestClose = () => {
    setShowEditRequestForm(false);
    setEditRequestReservation(null);
  };

  // Handle edit request submission success
  const handleEditRequestSuccess = () => {
    setShowEditRequestForm(false);
    setEditRequestReservation(null);
    loadMyReservations(); // Refresh the list
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

  // Get display status (convert 'approved' to 'published' or 'published edit' for display)
  const getDisplayStatus = (reservation) => {
    if (reservation.status === 'approved') {
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
    if (status === 'approved') {
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
          onClick={() => navigate('/booking')}
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
                  {isDraft ? (
                    <>
                      <button
                        className="mr-btn mr-btn-primary"
                        onClick={() => handleEditDraft(reservation)}
                        disabled={deletingDraft}
                      >
                        Edit
                      </button>
                      <button
                        className="mr-btn mr-btn-danger"
                        onClick={() => handleDeleteDraft(reservation)}
                        disabled={deletingDraft}
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <button
                      className="mr-btn mr-btn-primary"
                      onClick={() => setSelectedReservation(reservation)}
                    >
                      View Details
                    </button>
                  )}
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
            <h2>
              {selectedReservation.status === 'pending' ? 'Cancel Reservation Request' : 'Reservation Details'}
            </h2>
            
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
            
            {selectedReservation.status === 'pending' && (
              <div className="cancel-section">
                <label htmlFor="cancelReason">Reason for Cancellation:</label>
                <textarea
                  id="cancelReason"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  rows="3"
                  placeholder="Please provide a reason for cancelling this reservation request..."
                />
              </div>
            )}
            
            <div className="modal-actions">
              {selectedReservation.status === 'pending' && (
                <button
                  className="confirm-cancel-btn"
                  onClick={() => handleCancelRequest(selectedReservation)}
                  disabled={cancelling}
                >
                  {cancelling ? 'Cancelling...' : 'Cancel Request'}
                </button>
              )}
              {selectedReservation.status === 'approved' && !selectedReservation.pendingEditRequest?.status && (
                <button
                  className="edit-request-btn"
                  onClick={() => handleRequestEdit(selectedReservation)}
                  title="Request changes to this published reservation"
                >
                  Request Edit
                </button>
              )}
              {selectedReservation.status === 'approved' && selectedReservation.pendingEditRequest?.status === 'pending' && (
                <div className="pending-edit-notice">
                  Edit request pending approval
                </div>
              )}
              {selectedReservation.status === 'rejected' && selectedReservation.resubmissionAllowed !== false && (
                <button
                  className="resubmit-btn"
                  onClick={() => handleResubmitReservation(selectedReservation)}
                  title="Edit and resubmit this reservation"
                >
                  Resubmit
                </button>
              )}
              <button
                className="close-btn"
                onClick={() => {
                  setSelectedReservation(null);
                  setCancelReason('');
                }}
                disabled={cancelling}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Request Form Modal */}
      {showEditRequestForm && editRequestReservation && (
        <EditRequestForm
          reservation={editRequestReservation}
          apiToken={apiToken}
          onClose={handleEditRequestClose}
          onSuccess={handleEditRequestSuccess}
        />
      )}
    </div>
  );
}