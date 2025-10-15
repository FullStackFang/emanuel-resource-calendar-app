// src/components/RoomReservationForm.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMsal } from '@azure/msal-react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import RoomTimeline from './RoomTimeline';
import SchedulingAssistant from './SchedulingAssistant';
import LocationMultiSelect from './LocationMultiSelect';
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
    // Access & Operations Times (optional)
    doorOpenTime: '',
    doorCloseTime: '',
    setupTime: '',
    teardownTime: '',
    // Internal Notes (staff use only)
    setupNotes: '',
    doorNotes: '',
    eventNotes: '',
    attendeeCount: '',
    requestedRooms: [],
    specialRequirements: '',
    priority: 'medium',
    // Legacy setup/teardown times in minutes (for backward compatibility)
    setupTimeMinutes: 0,
    teardownTimeMinutes: 0,
    // Contact field for reservation updates
    contactEmail: ''
  });
  
  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [availability, setAvailability] = useState([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [hasAutoFilled, setHasAutoFilled] = useState(false);
  const [assistantRooms, setAssistantRooms] = useState([]);
  
  // Use room context for efficient room management
  const { rooms, loading: roomsLoading, getRoomName } = useRooms();
  
  
  // Auto-fill user email if authenticated and not in public mode (only once)
  useEffect(() => {
    if (!isPublic && accounts.length > 0 && !hasAutoFilled) {
      const userEmail = accounts[0].username;
      const displayName = accounts[0].name || '';
      
      setFormData(prev => ({
        ...prev,
        requesterEmail: userEmail,
        requesterName: displayName
      }));
      
      setHasAutoFilled(true);
    }
  }, [isPublic, accounts, hasAutoFilled]);
  
  // Check room availability when dates or buffer times change
  // Skip this if scheduling assistant is active (has rooms) - use checkDayAvailability instead
  useEffect(() => {
    if (formData.startDate && formData.startTime && formData.endDate && formData.endTime && assistantRooms.length === 0) {
      checkAvailability();
    }
  }, [formData.startDate, formData.startTime, formData.endDate, formData.endTime, formData.setupTimeMinutes, formData.teardownTimeMinutes, formData.setupTime, formData.teardownTime, assistantRooms.length]);
  
  const checkAvailability = async () => {
    try {
      setCheckingAvailability(true);
      
      const startDateTime = `${formData.startDate}T${formData.startTime}`;
      const endDateTime = `${formData.endDate}T${formData.endTime}`;
      
      // Calculate setup/teardown minutes for availability check
      let setupTimeMinutes = formData.setupTimeMinutes || 0;
      let teardownTimeMinutes = formData.teardownTimeMinutes || 0;
      
      // If new time-based setup/teardown is provided, calculate minutes
      if (formData.setupTime) {
        setupTimeMinutes = calculateTimeBufferMinutes(formData.startTime, formData.setupTime);
      }
      if (formData.teardownTime) {
        teardownTimeMinutes = calculateTimeBufferMinutes(formData.endTime, formData.teardownTime);
      }
      
      // Include setup/teardown times in availability check
      const params = new URLSearchParams({
        startDateTime,
        endDateTime,
        setupTimeMinutes,
        teardownTimeMinutes
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

  // Check availability for the entire day for scheduling assistant
  const checkDayAvailability = async (roomIds, date) => {
    if (!roomIds.length || !date) {
      console.log('[RoomReservationForm] checkDayAvailability skipped - no rooms or date');
      return;
    }

    try {
      // Set time range for the entire day (24 hours)
      const startDateTime = `${date}T00:00:00`;
      const endDateTime = `${date}T23:59:59`;

      const params = new URLSearchParams({
        startDateTime,
        endDateTime,
        roomIds: roomIds.join(','),
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0
      });

      const url = `${APP_CONFIG.API_BASE_URL}/rooms/availability?${params}`;
      console.log('[RoomReservationForm] Fetching day availability:', {
        url,
        roomIds,
        date,
        startDateTime,
        endDateTime
      });

      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to check day availability');

      const data = await response.json();
      console.log('[RoomReservationForm] Day availability response:', data);
      setAvailability(data);
    } catch (err) {
      logger.error('Error checking day availability:', err);
    }
  };

  // Check availability when assistant rooms or DATE changes (not times!)
  // This ensures the scheduling assistant always shows the full day, not just conflicts
  useEffect(() => {
    if (assistantRooms.length > 0) {
      const roomIds = assistantRooms.map(room => room._id);
      // Use selected date or today's date as default (in local timezone)
      const getTodayDate = () => {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      const dateToCheck = formData.startDate || getTodayDate();
      checkDayAvailability(roomIds, dateToCheck);
    }
  }, [assistantRooms, formData.startDate]); // Removed formData.endDate, startTime, endTime
  
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
  
  const toggleAssistantRoom = (room) => {
    setAssistantRooms(prev => {
      const isAlreadySelected = prev.find(r => r._id === room._id);
      if (isAlreadySelected) {
        // Remove room from assistant
        return prev.filter(r => r._id !== room._id);
      } else {
        // Add room to assistant
        return [...prev, room];
      }
    });
  };

  const handleRemoveAssistantRoom = (room) => {
    // Remove from both assistant rooms and form data to ensure it persists
    setAssistantRooms(prev => prev.filter(r => r._id !== room._id));
    setFormData(prev => ({
      ...prev,
      requestedRooms: prev.requestedRooms.filter(id => id !== room._id)
    }));
  };

  const handleTimeSlotClick = (hour) => {
    // Future enhancement: allow clicking time slots to set event time
    logger.debug('Time slot clicked:', hour);
  };

  const handleEventTimeChange = ({ startTime, endTime }) => {
    // Update form times when user drags the event in scheduling assistant
    setFormData(prev => ({
      ...prev,
      startTime,
      endTime
    }));
  };

  const handleRoomSelectionChange = (newSelectedRooms) => {
    setFormData(prev => ({
      ...prev,
      requestedRooms: newSelectedRooms
    }));
  };

  
  // Helper function to convert time difference to minutes
  const calculateTimeBufferMinutes = (eventTime, bufferTime) => {
    if (!eventTime || !bufferTime) return 0;
    
    const eventDate = new Date(`1970-01-01T${eventTime}:00`);
    const bufferDate = new Date(`1970-01-01T${bufferTime}:00`);
    
    // Calculate difference in minutes
    const diffMs = Math.abs(eventDate.getTime() - bufferDate.getTime());
    return Math.floor(diffMs / (1000 * 60));
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      // Combine date and time
      const startDateTime = `${formData.startDate}T${formData.startTime}`;
      const endDateTime = `${formData.endDate}T${formData.endTime}`;
      
      // Calculate setup/teardown minutes from time fields (for backward compatibility)
      let setupTimeMinutes = formData.setupTimeMinutes || 0;
      let teardownTimeMinutes = formData.teardownTimeMinutes || 0;
      
      // If new time-based setup/teardown is provided, calculate minutes
      if (formData.setupTime) {
        setupTimeMinutes = calculateTimeBufferMinutes(formData.startTime, formData.setupTime);
      }
      if (formData.teardownTime) {
        teardownTimeMinutes = calculateTimeBufferMinutes(formData.endTime, formData.teardownTime);
      }
      
      const payload = {
        ...formData,
        startDateTime,
        endDateTime,
        attendeeCount: parseInt(formData.attendeeCount) || 0,
        // Include both new time fields and converted minutes for compatibility
        setupTimeMinutes,
        teardownTimeMinutes
      };
      
      // Remove separate date/time fields from payload
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
  
  // Get all rooms (no filtering)
  const allRooms = rooms;
  
  // Update assistant rooms when selected rooms change
  useEffect(() => {
    const selectedRoomObjects = allRooms.filter(room => 
      formData.requestedRooms.includes(room._id)
    );
    setAssistantRooms(selectedRoomObjects);
  }, [formData.requestedRooms, allRooms]);
  
  if (success) {
    return (
      <div className="room-reservation-form">
        <div className="success-message">
          <h2>✅ Reservation Request Submitted!</h2>
          <p>Your space booking request has been submitted successfully.</p>
          <p>You will receive a confirmation email once it has been reviewed.</p>
          <p>Redirecting...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="room-reservation-form">
      <h1>Space Booking Request</h1>
      
      {error && (
        <div className="error-message">
          ❌ {error}
        </div>
      )}
      
      <form onSubmit={handleSubmit}>
        {/* Contact Information */}
        <section className="form-section">
          <h2>Submitter Information</h2>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="requesterName">Your Name *</label>
              <input
                type="text"
                id="requesterName"
                name="requesterName"
                value={formData.requesterName}
                readOnly
                className="readonly-field"
                title="This field is automatically filled from your account"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="requesterEmail">Your Email *</label>
              <input
                type="email"
                id="requesterEmail"
                name="requesterEmail"
                value={formData.requesterEmail}
                readOnly
                className="readonly-field"
                title="This field is automatically filled from your account"
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

        {/* Contact Information */}
        <section className="form-section">
          <h2>Contact Information</h2>
          <div className="form-grid">
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
        
        {/* Event Details */}
        <section className="form-section">
          <h2>Event Details</h2>
          
          {/* Basic Event Information */}
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

          {/* Date Fields */}
          <div className="time-field-row">
            <div className="form-group">
              <label htmlFor="startDate">Event Date *</label>
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
          </div>

          {/* Time Fields in Chronological Order */}
          <div className="time-field-row">
            <div className="form-group">
              <label htmlFor="setupTime">Setup Start Time</label>
              <input
                type="time"
                id="setupTime"
                name="setupTime"
                value={formData.setupTime}
                onChange={handleInputChange}
              />
              <div className="help-text">When setup can begin</div>
            </div>

            <div className="form-group">
              <label htmlFor="doorOpenTime">Door Open Time</label>
              <input
                type="time"
                id="doorOpenTime"
                name="doorOpenTime"
                value={formData.doorOpenTime}
                onChange={handleInputChange}
              />
              <div className="help-text">When attendees can start entering</div>
            </div>
          </div>

          <div className="time-field-row">
            <div className="form-group">
              <label htmlFor="startTime">Event Start Time *</label>
              <input
                type="time"
                id="startTime"
                name="startTime"
                value={formData.startTime}
                onChange={handleInputChange}
                required
              />
              <div className="help-text">When the event begins</div>
            </div>

            <div className="form-group">
              <label htmlFor="endTime">Event End Time *</label>
              <input
                type="time"
                id="endTime"
                name="endTime"
                value={formData.endTime}
                onChange={handleInputChange}
                required
              />
              <div className="help-text">When the event ends</div>
            </div>
          </div>

          <div className="time-field-row">
            <div className="form-group">
              <label htmlFor="doorCloseTime">Door Close Time</label>
              <input
                type="time"
                id="doorCloseTime"
                name="doorCloseTime"
                value={formData.doorCloseTime}
                onChange={handleInputChange}
              />
              <div className="help-text">When doors will be locked</div>
            </div>

            <div className="form-group">
              <label htmlFor="teardownTime">Teardown End Time</label>
              <input
                type="time"
                id="teardownTime"
                name="teardownTime"
                value={formData.teardownTime}
                onChange={handleInputChange}
              />
              <div className="help-text">When cleanup must be completed</div>
            </div>
          </div>

          {/* Internal Notes Section */}
          <div className="internal-notes-section">
              <h4>🔒 Internal Notes (Staff Use Only)</h4>
              <div className="internal-notes-disclaimer">
                These notes are for internal staff coordination and will not be visible to the requester.
              </div>
              
              <div className="notes-field-row">
                <div className="form-group">
                  <label htmlFor="setupNotes">Setup Notes</label>
                  <textarea
                    id="setupNotes"
                    name="setupNotes"
                    value={formData.setupNotes}
                    onChange={handleInputChange}
                    rows="2"
                    placeholder="Internal notes about setup requirements..."
                  />
                </div>
              </div>
              
              <div className="notes-field-row">
                <div className="form-group">
                  <label htmlFor="doorNotes">Door/Access Notes</label>
                  <textarea
                    id="doorNotes"
                    name="doorNotes"
                    value={formData.doorNotes}
                    onChange={handleInputChange}
                    rows="2"
                    placeholder="Internal notes about door access, keys, security..."
                  />
                </div>
              </div>
              
              <div className="notes-field-row">
                <div className="form-group">
                  <label htmlFor="eventNotes">Event Notes</label>
                  <textarea
                    id="eventNotes"
                    name="eventNotes"
                    value={formData.eventNotes}
                    onChange={handleInputChange}
                    rows="2"
                    placeholder="Internal notes about the event, special considerations..."
                  />
                </div>
              </div>
            </div>
        </section>
        
        {/* Room Selection */}
        <section className="form-section">
          <h2>Select Location(s) *</h2>
          {formData.attendeeCount && (
            <p className="help-text">
              Choose "Reserve" to book locations and "View" to see their schedules. Search by name, building, or features.
            </p>
          )}
          
          {checkingAvailability && (
            <div className="loading-message">Checking availability...</div>
          )}
          
          <div className="room-selection-container">
            {/* Left side: Location MultiSelect */}
            <div className="room-cards-section">
              {roomsLoading ? (
                <div className="loading-message">Loading available locations...</div>
              ) : allRooms.length === 0 ? (
                <div className="no-rooms-message">
                  No locations available. Please contact the office for assistance.
                </div>
              ) : (
                <LocationMultiSelect
                  rooms={allRooms}
                  availability={availability}
                  selectedRooms={formData.requestedRooms}
                  onRoomSelectionChange={handleRoomSelectionChange}
                  checkRoomCapacity={checkRoomCapacity}
                  label="Choose locations for your event"
                  eventStartTime={formData.startTime}
                  eventEndTime={formData.endTime}
                  eventDate={formData.startDate}
                />
              )}
              
              {/* Selected Rooms Summary */}
              {formData.requestedRooms.length > 0 && (
                <div className="selected-rooms-summary">
                  <div className="summary-section">
                    <h4>📍 Selected Locations:</h4>
                    <div className="selected-pills">
                      {formData.requestedRooms.map(roomId => {
                        const room = allRooms.find(r => r._id === roomId);
                        return room ? (
                          <div key={roomId} className="room-pill reservation-pill">
                            {room.name}
                            <button
                              type="button"
                              onClick={() => handleRoomSelectionChange(
                                formData.requestedRooms.filter(id => id !== roomId)
                              )}
                              className="pill-remove"
                              title="Remove location"
                            >
                              ×
                            </button>
                          </div>
                        ) : null;
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right side: Scheduling Assistant */}
            <div className="scheduling-assistant-container">
              <SchedulingAssistant
                selectedRooms={assistantRooms}
                selectedDate={formData.startDate}
                eventStartTime={formData.startTime}
                eventEndTime={formData.endTime}
                eventTitle={formData.eventTitle}
                availability={availability}
                onTimeSlotClick={handleTimeSlotClick}
                onRoomRemove={handleRemoveAssistantRoom}
                onEventTimeChange={handleEventTimeChange}
              />
            </div>
          </div>
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