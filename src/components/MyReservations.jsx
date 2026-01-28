// src/components/MyReservations.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { logger } from '../utils/logger';
import { useNotification } from '../context/NotificationContext';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import { usePermissions } from '../hooks/usePermissions';
import LoadingSpinner from './shared/LoadingSpinner';
import CommunicationHistory from './CommunicationHistory';
import EditRequestForm from './EditRequestForm';
import './MyReservations.css';

export default function MyReservations({ apiToken }) {
  const navigate = useNavigate();
  const { canSubmitReservation } = usePermissions();
  const { showWarning } = useNotification();
  const [allReservations, setAllReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('drafts');
  const [page, setPage] = useState(1);
  const [selectedReservation, setSelectedReservation] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [deletingDraft, setDeletingDraft] = useState(false);

  // Edit request state
  const [editRequestReservation, setEditRequestReservation] = useState(null);
  const [showEditRequestForm, setShowEditRequestForm] = useState(false);
  
  // Use room context for efficient room name resolution
  const { getRoomName, getRoomDetails, loading: roomsLoading } = useRooms();
  
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
      setAllReservations(data.reservations || []);
    } catch (err) {
      logger.error('Error loading user reservations:', err);
      setError('Failed to load your reservation requests');
    } finally {
      setLoading(false);
    }
  };

  // Client-side filtering with memoization
  const filteredReservations = useMemo(() => {
    if (activeTab === 'all') {
      // 'all' shows everything except drafts by default
      return allReservations.filter(r => r.status !== 'draft');
    }
    if (activeTab === 'drafts') {
      return allReservations.filter(r => r.status === 'draft');
    }
    return allReservations.filter(reservation => reservation.status === activeTab);
  }, [allReservations, activeTab]);

  // Count drafts for tab badge
  const draftsCount = useMemo(() =>
    allReservations.filter(r => r.status === 'draft').length,
  [allReservations]);

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
  
  const formatDateTime = (date) => {
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatTime = (date) => {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const isSameDay = (date1, date2) => {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
  };
  
  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'pending': return 'status-pending';
      case 'approved': return 'status-approved';
      case 'rejected': return 'status-rejected';
      case 'cancelled': return 'status-cancelled';
      case 'draft': return 'status-draft';
      default: return '';
    }
  };

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
            className={`tab ${activeTab === 'drafts' ? 'active' : ''}`}
            onClick={() => handleTabChange('drafts')}
          >
            Drafts
            <span className="count draft-count">({draftsCount})</span>
          </button>
          <button
            className={`tab ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => handleTabChange('all')}
          >
            All Requests
            <span className="count">({allReservations.filter(r => r.status !== 'draft').length})</span>
          </button>
          <button
            className={`tab ${activeTab === 'pending' ? 'active' : ''}`}
            onClick={() => handleTabChange('pending')}
          >
            Pending
            <span className="count">({allReservations.filter(r => r.status === 'pending').length})</span>
          </button>
          <button
            className={`tab ${activeTab === 'approved' ? 'active' : ''}`}
            onClick={() => handleTabChange('approved')}
          >
            Approved
            <span className="count">({allReservations.filter(r => r.status === 'approved').length})</span>
          </button>
          <button
            className={`tab ${activeTab === 'rejected' ? 'active' : ''}`}
            onClick={() => handleTabChange('rejected')}
          >
            Rejected
            <span className="count">({allReservations.filter(r => r.status === 'rejected').length})</span>
          </button>
          <button
            className={`tab ${activeTab === 'cancelled' ? 'active' : ''}`}
            onClick={() => handleTabChange('cancelled')}
          >
            Cancelled
            <span className="count">({allReservations.filter(r => r.status === 'cancelled').length})</span>
          </button>
        </div>
      </div>
      
      {/* Reservations Table */}
      <div className="reservations-table-container">
        <table className="reservations-table">
          <thead>
            <tr>
              <th>Submitted</th>
              <th>Event Details</th>
              <th>Date & Time</th>
              <th>Rooms</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedReservations.map(reservation => (
              <tr key={reservation._id} className={reservation.status === 'draft' ? 'draft-row' : ''}>
                <td className="submitted-date">
                  <span className="meta-label">
                    {reservation.status === 'draft' ? 'Saved' : 'Submitted'}
                  </span>
                  {new Date(reservation.status === 'draft'
                    ? (reservation.lastDraftSaved || reservation.submittedAt)
                    : reservation.submittedAt
                  ).toLocaleDateString()}
                </td>
                <td className="event-details">
                  <strong>{reservation.eventTitle || 'Untitled'}</strong>
                  {reservation.roomReservationData?.contactPerson?.isOnBehalfOf && reservation.roomReservationData?.contactPerson?.name && (
                    <div className="delegation-status">On behalf of {reservation.roomReservationData.contactPerson.name}</div>
                  )}
                  {reservation.eventDescription && (
                    <div className="event-desc">{reservation.eventDescription}</div>
                  )}
                  {reservation.attendeeCount > 0 && (
                    <div className="attendee-count">{reservation.attendeeCount} attendees</div>
                  )}
                </td>
                <td className="datetime">
                  {reservation.startDateTime && reservation.endDateTime ? (
                    isSameDay(reservation.startDateTime, reservation.endDateTime) ? (
                      <>
                        <div className="date">{formatDate(reservation.startDateTime)}</div>
                        <div className="time-range">{formatTime(reservation.startDateTime)} – {formatTime(reservation.endDateTime)}</div>
                      </>
                    ) : (
                      <>
                        <div>{formatDateTime(reservation.startDateTime)}</div>
                        <div className="to">to</div>
                        <div>{formatDateTime(reservation.endDateTime)}</div>
                      </>
                    )
                  ) : (
                    <span className="not-set">Not set</span>
                  )}
                </td>
                <td className="rooms">
                  {reservation.requestedRooms && reservation.requestedRooms.length > 0 ? (
                    reservation.requestedRooms.map(roomId => {
                      const roomDetails = getRoomDetails(roomId);
                      return (
                        <div
                          key={roomId}
                          className="room-badge"
                          title={roomDetails.location ? `${roomDetails.name} - ${roomDetails.location}` : roomDetails.name}
                        >
                          {roomDetails.name}
                        </div>
                      );
                    })
                  ) : (
                    <span className="not-set">None</span>
                  )}
                </td>
                <td>
                  <span className={`status-badge ${getStatusBadgeClass(reservation.status)}`}>
                    {reservation.status}
                  </span>
                  {reservation.status === 'draft' && reservation.draftCreatedAt && (
                    <div className="status-meta">
                      Expires in {getDaysUntilDelete(reservation.draftCreatedAt)}d
                    </div>
                  )}
                  {reservation.rejectionReason && (
                    <div className="status-meta error" title={reservation.rejectionReason}>
                      {reservation.rejectionReason}
                    </div>
                  )}
                  {reservation.cancelReason && (
                    <div className="status-meta" title={reservation.cancelReason}>
                      {reservation.cancelReason}
                    </div>
                  )}
                  {reservation.actionDate && reservation.status !== 'pending' && reservation.status !== 'draft' && (
                    <div className="status-meta">
                      {new Date(reservation.actionDate).toLocaleDateString()}
                    </div>
                  )}
                </td>
                <td className="actions">
                  {reservation.status === 'draft' ? (
                    <>
                      <button
                        className="edit-btn"
                        onClick={() => handleEditDraft(reservation)}
                        disabled={deletingDraft}
                      >
                        Edit
                      </button>
                      <button
                        className="delete-btn"
                        onClick={() => handleDeleteDraft(reservation)}
                        disabled={deletingDraft}
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <button
                      className="view-btn"
                      onClick={() => setSelectedReservation(reservation)}
                    >
                      View
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {paginatedReservations.length === 0 && !loading && (
          <div className="no-reservations">
            {activeTab === 'all'
              ? "You haven't submitted any reservation requests yet."
              : activeTab === 'drafts'
              ? "You don't have any saved drafts."
              : `You don't have any ${activeTab} reservation requests.`}
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
                  <span className={`status-badge ${getStatusBadgeClass(selectedReservation.status)}`}>
                    {selectedReservation.status}
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
              <CommunicationHistory reservation={selectedReservation} isAdmin={false} />
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
              {selectedReservation.status === 'approved' && (
                <button
                  className="edit-request-btn"
                  onClick={() => handleRequestEdit(selectedReservation)}
                  title="Request changes to this approved reservation"
                >
                  Request Edit
                </button>
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