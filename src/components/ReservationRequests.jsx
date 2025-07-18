// src/components/ReservationRequests.jsx
import React, { useState, useEffect } from 'react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import './ReservationRequests.css';

export default function ReservationRequests({ apiToken }) {
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedReservation, setSelectedReservation] = useState(null);
  const [actionNotes, setActionNotes] = useState('');
  
  useEffect(() => {
    loadReservations();
  }, [apiToken, filter, page]);
  
  const loadReservations = async () => {
    try {
      setLoading(true);
      
      const params = new URLSearchParams({
        page,
        limit: 20
      });
      
      if (filter !== 'all') {
        params.append('status', filter);
      }
      
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/room-reservations?${params}`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });
      
      if (!response.ok) throw new Error('Failed to load reservations');
      
      const data = await response.json();
      setReservations(data.reservations);
      setTotalPages(data.pagination.pages);
    } catch (err) {
      logger.error('Error loading reservations:', err);
      setError('Failed to load reservation requests');
    } finally {
      setLoading(false);
    }
  };
  
  const handleApprove = async (reservation) => {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${reservation._id}/approve`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({ notes: actionNotes })
      });
      
      if (!response.ok) throw new Error('Failed to approve reservation');
      
      // Update local state
      setReservations(prev => prev.map(r => 
        r._id === reservation._id 
          ? { ...r, status: 'approved', actionDate: new Date() }
          : r
      ));
      
      setSelectedReservation(null);
      setActionNotes('');
    } catch (err) {
      logger.error('Error approving reservation:', err);
      setError('Failed to approve reservation');
    }
  };
  
  const handleReject = async (reservation) => {
    if (!actionNotes.trim()) {
      alert('Please provide a reason for rejection');
      return;
    }
    
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${reservation._id}/reject`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({ reason: actionNotes })
      });
      
      if (!response.ok) throw new Error('Failed to reject reservation');
      
      // Update local state
      setReservations(prev => prev.map(r => 
        r._id === reservation._id 
          ? { ...r, status: 'rejected', actionDate: new Date(), rejectionReason: actionNotes }
          : r
      ));
      
      setSelectedReservation(null);
      setActionNotes('');
    } catch (err) {
      logger.error('Error rejecting reservation:', err);
      setError('Failed to reject reservation');
    }
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
  
  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'pending': return 'status-pending';
      case 'approved': return 'status-approved';
      case 'rejected': return 'status-rejected';
      case 'cancelled': return 'status-cancelled';
      default: return '';
    }
  };
  
  const getPriorityBadgeClass = (priority) => {
    switch (priority) {
      case 'high': return 'priority-high';
      case 'medium': return 'priority-medium';
      case 'low': return 'priority-low';
      default: return '';
    }
  };
  
  if (loading && reservations.length === 0) {
    return <div className="reservation-requests loading">Loading reservation requests...</div>;
  }
  
  return (
    <div className="reservation-requests">
      <h1>Reservation Requests</h1>
      
      {error && (
        <div className="error-message">
          ❌ {error}
        </div>
      )}
      
      {/* Filters */}
      <div className="filters-bar">
        <div className="filter-buttons">
          <button
            className={filter === 'all' ? 'active' : ''}
            onClick={() => {
              setFilter('all');
              setPage(1);
            }}
          >
            All Requests
          </button>
          <button
            className={filter === 'pending' ? 'active' : ''}
            onClick={() => {
              setFilter('pending');
              setPage(1);
            }}
          >
            Pending
          </button>
          <button
            className={filter === 'approved' ? 'active' : ''}
            onClick={() => {
              setFilter('approved');
              setPage(1);
            }}
          >
            Approved
          </button>
          <button
            className={filter === 'rejected' ? 'active' : ''}
            onClick={() => {
              setFilter('rejected');
              setPage(1);
            }}
          >
            Rejected
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
              <th>Requester</th>
              <th>Date & Time</th>
              <th>Rooms</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {reservations.map(reservation => (
              <tr key={reservation._id}>
                <td className="submitted-date">
                  {new Date(reservation.submittedAt).toLocaleDateString()}
                </td>
                <td className="event-details">
                  <strong>{reservation.eventTitle}</strong>
                  {reservation.eventDescription && (
                    <div className="event-desc">{reservation.eventDescription}</div>
                  )}
                  {reservation.attendeeCount > 0 && (
                    <div className="attendee-count">👥 {reservation.attendeeCount} attendees</div>
                  )}
                </td>
                <td className="requester-info">
                  <div>{reservation.requesterName}</div>
                  <div className="email">{reservation.requesterEmail}</div>
                  {reservation.department && (
                    <div className="department">{reservation.department}</div>
                  )}
                  {reservation.sponsoredBy && (
                    <div className="sponsor">Sponsored by: {reservation.sponsoredBy}</div>
                  )}
                </td>
                <td className="datetime">
                  <div>{formatDateTime(reservation.startDateTime)}</div>
                  <div className="to">to</div>
                  <div>{formatDateTime(reservation.endDateTime)}</div>
                </td>
                <td className="rooms">
                  {reservation.requestedRooms.map(roomId => (
                    <div key={roomId} className="room-badge">{roomId}</div>
                  ))}
                </td>
                <td>
                  <span className={`priority-badge ${getPriorityBadgeClass(reservation.priority)}`}>
                    {reservation.priority}
                  </span>
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
                </td>
                <td className="actions">
                  {reservation.status === 'pending' && (
                    <>
                      <button
                        className="view-btn"
                        onClick={() => setSelectedReservation(reservation)}
                      >
                        Review
                      </button>
                    </>
                  )}
                  {reservation.status === 'approved' && reservation.createdEventIds?.length > 0 && (
                    <button className="view-event-btn">
                      View Event
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {reservations.length === 0 && (
          <div className="no-reservations">
            No reservation requests found.
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
      
      {/* Review Modal */}
      {selectedReservation && (
        <div className="review-modal-overlay">
          <div className="review-modal">
            <h2>Review Reservation Request</h2>
            
            <div className="reservation-details">
              <div className="detail-row">
                <label>Event:</label>
                <div>{selectedReservation.eventTitle}</div>
              </div>
              
              <div className="detail-row">
                <label>Requester:</label>
                <div>
                  {selectedReservation.requesterName} ({selectedReservation.requesterEmail})
                  {selectedReservation.phone && <div>📞 {selectedReservation.phone}</div>}
                </div>
              </div>
              
              <div className="detail-row">
                <label>Date & Time:</label>
                <div>
                  {formatDateTime(selectedReservation.startDateTime)} - {formatDateTime(selectedReservation.endDateTime)}
                </div>
              </div>
              
              <div className="detail-row">
                <label>Rooms:</label>
                <div>{selectedReservation.requestedRooms.join(', ')}</div>
              </div>
              
              {selectedReservation.requiredFeatures?.length > 0 && (
                <div className="detail-row">
                  <label>Required Features:</label>
                  <div>{selectedReservation.requiredFeatures.join(', ')}</div>
                </div>
              )}
              
              {selectedReservation.specialRequirements && (
                <div className="detail-row">
                  <label>Special Requirements:</label>
                  <div>{selectedReservation.specialRequirements}</div>
                </div>
              )}
            </div>
            
            <div className="action-notes">
              <label htmlFor="actionNotes">Notes / Rejection Reason:</label>
              <textarea
                id="actionNotes"
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                rows="4"
                placeholder="Add any notes or provide a reason for rejection..."
              />
            </div>
            
            <div className="modal-actions">
              <button
                className="approve-btn"
                onClick={() => handleApprove(selectedReservation)}
              >
                Approve
              </button>
              <button
                className="reject-btn"
                onClick={() => handleReject(selectedReservation)}
              >
                Reject
              </button>
              <button
                className="cancel-btn"
                onClick={() => {
                  setSelectedReservation(null);
                  setActionNotes('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}