// src/components/RoomReservationReview.jsx
import React, { useState, useEffect } from 'react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import SchedulingAssistant from './SchedulingAssistant';
import LocationMultiSelect from './LocationMultiSelect';
import './RoomReservationForm.css';

/**
 * RoomReservationReview - Edit mode for existing reservations
 * Reuses RoomReservationForm UI/styling but for reviewing/editing pending requests
 */
export default function RoomReservationReview({
  reservation,
  apiToken,
  onApprove,
  onReject,
  onCancel,
  onSave
}) {
  // Initialize form data from reservation
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
    doorOpenTime: '',
    doorCloseTime: '',
    setupTime: '',
    teardownTime: '',
    setupNotes: '',
    doorNotes: '',
    eventNotes: '',
    attendeeCount: '',
    requestedRooms: [],
    specialRequirements: '',
    priority: 'medium',
    setupTimeMinutes: 0,
    teardownTimeMinutes: 0,
    contactEmail: '',
    contactName: '',
    isOnBehalfOf: false
  });

  const [actionNotes, setActionNotes] = useState('');
  const [availability, setAvailability] = useState([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [assistantRooms, setAssistantRooms] = useState([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { rooms, loading: roomsLoading } = useRooms();

  // Initialize form data from reservation
  useEffect(() => {
    if (reservation) {
      const startDateTime = new Date(reservation.startDateTime);
      const endDateTime = new Date(reservation.endDateTime);

      setFormData({
        requesterName: reservation.requesterName || '',
        requesterEmail: reservation.requesterEmail || '',
        department: reservation.department || '',
        phone: reservation.phone || '',
        eventTitle: reservation.eventTitle || '',
        eventDescription: reservation.eventDescription || '',
        startDate: startDateTime.toISOString().split('T')[0],
        startTime: startDateTime.toTimeString().slice(0, 5),
        endDate: endDateTime.toISOString().split('T')[0],
        endTime: endDateTime.toTimeString().slice(0, 5),
        doorOpenTime: reservation.doorOpenTime || '',
        doorCloseTime: reservation.doorCloseTime || '',
        setupTime: reservation.setupTime || '',
        teardownTime: reservation.teardownTime || '',
        setupNotes: reservation.setupNotes || '',
        doorNotes: reservation.doorNotes || '',
        eventNotes: reservation.eventNotes || '',
        attendeeCount: reservation.attendeeCount || '',
        requestedRooms: reservation.requestedRooms || [],
        specialRequirements: reservation.specialRequirements || '',
        priority: reservation.priority || 'medium',
        setupTimeMinutes: reservation.setupTimeMinutes || 0,
        teardownTimeMinutes: reservation.teardownTimeMinutes || 0,
        contactEmail: reservation.contactEmail || '',
        contactName: reservation.contactName || '',
        isOnBehalfOf: reservation.isOnBehalfOf || false
      });
    }
  }, [reservation]);

  // Check availability when dates or times change
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

  // Check availability for the entire day for scheduling assistant
  const checkDayAvailability = async (roomIds, date) => {
    if (!roomIds.length || !date) {
      console.log('[RoomReservationReview] checkDayAvailability skipped - no rooms or date');
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
      console.log('[RoomReservationReview] Fetching day availability:', {
        url,
        roomIds,
        date,
        startDateTime,
        endDateTime
      });

      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to check day availability');

      const data = await response.json();
      console.log('[RoomReservationReview] Day availability response:', data);
      console.log('[RoomReservationReview] Total reservations returned:', data[0]?.conflicts?.reservations?.length || 0);
      setAvailability(data);
    } catch (err) {
      logger.error('Error checking day availability:', err);
    }
  };

  // Update assistant rooms when selected rooms change
  useEffect(() => {
    const selectedRoomObjects = rooms.filter(room =>
      formData.requestedRooms.includes(room._id)
    );
    setAssistantRooms(selectedRoomObjects);
  }, [formData.requestedRooms, rooms]);

  // Check availability when assistant rooms or dates change
  // NOTE: We only check when DATE changes, not TIME - this ensures all events for the day remain visible
  // Time changes (like drag operations) should not trigger a new API call
  useEffect(() => {
    if (assistantRooms.length > 0) {
      const roomIds = assistantRooms.map(room => room._id);
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
  }, [assistantRooms, formData.startDate, formData.endDate]); // Removed formData.startTime and formData.endTime

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    setHasChanges(true);
  };

  const handleRoomSelectionChange = (newSelectedRooms) => {
    setFormData(prev => ({
      ...prev,
      requestedRooms: newSelectedRooms
    }));
    setHasChanges(true);
  };

  const handleRemoveAssistantRoom = (room) => {
    // Remove from both assistant rooms and form data to ensure it persists
    setAssistantRooms(prev => prev.filter(r => r._id !== room._id));
    setFormData(prev => ({
      ...prev,
      requestedRooms: prev.requestedRooms.filter(id => id !== room._id)
    }));
    setHasChanges(true);
  };

  const checkRoomCapacity = (room) => {
    if (formData.attendeeCount && room.capacity < parseInt(formData.attendeeCount)) {
      return {
        meetsCapacity: false,
        issue: `Capacity too small (needs ${formData.attendeeCount}, has ${room.capacity})`
      };
    }
    return { meetsCapacity: true, issue: null };
  };

  const handleEventTimeChange = ({ startTime, endTime }) => {
    // Update form times when user drags the event in scheduling assistant
    setFormData(prev => ({
      ...prev,
      startTime,
      endTime
    }));
    setHasChanges(true);
  };

  const handleSaveChanges = async () => {
    if (!hasChanges || !onSave) return;

    setIsSaving(true);
    try {
      const startDateTime = `${formData.startDate}T${formData.startTime}`;
      const endDateTime = `${formData.endDate}T${formData.endTime}`;

      const updatedData = {
        ...formData,
        startDateTime,
        endDateTime,
        attendeeCount: parseInt(formData.attendeeCount) || 0
      };

      // Remove separate date/time fields
      delete updatedData.startDate;
      delete updatedData.startTime;
      delete updatedData.endDate;
      delete updatedData.endTime;

      await onSave(updatedData);
      setHasChanges(false);
    } catch (error) {
      logger.error('Error saving changes:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleApprove = () => {
    if (onApprove) {
      const startDateTime = `${formData.startDate}T${formData.startTime}`;
      const endDateTime = `${formData.endDate}T${formData.endTime}`;

      const updatedData = {
        ...formData,
        startDateTime,
        endDateTime,
        attendeeCount: parseInt(formData.attendeeCount) || 0,
        actionNotes
      };

      delete updatedData.startDate;
      delete updatedData.startTime;
      delete updatedData.endDate;
      delete updatedData.endTime;

      onApprove(updatedData, actionNotes);
    }
  };

  const handleReject = () => {
    if (onReject) {
      onReject(actionNotes);
    }
  };

  return (
    <div className="room-reservation-form" style={{ maxWidth: '100%', padding: '20px' }}>
      <form onSubmit={(e) => e.preventDefault()}>
        {/* Contact Information (Read-only in review mode) */}
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
          </div>

          {formData.isOnBehalfOf && formData.contactName && (
            <div className="form-grid" style={{ marginTop: '15px' }}>
              <div className="form-group">
                <label>Contact Person</label>
                <input
                  type="text"
                  value={`${formData.contactName} (${formData.contactEmail})`}
                  readOnly
                  className="readonly-field"
                />
                <div className="delegation-info" style={{ marginTop: '8px' }}>
                  📋 This request was submitted on behalf of this person
                </div>
              </div>
            </div>
          )}
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
                disabled={reservation?.status !== 'pending'}
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
                disabled={reservation?.status !== 'pending'}
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
                disabled={reservation?.status !== 'pending'}
              />
            </div>

            <div className="form-group">
              <label htmlFor="priority">Priority</label>
              <select
                id="priority"
                name="priority"
                value={formData.priority}
                onChange={handleInputChange}
                disabled={reservation?.status !== 'pending'}
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
                disabled={reservation?.status !== 'pending'}
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
                disabled={reservation?.status !== 'pending'}
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
                disabled={reservation?.status !== 'pending'}
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
                disabled={reservation?.status !== 'pending'}
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
                disabled={reservation?.status !== 'pending'}
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
                disabled={reservation?.status !== 'pending'}
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
                disabled={reservation?.status !== 'pending'}
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
                disabled={reservation?.status !== 'pending'}
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
                    disabled={reservation?.status !== 'pending'}
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
                    disabled={reservation?.status !== 'pending'}
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
                    disabled={reservation?.status !== 'pending'}
                  />
                </div>
              </div>
            </div>
        </section>

        {/* Room Selection */}
        <section className="form-section">
          <h2>Selected Location(s)</h2>

          {checkingAvailability && (
            <div className="loading-message">Checking availability...</div>
          )}

          <div className="room-selection-container">
            <div className="room-cards-section">
              {roomsLoading ? (
                <div className="loading-message">Loading locations...</div>
              ) : (
                <LocationMultiSelect
                  rooms={rooms}
                  availability={availability}
                  selectedRooms={formData.requestedRooms}
                  onRoomSelectionChange={handleRoomSelectionChange}
                  checkRoomCapacity={checkRoomCapacity}
                  label="Requested locations"
                  disabled={reservation?.status !== 'pending'}
                />
              )}
            </div>

            <div className="scheduling-assistant-container">
              <SchedulingAssistant
                selectedRooms={assistantRooms}
                selectedDate={formData.startDate}
                eventStartTime={formData.startTime}
                eventEndTime={formData.endTime}
                eventTitle={formData.eventTitle}
                availability={availability}
                onRoomRemove={handleRemoveAssistantRoom}
                onEventTimeChange={handleEventTimeChange}
                currentReservationId={reservation?._id}
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
              disabled={reservation?.status !== 'pending'}
            />
          </div>
        </section>

        {/* Admin Notes */}
        {reservation?.status === 'pending' && (
          <section className="form-section">
            <h2>Admin Notes / Rejection Reason</h2>
            <div className="form-group full-width">
              <label htmlFor="actionNotes">Notes</label>
              <textarea
                id="actionNotes"
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                rows="4"
                placeholder="Add any notes or provide a reason for rejection..."
              />
            </div>
          </section>
        )}
      </form>
    </div>
  );
}
