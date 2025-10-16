// src/components/RoomReservationForm.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMsal } from '@azure/msal-react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import RoomTimeline from './RoomTimeline';
import SchedulingAssistant from './SchedulingAssistant';
import LocationListSelect from './LocationListSelect';
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
  const [timeErrors, setTimeErrors] = useState([]);
  
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

  const handleEventTimeChange = ({ startTime, endTime, setupTime, teardownTime, doorOpenTime, doorCloseTime }) => {
    // Update form times when user drags the event in scheduling assistant
    setFormData(prev => ({
      ...prev,
      startTime,
      endTime,
      // Update setupTime/teardownTime if provided (they represent the new blocking times)
      ...(setupTime && { setupTime }),
      ...(teardownTime && { teardownTime }),
      // Update doorOpenTime/doorCloseTime if provided
      ...(doorOpenTime && { doorOpenTime }),
      ...(doorCloseTime && { doorCloseTime })
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

  // Validate time fields are in chronological order
  const validateTimes = () => {
    const errors = [];
    const { setupTime, doorOpenTime, startTime, endTime, doorCloseTime, teardownTime } = formData;

    // Convert times to comparable numbers (minutes since midnight)
    const timeToMinutes = (timeStr) => {
      if (!timeStr) return null;
      const [hours, minutes] = timeStr.split(':').map(Number);
      return hours * 60 + minutes;
    };

    const setup = timeToMinutes(setupTime);
    const doorOpen = timeToMinutes(doorOpenTime);
    const eventStart = timeToMinutes(startTime);
    const eventEnd = timeToMinutes(endTime);
    const doorClose = timeToMinutes(doorCloseTime);
    const teardown = timeToMinutes(teardownTime);

    // Check required times exist
    if (!startTime) {
      errors.push('Event Start Time is required');
    }
    if (!endTime) {
      errors.push('Event End Time is required');
    }

    // Validate chronological order (only check if both times exist)
    if (eventStart !== null && eventEnd !== null && eventStart >= eventEnd) {
      errors.push('Event End Time must be after Event Start Time');
    }

    if (setup !== null && doorOpen !== null && setup > doorOpen) {
      errors.push('Door Open Time must be after Setup Start Time');
    }

    if (setup !== null && eventStart !== null && setup > eventStart) {
      errors.push('Event Start Time must be after Setup Start Time');
    }

    if (doorOpen !== null && eventStart !== null && doorOpen > eventStart) {
      errors.push('Event Start Time must be after Door Open Time');
    }

    if (eventEnd !== null && doorClose !== null && eventEnd > doorClose) {
      errors.push('Door Close Time must be after Event End Time');
    }

    if (eventEnd !== null && teardown !== null && eventEnd > teardown) {
      errors.push('Teardown End Time must be after Event End Time');
    }

    if (doorClose !== null && teardown !== null && doorClose > teardown) {
      errors.push('Teardown End Time must be after Door Close Time');
    }

    setTimeErrors(errors);
    return errors.length === 0;
  };

  // Validate times whenever time fields change
  useEffect(() => {
    if (formData.startTime || formData.endTime) {
      validateTimes();
    } else {
      setTimeErrors([]);
    }
  }, [formData.setupTime, formData.doorOpenTime, formData.startTime, formData.endTime, formData.doorCloseTime, formData.teardownTime]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Validate times before submission
    if (!validateTimes()) {
      setError('Please fix the time validation errors before submitting');
      setLoading(false);
      return;
    }

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
        {/* Event Details + Room Selection Side-by-Side */}
        <div className="event-and-rooms-container">
          {/* Left side: Event Details (30%) */}
          <section className="form-section event-details-compact">
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

          {/* Time Fields Stacked in Chronological Order */}
          <div className="time-fields-stack">
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

          {/* Time Validation Errors */}
          {timeErrors.length > 0 && (
            <div className="time-validation-errors">
              <h4>⚠️ Time Validation Issues:</h4>
              <ul>
                {timeErrors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
              <p className="validation-help">
                Times should follow this order: Setup Start → Door Open → Event Start → Event End → Door Close → Teardown End
              </p>
            </div>
          )}

          </section>

          {/* Right side: Resource Details (70%) */}
          <section className="form-section">
            <h2>Resource Details</h2>

            {checkingAvailability && (
              <div className="loading-message">Checking availability...</div>
            )}

            <div className="room-selection-container">
              {/* Left side: Scheduling Assistant (2/3) */}
              <div className="scheduling-assistant-container">
                <SchedulingAssistant
                  selectedRooms={assistantRooms}
                  selectedDate={formData.startDate}
                  eventStartTime={formData.startTime}
                  eventEndTime={formData.endTime}
                  setupTime={formData.setupTime}
                  teardownTime={formData.teardownTime}
                  doorOpenTime={formData.doorOpenTime}
                  doorCloseTime={formData.doorCloseTime}
                  eventTitle={formData.eventTitle}
                  availability={availability}
                  onTimeSlotClick={handleTimeSlotClick}
                  onRoomRemove={handleRemoveAssistantRoom}
                  onEventTimeChange={handleEventTimeChange}
                />
              </div>

              {/* Right side: Location MultiSelect (1/3) */}
              <div className="room-cards-section">
                {roomsLoading ? (
                  <div className="loading-message">Loading locations...</div>
                ) : allRooms.length === 0 ? (
                  <div className="no-rooms-message">
                    No locations available. Please contact the office for assistance.
                  </div>
                ) : (
                  <LocationListSelect
                    rooms={allRooms}
                    availability={availability}
                    selectedRooms={formData.requestedRooms}
                    onRoomSelectionChange={handleRoomSelectionChange}
                    checkRoomCapacity={checkRoomCapacity}
                    label="Requested locations"
                    eventStartTime={formData.startTime}
                    eventEndTime={formData.endTime}
                    eventDate={formData.startDate}
                  />
                )}
              </div>
            </div>
          </section>
        </div>

        {/* Additional Information + Submitter Info (2-column) */}
        <div className="section-row-2col">
          {/* Left Column: Additional Information */}
          <section className="form-section">
            <h2>Additional Information</h2>

            {/* Special Requirements */}
            <div className="form-group full-width" style={{ marginBottom: '20px' }}>
              <label htmlFor="specialRequirements">Special Requirements</label>
              <textarea
                id="specialRequirements"
                name="specialRequirements"
                value={formData.specialRequirements}
                onChange={handleInputChange}
                rows="2"
                placeholder="Additional notes or special setup requirements..."
              />
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
                    rows="1"
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
                    rows="1"
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
                    rows="1"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Right Column: Submitter Information */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <section className="form-section">
              <h2>Submitter Information</h2>
              <div className="form-grid">
                <div className="form-group">
                  <label htmlFor="requesterName">Requester Name</label>
                  <input
                    type="text"
                    id="requesterName"
                    name="requesterName"
                    value={formData.requesterName}
                    readOnly
                    className="readonly-field"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="requesterEmail">Requester Email</label>
                  <input
                    type="email"
                    id="requesterEmail"
                    name="requesterEmail"
                    value={formData.requesterEmail}
                    readOnly
                    className="readonly-field"
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

                <div className="form-group full-width">
                  <label htmlFor="contactEmail">Contact Person Email</label>
                  <input
                    type="email"
                    id="contactEmail"
                    name="contactEmail"
                    value={formData.contactEmail}
                    onChange={handleInputChange}
                    placeholder="Email for reservation updates (optional)"
                  />
                </div>
              </div>

              {formData.contactEmail && (
                <div className="delegation-info" style={{ marginTop: '8px' }}>
                  📧 Reservation updates will be sent to <strong>{formData.contactEmail}</strong>
                </div>
              )}
            </section>
          </div>
        </div>
        
        {/* Submit */}
        <div className="form-actions">
          <button
            type="submit"
            className="submit-btn"
            disabled={loading || formData.requestedRooms.length === 0 || timeErrors.length > 0}
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