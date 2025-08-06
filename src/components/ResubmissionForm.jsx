// src/components/ResubmissionForm.jsx
import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/RoomContext';
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
    requiredFeatures: originalReservation?.requiredFeatures || [],
    specialRequirements: originalReservation?.specialRequirements || '',
    priority: originalReservation?.priority || 'medium',
    department: originalReservation?.department || '',
    phone: originalReservation?.phone || '',
    contactEmail: originalReservation?.contactEmail || '',
    userMessage: ''
  });
  
  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [availability, setAvailability] = useState([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  
  // Use room context for efficient room management
  const { rooms, loading: roomsLoading, getRoomName } = useRooms();
  
  // Feature options
  const featureOptions = [
    { value: 'kitchen', label: '🍽️ Kitchen' },
    { value: 'av-equipment', label: '📽️ A/V Equipment' },
    { value: 'projector', label: '🎬 Projector' },
    { value: 'whiteboard', label: '📝 Whiteboard' },
    { value: 'piano', label: '🎹 Piano' },
    { value: 'stage', label: '🎭 Stage' },
    { value: 'microphone', label: '🎤 Microphone' },
    { value: 'wheelchair-accessible', label: '♿ Wheelchair Accessible' },
    { value: 'hearing-loop', label: '🔊 Hearing Loop' }
  ];

  // Redirect if no reservation data
  useEffect(() => {
    if (!reservationId || !originalReservation) {
      navigate('/my-reservations');
    }
  }, [reservationId, originalReservation, navigate]);

  // Check room availability when dates change
  useEffect(() => {
    if (formData.startDate && formData.startTime && formData.endDate && formData.endTime) {
      checkAvailability();
    }
  }, [formData.startDate, formData.startTime, formData.endDate, formData.endTime]);
  
  const checkAvailability = async () => {
    try {
      setCheckingAvailability(true);
      
      const startDateTime = `${formData.startDate}T${formData.startTime}`;
      const endDateTime = `${formData.endDate}T${formData.endTime}`;
      
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/rooms/availability?startDateTime=${startDateTime}&endDateTime=${endDateTime}`);
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
  
  const handleFeatureSelection = (feature) => {
    setFormData(prev => ({
      ...prev,
      requiredFeatures: prev.requiredFeatures.includes(feature)
        ? prev.requiredFeatures.filter(f => f !== feature)
        : [...prev.requiredFeatures, feature]
    }));
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
        requiredFeatures: formData.requiredFeatures,
        specialRequirements: formData.specialRequirements,
        department: formData.department,
        phone: formData.phone,
        priority: formData.priority,
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

  // Check if a room meets the criteria
  const checkRoomCriteria = (room) => {
    const issues = [];
    let meetsCriteria = true;
    
    // Check capacity
    if (formData.attendeeCount && room.capacity < parseInt(formData.attendeeCount)) {
      meetsCriteria = false;
      issues.push(`Capacity too small (needs ${formData.attendeeCount}, has ${room.capacity})`);
    }
    
    // Check required features
    if (formData.requiredFeatures.length > 0) {
      const missingFeatures = formData.requiredFeatures.filter(feature => 
        !room.features?.includes(feature)
      );
      
      if (missingFeatures.length > 0) {
        meetsCriteria = false;
        const featureLabels = missingFeatures.map(f => 
          featureOptions.find(opt => opt.value === f)?.label || f
        );
        issues.push(`Missing features: ${featureLabels.join(', ')}`);
      }
    }
    
    return { meetsCriteria, issues };
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
              <label htmlFor="priority">Priority</label>
              <select
                id="priority"
                name="priority"
                value={formData.priority}
                onChange={handleInputChange}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
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
        
        {/* Required Features */}
        <section className="form-section">
          <h2>Required Features</h2>
          <div className="feature-grid">
            {featureOptions.map(feature => (
              <label key={feature.value} className="feature-checkbox">
                <input
                  type="checkbox"
                  checked={formData.requiredFeatures.includes(feature.value)}
                  onChange={() => handleFeatureSelection(feature.value)}
                />
                <span>{feature.label}</span>
              </label>
            ))}
          </div>
        </section>
        
        {/* Room Selection */}
        <section className="form-section">
          <h2>Select Room(s) *</h2>
          {formData.attendeeCount && (
            <p className="help-text">
              Showing rooms with capacity for {formData.attendeeCount} or more attendees
              {formData.requiredFeatures.length > 0 && ' and selected features'}
            </p>
          )}
          
          {checkingAvailability && (
            <div className="loading-message">Checking availability...</div>
          )}
          
          <div className="room-grid">
            {rooms.map(room => {
              const roomAvailability = availability.find(a => a.room._id === room._id);
              const isAvailable = !roomAvailability || roomAvailability.available;
              const { meetsCriteria, issues } = checkRoomCriteria(room);
              
              return (
                <div
                  key={room._id}
                  className={`room-card ${formData.requestedRooms.includes(room._id) ? 'selected' : ''} ${!isAvailable ? 'unavailable' : ''} ${!meetsCriteria ? 'room-insufficient' : ''}`}
                  onClick={() => isAvailable && meetsCriteria && handleRoomSelection(room._id)}
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
                    </div>
                  )}
                  
                  {!meetsCriteria && issues.length > 0 && (
                    <div className="criteria-warning">
                      {issues.map((issue, index) => (
                        <div key={index} className="criteria-issue">❌ {issue}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          
          {roomsLoading && (
            <div className="loading-message">Loading available rooms...</div>
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