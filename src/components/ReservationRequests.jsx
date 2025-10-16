// src/components/ReservationRequests.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import RoomReservationReview from './RoomReservationReview';
import './ReservationRequests.css';

export default function ReservationRequests({ apiToken, graphToken }) {
  const [allReservations, setAllReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedReservation, setSelectedReservation] = useState(null);
  const [actionNotes, setActionNotes] = useState('');

  // Calendar event creation settings
  const [calendarMode, setCalendarMode] = useState(APP_CONFIG.CALENDAR_CONFIG.DEFAULT_MODE);
  const [createCalendarEvent, setCreateCalendarEvent] = useState(true);

  // Editable form state
  const [editableData, setEditableData] = useState(null);
  const [originalChangeKey, setOriginalChangeKey] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Child component's save function (exposed via callback)
  const [childSaveFunction, setChildSaveFunction] = useState(null);

  // Soft hold state
  const [reviewHold, setReviewHold] = useState(null);
  const [holdTimer, setHoldTimer] = useState(null);
  const [holdError, setHoldError] = useState(null);

  // Conflict detection state
  const [conflicts, setConflicts] = useState([]);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [forceApprove, setForceApprove] = useState(false);

  // Use room context for efficient room name resolution
  const { getRoomName, getRoomDetails, loading: roomsLoading } = useRooms();
  
  
  // Load all reservations once on mount
  useEffect(() => {
    if (apiToken) {
      loadAllReservations();
    }
  }, [apiToken]);

  // Cleanup hold timer on unmount
  useEffect(() => {
    return () => {
      if (holdTimer) {
        clearInterval(holdTimer);
      }
    };
  }, [holdTimer]);

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

  // Acquire soft hold when opening review modal
  const acquireReviewHold = async (reservationId) => {
    try {
      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${reservationId}/start-review`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiToken}`
          }
        }
      );

      if (response.status === 423) {
        const data = await response.json();
        setHoldError(`This reservation is currently being reviewed by ${data.reviewingBy}. ` +
                     `The hold will expire in ${data.minutesRemaining} minutes.`);
        return false;
      }

      if (!response.ok) {
        throw new Error('Failed to acquire review hold');
      }

      const data = await response.json();
      const expiresAt = new Date(data.reviewExpiresAt);

      setReviewHold({
        expiresAt,
        durationMinutes: data.durationMinutes
      });
      setHoldError(null);

      // Set up countdown timer
      const timer = setInterval(() => {
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) {
          setHoldError('Your review session has expired. Please reopen the modal to continue.');
          closeReviewModal();
        }
      }, 60000); // Check every minute

      setHoldTimer(timer);
      return true;

    } catch (error) {
      logger.error('Failed to acquire review hold:', error);
      // Don't set error for network issues - allow modal to open
      setHoldError(null);
      return true;
    }
  };

  // Release soft hold when closing modal
  const releaseReviewHold = async (reservationId) => {
    if (holdTimer) {
      clearInterval(holdTimer);
      setHoldTimer(null);
    }

    if (!reservationId) return;

    try {
      await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${reservationId}/release-review`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiToken}`
          }
        }
      );
    } catch (error) {
      logger.error('Failed to release hold:', error);
    }

    setReviewHold(null);
    setHoldError(null);
  };

  // Check for scheduling conflicts
  const checkConflicts = async (reservation) => {
    try {
      setCheckingConflicts(true);

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${reservation._id}/check-conflicts`,
        {
          headers: {
            'Authorization': `Bearer ${apiToken}`
          }
        }
      );

      if (!response.ok) {
        throw new Error('Failed to check conflicts');
      }

      const data = await response.json();
      setConflicts(data.conflicts || []);

    } catch (error) {
      logger.error('Failed to check conflicts:', error);
      setConflicts([]); // Show as no conflicts on error
    } finally {
      setCheckingConflicts(false);
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

  // Open review modal with soft hold acquisition
  const openReviewModal = async (reservation) => {
    // For pending reservations, try to acquire soft hold
    if (reservation.status === 'pending') {
      try {
        const holdAcquired = await acquireReviewHold(reservation._id);
        if (!holdAcquired && holdError) {
          // Block if someone else is reviewing
          if (holdError.includes('currently being reviewed by')) {
            return;
          }
        }
      } catch (error) {
        // Network error - allow modal to open without hold
        logger.error('Failed to acquire soft hold:', error);
        setHoldError(null);
      }
    }

    // Initialize editable data
    setEditableData({
      eventTitle: reservation.eventTitle || '',
      eventDescription: reservation.eventDescription || '',
      startDateTime: reservation.startDateTime,
      endDateTime: reservation.endDateTime,
      setupTimeMinutes: reservation.setupTimeMinutes || 0,
      teardownTimeMinutes: reservation.teardownTimeMinutes || 0,
      attendeeCount: reservation.attendeeCount || 0,
      requestedRooms: reservation.requestedRooms || [],
      specialRequirements: reservation.specialRequirements || '',
      requesterName: reservation.requesterName || '',
      requesterEmail: reservation.requesterEmail || '',
      contactName: reservation.contactName || '',
      contactEmail: reservation.contactEmail || '',
      phone: reservation.phone || '',
      department: reservation.department || '',
      sponsoredBy: reservation.sponsoredBy || '',
      isOnBehalfOf: reservation.isOnBehalfOf || false
    });

    setOriginalChangeKey(reservation.changeKey);
    setHasChanges(false);
    setSelectedReservation(reservation);

    // Check for scheduling conflicts
    await checkConflicts(reservation);
  };

  // Close review modal and release hold
  const closeReviewModal = async () => {
    if (selectedReservation) {
      await releaseReviewHold(selectedReservation._id);
    }

    setSelectedReservation(null);
    setEditableData(null);
    setOriginalChangeKey(null);
    setHasChanges(false);
    setActionNotes('');
    setCalendarMode(APP_CONFIG.CALENDAR_CONFIG.DEFAULT_MODE);
    setCreateCalendarEvent(true);
    setConflicts([]);
    setForceApprove(false);
  };

  // Handle locked event click from SchedulingAssistant
  const handleLockedEventClick = async (reservationId) => {
    console.log('[ReservationRequests] Locked event clicked:', reservationId);

    // Find the reservation in our list
    const targetReservation = allReservations.find(r => r._id === reservationId);

    if (!targetReservation) {
      console.error('[ReservationRequests] Could not find reservation with ID:', reservationId);
      alert('Could not find the selected reservation. It may have been deleted.');
      return;
    }

    // Check if there are unsaved changes
    if (hasChanges) {
      const confirmMessage = `You have unsaved changes to the current reservation.\n\n` +
                            `If you navigate to "${targetReservation.eventTitle}", your changes will be lost.\n\n` +
                            `Do you want to continue?`;

      if (!window.confirm(confirmMessage)) {
        console.log('[ReservationRequests] Navigation cancelled - user chose to stay');
        return;
      }
    }

    // Close current modal and open the new one
    console.log('[ReservationRequests] Navigating to reservation:', targetReservation.eventTitle);
    await closeReviewModal();

    // Small delay to ensure cleanup completes
    setTimeout(() => {
      openReviewModal(targetReservation);
    }, 100);
  };

  // Handle field changes in editable form
  const handleFieldChange = (field, value) => {
    setEditableData(prev => ({
      ...prev,
      [field]: value
    }));
    setHasChanges(true);

    // Re-check conflicts if time or room fields changed
    if (['startDateTime', 'endDateTime', 'setupTimeMinutes', 'teardownTimeMinutes', 'requestedRooms'].includes(field)) {
      checkConflicts({
        ...selectedReservation,
        ...editableData,
        [field]: value
      });
    }
  };

  // Save changes with ETag validation
  // This function is now mainly called as a callback from RoomReservationReview
  // RoomReservationReview handles the actual API call and passes the result here
  const handleSaveChanges = async (result) => {
    // If result is provided, it means RoomReservationReview already saved
    // Just update our local state with the new changeKey
    if (result && result.changeKey) {
      setOriginalChangeKey(result.changeKey);
      setHasChanges(false);
      setError('✅ Changes saved successfully');
      setTimeout(() => setError(''), 3000);
      return;
    }

    // Legacy path (in case called without result) - kept for backwards compatibility
    if (!hasChanges) return;

    try {
      setIsSaving(true);

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${selectedReservation._id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`,
            'If-Match': originalChangeKey || ''
          },
          body: JSON.stringify(editableData)
        }
      );

      if (response.status === 409) {
        const data = await response.json();
        const changes = data.changes || [];
        const changesList = changes.map(c => `- ${c.field}: ${c.oldValue} → ${c.newValue}`).join('\n');

        const message = `This reservation was modified by ${data.lastModifiedBy} while you were editing.\n\n` +
                       `Changes made:\n${changesList}\n\n` +
                       `Your changes have NOT been saved. Would you like to refresh to see the latest version?\n` +
                       `(Your changes will be lost)`;

        if (window.confirm(message)) {
          await loadAllReservations();
          closeReviewModal();
        }
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to save changes');
      }

      const saveResult = await response.json();

      // Update local state
      setAllReservations(prev => prev.map(r =>
        r._id === selectedReservation._id ? { ...r, ...editableData, changeKey: saveResult.changeKey } : r
      ));

      setOriginalChangeKey(saveResult.changeKey);
      setHasChanges(false);
      setError('✅ Changes saved successfully');
      setTimeout(() => setError(''), 3000);

    } catch (error) {
      logger.error('Error saving changes:', error);
      setError(`Failed to save changes: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };
  
  const handleApprove = async (reservation) => {
    try {
      console.log('🚀 Starting reservation approval process:', {
        reservationId: reservation._id,
        eventTitle: reservation.eventTitle,
        calendarMode,
        createCalendarEvent,
        hasConflicts: conflicts.length > 0,
        forceApprove
      });

      const requestBody = {
        notes: actionNotes,
        calendarMode: calendarMode,
        createCalendarEvent: createCalendarEvent,
        graphToken: graphToken,
        forceApprove: forceApprove
      };

      console.log('📤 Sending approval request:', requestBody);

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${reservation._id}/approve`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
          'If-Match': originalChangeKey || reservation.changeKey || ''
        },
        body: JSON.stringify(requestBody)
      });

      // Handle ETag conflict (409)
      if (response.status === 409) {
        const data = await response.json();

        // Check if it's a scheduling conflict or ETag conflict
        if (data.error === 'SchedulingConflict') {
          setConflicts(data.conflicts || []);
          setError(`⚠️ Cannot approve: ${data.conflicts.length} scheduling conflict(s) detected. ` +
                  `Please review conflicts below and either modify the reservation or check "Override conflicts" to force approval.`);
          return;
        } else if (data.error === 'ConflictError') {
          const changes = data.changes || [];
          const changesList = changes.map(c => `- ${c.field}: ${c.oldValue} → ${c.newValue}`).join('\n');

          const message = `This reservation was modified by ${data.lastModifiedBy} while you were editing.\n\n` +
                         `Changes made:\n${changesList}\n\n` +
                         `Would you like to refresh to see the latest version?`;

          if (window.confirm(message)) {
            await loadAllReservations();
            closeReviewModal();
          }
          return;
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Approval request failed:', response.status, errorText);
        throw new Error(`Failed to approve reservation: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      console.log('✅ Approval response received:', result);

      // Check for calendar event creation results (backend returns as 'calendarEvent')
      const calendarEventResult = result.calendarEvent || result.calendarEventResult;
      
      if (createCalendarEvent && calendarEventResult) {
        if (calendarEventResult.success) {
          console.log('📅 Calendar event created successfully:', {
            eventId: calendarEventResult.eventId,
            calendar: calendarEventResult.targetCalendar
          });
          setError(`✅ Reservation approved and calendar event created in ${calendarEventResult.targetCalendar}`);
        } else {
          console.error('📅 Calendar event creation failed:', calendarEventResult.error);
          setError(`⚠️ Reservation approved but calendar event creation failed: ${calendarEventResult.error}`);
        }
      } else if (createCalendarEvent) {
        console.warn('📅 Calendar event creation was requested but no result received');
        setError('⚠️ Reservation approved but calendar event creation status unknown');
      } else {
        console.log('✅ Reservation approved (calendar event creation disabled)');
        setError('✅ Reservation approved successfully');
      }
      
      // Update local state
      setAllReservations(prev => prev.map(r => 
        r._id === reservation._id 
          ? { ...r, status: 'approved', actionDate: new Date(), calendarEventId: calendarEventResult?.eventId }
          : r
      ));
      
      setSelectedReservation(null);
      setActionNotes('');
      setCalendarMode(APP_CONFIG.CALENDAR_CONFIG.DEFAULT_MODE);
      setCreateCalendarEvent(true);
      
      // Clear success message after 5 seconds
      setTimeout(() => setError(''), 5000);
      
    } catch (err) {
      console.error('❌ Error in approval process:', err);
      logger.error('Error approving reservation:', err);
      setError(`Failed to approve reservation: ${err.message}`);
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

  const handleDelete = async (reservation) => {
    // Confirm deletion
    const confirmMessage = `Are you sure you want to permanently delete this reservation?\n\nEvent: ${reservation.eventTitle}\nRequester: ${reservation.requesterName}\n\nThis action cannot be undone.`;
    
    if (!window.confirm(confirmMessage)) {
      return;
    }
    
    try {
      console.log('🗑️ Starting reservation deletion:', {
        reservationId: reservation._id,
        eventTitle: reservation.eventTitle
      });

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${reservation._id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Delete request failed:', response.status, errorText);
        throw new Error(`Failed to delete reservation: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      console.log('✅ Reservation deleted successfully:', result);
      
      // Remove from local state
      setAllReservations(prev => prev.filter(r => r._id !== reservation._id));
      
      setSelectedReservation(null);
      setActionNotes('');
      setError(`✅ Reservation "${result.eventTitle}" deleted successfully`);
      
      // Clear success message after 3 seconds
      setTimeout(() => setError(''), 3000);
      
    } catch (err) {
      console.error('❌ Error deleting reservation:', err);
      logger.error('Error deleting reservation:', err);
      setError(`Failed to delete reservation: ${err.message}`);
    }
  };

  const handleSync = async (reservation) => {
    try {
      console.log('🔄 Starting reservation calendar sync:', {
        reservationId: reservation._id,
        eventTitle: reservation.eventTitle,
        calendarMode,
        hasCalendarEventId: !!reservation.calendarEventId
      });

      const requestBody = { 
        calendarMode: calendarMode,
        graphToken: graphToken
      };

      console.log('📤 Sending sync request:', requestBody);

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${reservation._id}/sync`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Sync request failed:', response.status, errorText);
        throw new Error(`Failed to sync calendar event: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      console.log('✅ Sync response received:', result);

      // Check for calendar event sync results
      const calendarEventResult = result.calendarEvent;
      
      if (calendarEventResult && calendarEventResult.success) {
        console.log('📅 Calendar event synced successfully:', {
          eventId: calendarEventResult.eventId,
          calendar: calendarEventResult.targetCalendar
        });
        setError(`🔄 Calendar event synced successfully in ${calendarEventResult.targetCalendar}`);
      } else {
        console.error('📅 Calendar event sync failed:', calendarEventResult?.error);
        setError(`⚠️ Calendar event sync failed: ${calendarEventResult?.error || 'Unknown error'}`);
      }
      
      // Refresh reservations to show updated data
      await loadAllReservations();
      
      setSelectedReservation(null);
      setActionNotes('');
      
      // Clear success message after 5 seconds
      setTimeout(() => setError(''), 5000);
      
    } catch (err) {
      console.error('❌ Error in sync process:', err);
      logger.error('Error syncing reservation:', err);
      setError(`Failed to sync calendar event: ${err.message}`);
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
                    onClick={() => openReviewModal(reservation)}
                  >
                    {reservation.status === 'pending' ? 'Review' : 'Details'}
                  </button>
                  {reservation.status === 'approved' && reservation.createdEventIds?.length > 0 && (
                    <button className="view-event-btn">
                      View Event
                    </button>
                  )}
                  <button
                    className="delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(reservation);
                    }}
                    title={`Delete reservation: ${reservation.eventTitle}`}
                  >
                    🗑️
                  </button>
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
          <div className="review-modal" style={{ maxWidth: '1200px', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            {/* Sticky Action Bar at top of modal */}
            <div className="review-action-bar">
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
                {selectedReservation.status === 'pending' ? 'Review Reservation Request' : 'View Reservation Details'}
              </h2>

              <div className="review-actions">
                {selectedReservation.status === 'pending' && hasChanges && (
                  <button
                    type="button"
                    className="action-btn save-btn"
                    onClick={() => childSaveFunction && childSaveFunction()}
                    disabled={isSaving}
                  >
                    {isSaving ? 'Saving...' : '💾 Save Changes'}
                  </button>
                )}

                {selectedReservation.status === 'pending' && (
                  <>
                    <button
                      type="button"
                      className="action-btn approve-btn"
                      onClick={() => handleApprove(selectedReservation)}
                    >
                      ✓ Approve
                    </button>
                    <button
                      type="button"
                      className="action-btn reject-btn"
                      onClick={() => handleReject(selectedReservation)}
                    >
                      ✗ Reject
                    </button>
                  </>
                )}

                <button
                  type="button"
                  className="action-btn cancel-btn"
                  onClick={closeReviewModal}
                >
                  {selectedReservation.status === 'pending' ? 'Cancel' : 'Close'}
                </button>
              </div>
            </div>

            {/* Scrollable content area */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              <RoomReservationReview
                reservation={selectedReservation}
                apiToken={apiToken}
                onApprove={(updatedData, notes) => handleApprove(selectedReservation)}
                onReject={(notes) => handleReject(selectedReservation)}
                onCancel={closeReviewModal}
                onSave={handleSaveChanges}
                onHasChangesChange={setHasChanges}
                onIsSavingChange={setIsSaving}
                onSaveFunctionReady={(saveFunc) => setChildSaveFunction(() => saveFunc)}
                onLockedEventClick={handleLockedEventClick}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}