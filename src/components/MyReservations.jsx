// src/components/MyReservations.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import { usePermissions } from '../hooks/usePermissions';
import LoadingSpinner from './shared/LoadingSpinner';
import CommunicationHistory from './CommunicationHistory';
import './MyReservations.css';

export default function MyReservations({ apiToken }) {
  const navigate = useNavigate();
  const { canSubmitReservation } = usePermissions();
  const [allReservations, setAllReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedReservation, setSelectedReservation] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  
  // Use room context for efficient room name resolution
  const { getRoomName, getRoomDetails, loading: roomsLoading } = useRooms();
  
  // Load all user's reservations once on mount
  useEffect(() => {
    if (apiToken) {
      loadMyReservations();
    }
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
      return allReservations;
    }
    return allReservations.filter(reservation => reservation.status === activeTab);
  }, [allReservations, activeTab]);

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
      alert('Please provide a reason for cancellation');
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
    // Navigate to resubmission form with reservation data
    navigate('/room-reservation/resubmit', {
      state: {
        reservationId: reservation._id,
        originalReservation: reservation
      }
    });
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
      <h1>My Room Reservations</h1>
      
      {error && (
        <div className="error-message">
          ❌ {error}
        </div>
      )}
      
      {/* Tab Navigation */}
      <div className="tabs-container">
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => handleTabChange('all')}
          >
            All Requests
            <span className="count">({allReservations.length})</span>
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
              <tr key={reservation._id}>
                <td className="submitted-date">
                  {new Date(reservation.submittedAt).toLocaleDateString()}
                </td>
                <td className="event-details">
                  <strong>{reservation.eventTitle}</strong>
                  {reservation.roomReservationData?.contactPerson?.isOnBehalfOf && reservation.roomReservationData?.contactPerson?.name && (
                    <div className="delegation-status">📋 On behalf of {reservation.roomReservationData.contactPerson.name}</div>
                  )}
                  {reservation.eventDescription && (
                    <div className="event-desc">{reservation.eventDescription}</div>
                  )}
                  {reservation.attendeeCount > 0 && (
                    <div className="attendee-count">👥 {reservation.attendeeCount} attendees</div>
                  )}
                </td>
                <td className="datetime">
                  {isSameDay(reservation.startDateTime, reservation.endDateTime) ? (
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
                  )}
                </td>
                <td className="rooms">
                  {reservation.requestedRooms.map(roomId => {
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
                  })}
                </td>
                <td>
                  <span className={`status-badge ${getStatusBadgeClass(reservation.status)}`}>
                    {reservation.status}
                  </span>
                  {reservation.rejectionReason && (
                    <div className="rejection-reason" title={reservation.rejectionReason}>
                      ❌ {reservation.rejectionReason}
                    </div>
                  )}
                  {reservation.cancelReason && (
                    <div className="cancel-reason" title={reservation.cancelReason}>
                      🚫 {reservation.cancelReason}
                    </div>
                  )}
                  {reservation.actionDate && reservation.status !== 'pending' && (
                    <div className="action-date">
                      {reservation.status === 'approved' ? '✅' : reservation.status === 'rejected' ? '❌' : '🚫'} {new Date(reservation.actionDate).toLocaleDateString()}
                    </div>
                  )}
                </td>
                <td className="actions">
                  <button
                    className="view-btn"
                    onClick={() => setSelectedReservation(reservation)}
                  >
                    View Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {paginatedReservations.length === 0 && !loading && (
          <div className="no-reservations">
            {activeTab === 'all' 
              ? "You haven't submitted any reservation requests yet." 
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
                    <div className="delegation-note">📧 Updates will be sent to this contact</div>
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
              {selectedReservation.status === 'rejected' && selectedReservation.resubmissionAllowed !== false && (
                <button
                  className="resubmit-btn"
                  onClick={() => handleResubmitReservation(selectedReservation)}
                  title="Edit and resubmit this reservation"
                >
                  🔄 Resubmit Request
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
    </div>
  );
}