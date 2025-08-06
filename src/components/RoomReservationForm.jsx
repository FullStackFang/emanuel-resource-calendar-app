// src/components/RoomReservationForm.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMsal } from '@azure/msal-react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import './RoomReservationForm.css';

export default function RoomReservationForm({ apiToken, isPublic }) {
  const { token } = useParams();
  const navigate = useNavigate();
  const { accounts } = useMsal();
  
  // Form state
  const [formData, setFormData] = useState({
    requesterName: '',
    requesterEmail: '',
    department: '',
    phone: '',
    eventTitle: '',
    eventDescription: '',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    attendeeCount: '',
    requestedRooms: [],
    requiredFeatures: [],
    specialRequirements: '',
    priority: 'medium'
  });
  
  // UI state
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [availability, setAvailability] = useState([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  
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
  
  // Load available rooms
  useEffect(() => {
    loadRooms();
  }, []);

  // Auto-fill user email if authenticated and not in public mode
  useEffect(() => {
    if (!isPublic && accounts.length > 0) {
      const userEmail = accounts[0].username;
      const displayName = accounts[0].name || '';
      
      setFormData(prev => ({
        ...prev,
        requesterEmail: userEmail,
        requesterName: displayName
      }));
    }
  }, [isPublic, accounts]);
  
  const loadRooms = async () => {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/rooms`);
      if (!response.ok) throw new Error('Failed to load rooms');
      
      const data = await response.json();
      setRooms(data);
    } catch (err) {
      logger.error('Error loading rooms:', err);
      setError('Failed to load available rooms');
    }
  };
  
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
      // Combine date and time
      const startDateTime = `${formData.startDate}T${formData.startTime}`;
      const endDateTime = `${formData.endDate}T${formData.endTime}`;
      
      const payload = {
        ...formData,
        startDateTime,
        endDateTime,
        attendeeCount: parseInt(formData.attendeeCount) || 0
      };
      
      // Remove separate date/time fields
      delete payload.startDate;
      delete payload.startTime;
      delete payload.endDate;
      delete payload.endTime;
      
      // Determine endpoint based on public/authenticated access
      const endpoint = isPublic 
        ? `${APP_CONFIG.API_BASE_URL}/room-reservations/public/${token}` 
        : `${APP_CONFIG.API_BASE_URL}/room-reservations`;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiToken && { 'Authorization': `Bearer ${apiToken}` })
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit reservation');
      }
      
      const result = await response.json();
      logger.log('Room reservation submitted:', result);
      
      setSuccess(true);
      
      // Redirect after success
      setTimeout(() => {
        if (isPublic) {
          window.location.href = '/'; // Redirect to main page for public users
        } else {
          navigate('/'); // Navigate to calendar for authenticated users
        }
      }, 3000);
      
    } catch (err) {
      logger.error('Error submitting reservation:', err);
      setError(err.message || 'Failed to submit reservation request');
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
  
  // Get all rooms (no filtering)
  const allRooms = rooms;
  
  if (success) {
    return (
      <div className="room-reservation-form">
        <div className="success-message">
          <h2>✅ Reservation Request Submitted!</h2>
          <p>Your room reservation request has been submitted successfully.</p>
          <p>You will receive a confirmation email once it has been reviewed.</p>
          <p>Redirecting...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="room-reservation-form">
      <h1>Room Reservation Request</h1>
      
      {error && (
        <div className="error-message">
          ❌ {error}
        </div>
      )}
      
      <form onSubmit={handleSubmit}>
        {/* Contact Information */}
        <section className="form-section">
          <h2>Contact Information</h2>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="requesterName">Name *</label>
              <input
                type="text"
                id="requesterName"
                name="requesterName"
                value={formData.requesterName}
                onChange={handleInputChange}
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="requesterEmail">Email *</label>
              <input
                type="email"
                id="requesterEmail"
                name="requesterEmail"
                value={formData.requesterEmail}
                onChange={handleInputChange}
                required
              />
            </div>
            
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
            {allRooms.map(room => {
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
          
          {allRooms.length === 0 && (
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
            disabled={loading || formData.requestedRooms.length === 0}
          >
            {loading ? 'Submitting...' : 'Submit Reservation Request'}
          </button>
          
          {!isPublic && (
            <button
              type="button"
              className="cancel-btn"
              onClick={() => navigate('/')}
              disabled={loading}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}