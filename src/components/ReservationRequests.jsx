// src/components/ReservationRequests.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/RoomContext';
import CommunicationHistory from './CommunicationHistory';
import './ReservationRequests.css';

export default function ReservationRequests({ apiToken }) {
  const [allReservations, setAllReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedReservation, setSelectedReservation] = useState(null);
  const [actionNotes, setActionNotes] = useState('');
  
  // Use room context for efficient room name resolution
  const { getRoomName, getRoomDetails, loading: roomsLoading } = useRooms();
  
  // Load all reservations once on mount
  useEffect(() => {
    if (apiToken) {
      loadAllReservations();
    }
  }, [apiToken]);
  
  const loadAllReservations = async () => {
    try {
      setLoading(true);
      setError('');
      
      // Load all reservations without pagination or filtering
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/room-reservations?limit=1000`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });
      
      if (!response.ok) throw new Error('Failed to load reservations');
      
      const data = await response.json();
      setAllReservations(data.reservations || []);
    } catch (err) {
      logger.error('Error loading reservations:', err);
      setError('Failed to load reservation requests');
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
      setAllReservations(prev => prev.map(r => 
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
      setAllReservations(prev => prev.map(r => 
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
  
  if (loading && allReservations.length === 0) {
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
            {paginatedReservations.map(reservation => (
              <tr key={reservation._id}>
                <td className="submitted-date">
                  {new Date(reservation.submittedAt).toLocaleDateString()}
                  {reservation.currentRevision > 1 && (
                    <div className="revision-indicator">
                      📝 Rev {reservation.currentRevision}
                    </div>
                  )}
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
                  <div className="submitter-info">
                    <strong>Submitted by:</strong>
                    <div>{reservation.requesterName}</div>
                    <div className="email">{reservation.requesterEmail}</div>
                  </div>
                  {reservation.isOnBehalfOf && reservation.contactName && (
                    <div className="contact-info">
                      <strong>Contact Person:</strong>
                      <div>{reservation.contactName}</div>
                      <div className="email">{reservation.contactEmail}</div>
                      <div className="delegation-badge">📋 On Behalf Of</div>
                    </div>
                  )}
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
                  <button
                    className="view-btn"
                    onClick={() => setSelectedReservation(reservation)}
                  >
                    {reservation.status === 'pending' ? 'Review' : 'View Details'}
                  </button>
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
        
        {paginatedReservations.length === 0 && !loading && (
          <div className="no-reservations">
            {activeTab === 'all' 
              ? 'No reservation requests found.' 
              : `No ${activeTab} reservation requests found.`}
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
            <h2>
              {selectedReservation.status === 'pending' ? 'Review Reservation Request' : 'Reservation Details'}
              {selectedReservation.currentRevision > 1 && (
                <span className="revision-badge">Revision {selectedReservation.currentRevision}</span>
              )}
            </h2>
            
            <div className="reservation-details">
              <div className="detail-row">
                <label>Event:</label>
                <div>{selectedReservation.eventTitle}</div>
              </div>
              
              <div className="detail-row">
                <label>Submitted by:</label>
                <div>
                  {selectedReservation.requesterName} ({selectedReservation.requesterEmail})
                  {selectedReservation.phone && <div>📞 {selectedReservation.phone}</div>}
                </div>
              </div>

              {selectedReservation.isOnBehalfOf && selectedReservation.contactName && (
                <div className="detail-row">
                  <label>Contact Person:</label>
                  <div>
                    {selectedReservation.contactName} ({selectedReservation.contactEmail})
                    <div className="delegation-indicator">📋 This request was submitted on behalf of this person</div>
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

            {/* Communication History */}
            {selectedReservation.communicationHistory && selectedReservation.communicationHistory.length > 0 && (
              <CommunicationHistory reservation={selectedReservation} isAdmin={true} />
            )}
            
            {selectedReservation.status === 'pending' && (
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
            )}
            
            <div className="modal-actions">
              {selectedReservation.status === 'pending' && (
                <>
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
                </>
              )}
              <button
                className="cancel-btn"
                onClick={() => {
                  setSelectedReservation(null);
                  setActionNotes('');
                }}
              >
                {selectedReservation.status === 'pending' ? 'Cancel' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}