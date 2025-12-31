// src/components/ResubmissionForm.jsx
import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import RoomTimeline from './RoomTimeline';
import LoadingSpinner from './shared/LoadingSpinner';
import './ResubmissionForm.css';

export default function ResubmissionForm({ apiToken }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { reservationId, originalReservation } = location.state || {};
  
  // Form state - initialize with original reservation data
  const [formData, setFormData] = useState({
    eventTitle: originalReservation?.eventTitle || '',
    eventDescription: originalReservation?.eventDescription || '',
    startDate: originalReservation?.startDateTime ? new Date(originalReservation.startDateTime).toISOString().split('T')[0] : '',
    startTime: originalReservation?.startDateTime ? new Date(originalReservation.startDateTime).toISOString().split('T')[1].substring(0, 5) : '',
    endDate: originalReservation?.endDateTime ? new Date(originalReservation.endDateTime).toISOString().split('T')[0] : '',
    endTime: originalReservation?.endDateTime ? new Date(originalReservation.endDateTime).toISOString().split('T')[1].substring(0, 5) : '',
    attendeeCount: originalReservation?.attendeeCount?.toString() || '',
    requestedRooms: originalReservation?.requestedRooms || [],
    specialRequirements: originalReservation?.specialRequirements || '',
    department: originalReservation?.department || '',
    phone: originalReservation?.phone || '',
    contactEmail: originalReservation?.contactEmail || '',
    // Setup/teardown times
    setupTimeMinutes: originalReservation?.setupTimeMinutes || 0,
    teardownTimeMinutes: originalReservation?.teardownTimeMinutes || 0,
    userMessage: ''
  });
  
  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [availability, setAvailability] = useState([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [expandedTimelines, setExpandedTimelines] = useState(new Set());
  
  // Use room context for efficient room management
  const { rooms, loading: roomsLoading, getRoomName } = useRooms();
  

  // Redirect if no reservation data
  useEffect(() => {
    if (!reservationId || !originalReservation) {
      navigate('/my-reservations');
    }
  }, [reservationId, originalReservation, navigate]);

  // Check room availability when dates or buffer times change
  useEffect(() => {
    if (formData.startDate && formData.startTime && formData.endDate && formData.endTime) {
      checkAvailability();
    }
  }, [formData.startDate, formData.startTime, formData.endDate, formData.endTime, formData.setupTimeMinutes, formData.teardownTimeMinutes]);
  
  const checkAvailability = async () => {
    try {
      setCheckingAvailability(true);
      
      const startDateTime = `${formData.startDate}T${formData.startTime}`;
      const endDateTime = `${formData.endDate}T${formData.endTime}`;
      
      // Include setup/teardown times in availability check
      const params = new URLSearchParams({
        startDateTime,
        endDateTime,
        setupTimeMinutes: formData.setupTimeMinutes || 0,
        teardownTimeMinutes: formData.teardownTimeMinutes || 0
      });
      
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/rooms/availability?${params}`);
      if (!response.ok) throw new Error('Failed to check availability');
      
      const data = await response.json();
      setAvailability(data);
    } catch (err) {
      logger.error('Error checking availability:', err);
    } finally {
      setCheckingAvailability(false);
    }
  };
  
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };
  
  const handleRoomSelection = (roomId) => {
    setFormData(prev => ({
      ...prev,
      requestedRooms: prev.requestedRooms.includes(roomId)
        ? prev.requestedRooms.filter(id => id !== roomId)
        : [...prev.requestedRooms, roomId]
    }));
  };
  
  const toggleTimeline = async (roomId) => {
    setExpandedTimelines(prev => {
      const newSet = new Set(prev);
      if (newSet.has(roomId)) {
        newSet.delete(roomId);
      } else {
        newSet.add(roomId);
        // If no dates selected, fetch today's schedule for this room
        if (!formData.startDate || !formData.startTime || !formData.endDate || !formData.endTime) {
          fetchRoomSchedule(roomId);
        }
      }
      return newSet;
    });
  };
  
  const fetchRoomSchedule = async (roomId) => {
    try {
      // Fetch today's schedule for the specific room
      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(8, 0, 0, 0);
      const endOfDay = new Date(today);
      endOfDay.setHours(22, 0, 0, 0);
      
      const params = new URLSearchParams({
        startDateTime: startOfDay.toISOString(),
        endDateTime: endOfDay.toISOString(),
        roomIds: roomId
      });
      
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/rooms/availability?${params}`);
      if (!response.ok) throw new Error('Failed to fetch room schedule');
      
      const data = await response.json();
      
      // Update availability state with room-specific data
      setAvailability(prevAvailability => {
        const otherRooms = prevAvailability.filter(item => item.room._id !== roomId);
        return [...otherRooms, ...data];
      });
    } catch (err) {
      logger.error('Error fetching room schedule:', err);
    }
  };
  
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      // Validation
      if (!formData.userMessage.trim()) {
        throw new Error('Please provide a response message explaining your changes');
      }
      
      // Combine date and time
      const startDateTime = `${formData.startDate}T${formData.startTime}`;
      const endDateTime = `${formData.endDate}T${formData.endTime}`;
      
      const payload = {
        eventTitle: formData.eventTitle,
        eventDescription: formData.eventDescription,
        startDateTime,
        endDateTime,
        attendeeCount: parseInt(formData.attendeeCount) || 0,
        requestedRooms: formData.requestedRooms,
        specialRequirements: formData.specialRequirements,
        department: formData.department,
        phone: formData.phone,
        contactEmail: formData.contactEmail,
        userMessage: formData.userMessage
      };
      
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/room-reservations/${reservationId}/resubmit`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to resubmit reservation');
      }
      
      const result = await response.json();
      logger.log('Room reservation resubmitted:', result);
      
      setSuccess(true);
      
      // Redirect after success
      setTimeout(() => {
        navigate('/my-reservations');
      }, 3000);
      
    } catch (err) {
      logger.error('Error resubmitting reservation:', err);
      setError(err.message || 'Failed to resubmit reservation request');
    } finally {
      setLoading(false);
    }
  };

  // Check if a room meets capacity criteria
  const checkRoomCapacity = (room) => {
    if (formData.attendeeCount && room.capacity < parseInt(formData.attendeeCount)) {
      return {
        meetsCapacity: false,
        issue: `Capacity too small (needs ${formData.attendeeCount}, has ${room.capacity})`
      };
    }
    return { meetsCapacity: true, issue: null };
  };

  // Get rejection reason from communication history
  const getRejectionReason = () => {
    if (!originalReservation?.communicationHistory) return originalReservation?.rejectionReason || 'No reason provided';
    
    const rejectionEntry = originalReservation.communicationHistory
      .filter(entry => entry.type === 'rejection')
      .pop(); // Get the most recent rejection
    
    return rejectionEntry?.message || originalReservation?.rejectionReason || 'No reason provided';
  };
  
  const revisionNumber = (originalReservation?.currentRevision || 1) + 1;
  
  if (success) {
    return (
      <div className="resubmission-form">
        <div className="success-message">
          <h2>✅ Reservation Resubmitted!</h2>
          <p>Your updated room reservation request has been resubmitted successfully.</p>
          <p>This is now revision {revisionNumber} of your original request.</p>
          <p>You will receive a confirmation email once it has been reviewed.</p>
          <p>Redirecting to your reservations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="resubmission-form">
      <h1>Resubmit Room Reservation</h1>
      <div className="revision-info">
        <span className="revision-badge">Revision {revisionNumber}</span>
        <span className="original-date">Originally submitted: {new Date(originalReservation?.submittedAt).toLocaleDateString()}</span>
      </div>

      {/* Rejection Reason Display */}
      <div className="rejection-notice">
        <h3>❌ Previous Rejection Reason</h3>
        <div className="rejection-content">
          {getRejectionReason()}
        </div>
        <p className="rejection-help">Please address the concerns above in your updated submission.</p>
      </div>
      
      {error && (
        <div className="error-message">
          ❌ {error}
        </div>
      )}
      
      <form onSubmit={handleSubmit}>
        {/* Response Message */}
        <section className="form-section response-section">
          <h2>Response & Changes</h2>
          <div className="form-group full-width">
            <label htmlFor="userMessage">Your Response *</label>
            <textarea
              id="userMessage"
              name="userMessage"
              value={formData.userMessage}
              onChange={handleInputChange}
              rows="4"
              required
              placeholder="Please explain what changes you've made and how you've addressed the rejection feedback..."
            />
            <div className="help-text">
              Explain what you've changed and how you've addressed the admin's concerns
            </div>
          </div>
        </section>
        
        {/* Event Details */}
        <section className="form-section">
          <h2>Event Details</h2>
          <div className="form-grid">
            <div className="form-group full-width">
              <label htmlFor="eventTitle">Event Title *</label>
              <input
                type="text"
                id="eventTitle"
                name="eventTitle"
                value={formData.eventTitle}
                onChange={handleInputChange}
                required
              />
            </div>
            
            <div className="form-group full-width">
              <label htmlFor="eventDescription">Event Description</label>
              <textarea
                id="eventDescription"
                name="eventDescription"
                value={formData.eventDescription}
                onChange={handleInputChange}
                rows="3"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="startDate">Start Date *</label>
              <input
                type="date"
                id="startDate"
                name="startDate"
                value={formData.startDate}
                onChange={handleInputChange}
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="startTime">Start Time *</label>
              <input
                type="time"
                id="startTime"
                name="startTime"
                value={formData.startTime}
                onChange={handleInputChange}
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="endDate">End Date *</label>
              <input
                type="date"
                id="endDate"
                name="endDate"
                value={formData.endDate}
                onChange={handleInputChange}
                min={formData.startDate}
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="endTime">End Time *</label>
              <input
                type="time"
                id="endTime"
                name="endTime"
                value={formData.endTime}
                onChange={handleInputChange}
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="attendeeCount">Expected Attendees</label>
              <input
                type="number"
                id="attendeeCount"
                name="attendeeCount"
                value={formData.attendeeCount}
                onChange={handleInputChange}
                min="1"
                placeholder="0"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="setupTimeMinutes">Setup Time (minutes)</label>
              <input
                type="number"
                id="setupTimeMinutes"
                name="setupTimeMinutes"
                value={formData.setupTimeMinutes}
                onChange={handleInputChange}
                min="0"
                max="480"
                placeholder="0"
              />
              <div className="help-text">Additional time before event for setup</div>
            </div>
            
            <div className="form-group">
              <label htmlFor="teardownTimeMinutes">Teardown Time (minutes)</label>
              <input
                type="number"
                id="teardownTimeMinutes"
                name="teardownTimeMinutes"
                value={formData.teardownTimeMinutes}
                onChange={handleInputChange}
                min="0"
                max="480"
                placeholder="0"
              />
              <div className="help-text">Additional time after event for cleanup</div>
            </div>
          </div>
        </section>

        {/* Contact Information */}
        <section className="form-section">
          <h2>Additional Contact Information</h2>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="department">Department</label>
              <input
                type="text"
                id="department"
                name="department"
                value={formData.department}
                onChange={handleInputChange}
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="phone">Phone</label>
              <input
                type="tel"
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleInputChange}
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="contactEmail">Contact Person Email</label>
              <input
                type="email"
                id="contactEmail"
                name="contactEmail"
                value={formData.contactEmail}
                onChange={handleInputChange}
                placeholder="Email for reservation updates"
              />
            </div>
            
            {formData.contactEmail && (
              <div className="form-group full-width">
                <p className="delegation-info">
                  📧 Reservation updates will be sent to <strong>{formData.contactEmail}</strong>
                </p>
              </div>
            )}
          </div>
        </section>
        
        {/* Room Selection */}
        <section className="form-section">
          <h2>Select Room(s) *</h2>
          {formData.attendeeCount && (
            <p className="help-text">
              Showing rooms with capacity for {formData.attendeeCount} or more attendees
            </p>
          )}
          
          {checkingAvailability && (
            <LoadingSpinner minHeight={100} size={40} />
          )}
          
          <div className="room-grid">
            {rooms.map(room => {
              const roomAvailability = availability.find(a => a.room._id === room._id);
              const isAvailable = !roomAvailability || roomAvailability.available;
              const { meetsCapacity, issue } = checkRoomCapacity(room);
              
              return (
                <div
                  key={room._id}
                  className={`room-card ${formData.requestedRooms.includes(room._id) ? 'selected' : ''} ${!isAvailable ? 'unavailable' : ''} ${!meetsCapacity ? 'room-insufficient' : ''}`}
                  onClick={() => isAvailable && handleRoomSelection(room._id)}
                >
                  <h3>{room.name}</h3>
                  <p className="room-location">{room.building} - {room.floor}</p>
                  <p className="room-capacity">Capacity: {room.capacity}</p>
                  
                  {room.features && room.features.length > 0 && (
                    <div className="room-features">
                      {room.features.slice(0, 3).map(feature => (
                        <span key={feature} className="feature-tag">{feature}</span>
                      ))}
                      {room.features.length > 3 && (
                        <span className="feature-tag">+{room.features.length - 3} more</span>
                      )}
                    </div>
                  )}
                  
                  {room.description && (
                    <p className="room-description">{room.description}</p>
                  )}
                  
                  {!isAvailable && roomAvailability && (
                    <div className="availability-warning">
                      ⚠️ Conflicts detected
                      {roomAvailability.conflicts.events.length > 0 && (
                        <span> - {roomAvailability.conflicts.events.length} calendar event(s)</span>
                      )}
                      {roomAvailability.conflicts.reservations.length > 0 && (
                        <span> - {roomAvailability.conflicts.reservations.length} pending reservation(s)</span>
                      )}
                      
                      {/* Smart time suggestions */}
                      {roomAvailability.suggestions && roomAvailability.suggestions.length > 0 && (
                        <div className="time-suggestions">
                          <div className="suggestions-header">💡 Available times:</div>
                          {roomAvailability.suggestions.slice(0, 2).map((suggestion, index) => (
                            <div key={index} className="suggestion-item">
                              <span className="suggestion-time">
                                {new Date(suggestion.startTime).toLocaleTimeString('en-US', { 
                                  hour: 'numeric', 
                                  minute: '2-digit', 
                                  hour12: true 
                                })} - {new Date(suggestion.endTime).toLocaleTimeString('en-US', { 
                                  hour: 'numeric', 
                                  minute: '2-digit', 
                                  hour12: true 
                                })}
                              </span>
                              <span className="suggestion-label">({suggestion.recommendation})</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {!meetsCapacity && issue && (
                    <div className="criteria-warning">
                      <div className="criteria-issue">❌ {issue}</div>
                    </div>
                  )}
                  
                  {/* Timeline toggle button - always available */}
                  <div className="timeline-controls">
                    <button
                      type="button"
                      className="timeline-toggle-btn"
                      onClick={(e) => {
                        e.stopPropagation(); // Prevent room selection
                        toggleTimeline(room._id);
                      }}
                    >
                      📅 {expandedTimelines.has(room._id) ? 'Hide' : 'View'} Schedule
                    </button>
                  </div>
                  
                  {/* Timeline component */}
                  {expandedTimelines.has(room._id) && (
                    <RoomTimeline
                      room={room}
                      conflicts={roomAvailability?.conflicts || { reservations: [], events: [] }}
                      requestedWindow={roomAvailability?.requestedWindow}
                    />
                  )}
                </div>
              );
            })}
          </div>
          
          {roomsLoading && (
            <LoadingSpinner minHeight={100} size={40} />
          )}
          
          {!roomsLoading && rooms.length === 0 && (
            <div className="no-rooms-message">
              No rooms available. Please contact the office for assistance.
            </div>
          )}
        </section>
        
        {/* Special Requirements */}
        <section className="form-section">
          <h2>Special Requirements</h2>
          <div className="form-group full-width">
            <label htmlFor="specialRequirements">Additional Notes or Special Setup Requirements</label>
            <textarea
              id="specialRequirements"
              name="specialRequirements"
              value={formData.specialRequirements}
              onChange={handleInputChange}
              rows="4"
              placeholder="Please describe any special setup needs, equipment requirements, or other important information..."
            />
          </div>
        </section>
        
        {/* Submit */}
        <div className="form-actions">
          <button
            type="submit"
            className="submit-btn"
            disabled={loading || formData.requestedRooms.length === 0 || !formData.userMessage.trim()}
          >
            {loading ? 'Resubmitting...' : `Resubmit Reservation (v${revisionNumber})`}
          </button>
          
          <button
            type="button"
            className="cancel-btn"
            onClick={() => navigate('/my-reservations')}
            disabled={loading}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}