// src/components/EditRequestForm.jsx
import React, { useState, useEffect } from 'react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import LocationListSelect from './LocationListSelect';
import CategorySelectorModal from './CategorySelectorModal';
import ServicesSelectorModal from './ServicesSelectorModal';
import './EditRequestForm.css';

/**
 * EditRequestForm - Form for requesting edits to approved events
 * Pre-populated with original event data, user can modify fields and provide a change reason
 */
export default function EditRequestForm({
  reservation,
  event, // Alternative prop name for the same data
  apiToken,
  onClose,
  onSuccess
}) {
  // Support both 'event' and 'reservation' prop names for flexibility
  const eventData = event || reservation;
  // Room context for location data
  const { rooms, getRoomDetails } = useRooms();

  // Form state (initialized from reservation)
  const [formData, setFormData] = useState({
    eventTitle: '',
    eventDescription: '',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    attendeeCount: '',
    requestedRooms: [],
    specialRequirements: '',
    setupTime: '',
    teardownTime: '',
    doorOpenTime: '',
    doorCloseTime: '',
    setupNotes: '',
    doorNotes: '',
    eventNotes: '',
    isOffsite: false,
    offsiteName: '',
    offsiteAddress: '',
    categories: [],
    services: {}
  });

  // Change reason (required)
  const [changeReason, setChangeReason] = useState('');

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showServicesModal, setShowServicesModal] = useState(false);

  // Initialize form data from event
  useEffect(() => {
    if (eventData) {
      // Parse date/time from ISO string or use existing components
      let startDate = '';
      let startTime = '';
      let endDate = '';
      let endTime = '';

      // Handle different data formats (calendar events vs. stored events)
      const startDateTime = eventData.startDateTime || eventData.start?.dateTime;
      const endDateTime = eventData.endDateTime || eventData.end?.dateTime;

      if (startDateTime) {
        const startParts = startDateTime.replace('Z', '').split('T');
        startDate = startParts[0] || '';
        startTime = startParts[1]?.substring(0, 5) || '';
      } else if (eventData.startDate && eventData.startTime) {
        startDate = eventData.startDate;
        startTime = eventData.startTime;
      }

      if (endDateTime) {
        const endParts = endDateTime.replace('Z', '').split('T');
        endDate = endParts[0] || '';
        endTime = endParts[1]?.substring(0, 5) || '';
      } else if (eventData.endDate && eventData.endTime) {
        endDate = eventData.endDate;
        endTime = eventData.endTime;
      }

      setFormData({
        eventTitle: eventData.eventTitle || eventData.subject || eventData.graphData?.subject || '',
        eventDescription: eventData.eventDescription || eventData.body?.content || eventData.graphData?.bodyPreview || '',
        startDate,
        startTime,
        endDate,
        endTime,
        attendeeCount: eventData.attendeeCount?.toString() || '',
        requestedRooms: eventData.requestedRooms || eventData.locations?.map(l => l.toString()) || [],
        specialRequirements: eventData.specialRequirements || '',
        setupTime: eventData.setupTime || '',
        teardownTime: eventData.teardownTime || '',
        doorOpenTime: eventData.doorOpenTime || '',
        doorCloseTime: eventData.doorCloseTime || '',
        setupNotes: eventData.setupNotes || '',
        doorNotes: eventData.doorNotes || '',
        eventNotes: eventData.eventNotes || '',
        isOffsite: eventData.isOffsite || false,
        offsiteName: eventData.offsiteName || '',
        offsiteAddress: eventData.offsiteAddress || '',
        categories: eventData.categories || eventData.mecCategories || [],
        services: eventData.services || {}
      });
    }
  }, [eventData]);

  // Handle form field changes
  const handleFieldChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  // Handle room selection
  const handleRoomChange = (selectedRooms) => {
    logger.debug('EditRequestForm: Room selection changed', { selectedRooms });
    setFormData(prev => ({
      ...prev,
      requestedRooms: selectedRooms
    }));
  };

  // Handle category selection
  const handleCategoryChange = (categories) => {
    setFormData(prev => ({
      ...prev,
      categories
    }));
    setShowCategoryModal(false);
  };

  // Handle services selection
  const handleServicesChange = (services) => {
    setFormData(prev => ({
      ...prev,
      services
    }));
    setShowServicesModal(false);
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

  // Submit edit request
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validate change reason
    if (!changeReason.trim()) {
      setError('Please provide a reason for the changes');
      return;
    }

    // Validate required fields
    if (!formData.eventTitle.trim()) {
      setError('Event title is required');
      return;
    }

    if (!formData.startDate || !formData.startTime) {
      setError('Start date and time are required');
      return;
    }

    if (!formData.endDate || !formData.endTime) {
      setError('End date and time are required');
      return;
    }

    // Build datetime strings
    const startDateTime = `${formData.startDate}T${formData.startTime}:00`;
    const endDateTime = `${formData.endDate}T${formData.endTime}:00`;

    try {
      setSubmitting(true);

      // Prepare request body
      const requestBody = {
        eventTitle: formData.eventTitle,
        eventDescription: formData.eventDescription,
        startDateTime,
        endDateTime,
        attendeeCount: parseInt(formData.attendeeCount) || 0,
        requestedRooms: formData.requestedRooms,
        specialRequirements: formData.specialRequirements,
        setupTime: formData.setupTime,
        teardownTime: formData.teardownTime,
        doorOpenTime: formData.doorOpenTime,
        doorCloseTime: formData.doorCloseTime,
        setupNotes: formData.setupNotes,
        doorNotes: formData.doorNotes,
        eventNotes: formData.eventNotes,
        isOffsite: formData.isOffsite,
        offsiteName: formData.offsiteName,
        offsiteAddress: formData.offsiteAddress,
        categories: formData.categories,
        services: formData.services,
        changeReason: changeReason.trim()
      };

      logger.debug('EditRequestForm: Submitting edit request', {
        requestedRooms: requestBody.requestedRooms,
        formDataRooms: formData.requestedRooms
      });

      // Use _id or eventId for the request
      const eventId = eventData._id || eventData.eventId;
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/${eventId}/request-edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit edit request');
      }

      const result = await response.json();
      logger.info('Edit request submitted successfully:', result);

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
      }, 1500);

    } catch (err) {
      logger.error('Error submitting edit request:', err);
      setError(err.message || 'Failed to submit edit request');
    } finally {
      setSubmitting(false);
    }
  };

  // Format selected categories for display
  const formatCategories = () => {
    if (!formData.categories || formData.categories.length === 0) {
      return 'None selected';
    }
    return formData.categories.join(', ');
  };

  // Format selected services for display
  const formatServices = () => {
    if (!formData.services || Object.keys(formData.services).length === 0) {
      return 'None selected';
    }
    const selectedServices = Object.entries(formData.services)
      .filter(([_, value]) => value === true || (typeof value === 'object' && value.selected))
      .map(([key]) => key);
    return selectedServices.length > 0 ? selectedServices.join(', ') : 'None selected';
  };

  return (
    <div className="edit-request-overlay">
      <div className="edit-request-modal">
        <div className="edit-request-header">
          <h2>Request Edit</h2>
          <p className="edit-request-subtitle">
            Submit a request to modify your approved reservation. Changes will be reviewed by an administrator.
          </p>
          <button className="close-btn" onClick={onClose} type="button">&times;</button>
        </div>

        {success ? (
          <div className="success-message">
            <div className="success-icon">✓</div>
            <h3>Edit Request Submitted</h3>
            <p>Your edit request has been submitted and is pending review. You will be notified when it is approved or rejected.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="edit-request-form">
            {error && (
              <div className="error-banner">
                {error}
              </div>
            )}

            {/* Original Event Info */}
            <div className="original-event-info">
              <strong>Original Event:</strong> {eventData?.eventTitle || eventData?.subject || 'Untitled'}
              <span className="original-date">
                {(eventData?.startDateTime || eventData?.start?.dateTime)
                  ? new Date(eventData.startDateTime || eventData.start?.dateTime).toLocaleDateString()
                  : ''}
              </span>
            </div>

            {/* Change Reason (Required) */}
            <div className="form-section change-reason-section">
              <label htmlFor="changeReason" className="required-label">
                Reason for Changes *
              </label>
              <textarea
                id="changeReason"
                name="changeReason"
                value={changeReason}
                onChange={(e) => setChangeReason(e.target.value)}
                placeholder="Please explain why you need to make these changes..."
                rows={3}
                required
              />
            </div>

            {/* Event Details Section */}
            <div className="form-section">
              <h3>Event Details</h3>

              <div className="form-row">
                <label htmlFor="eventTitle">Event Title *</label>
                <input
                  type="text"
                  id="eventTitle"
                  name="eventTitle"
                  value={formData.eventTitle}
                  onChange={handleFieldChange}
                  required
                />
              </div>

              <div className="form-row">
                <label htmlFor="eventDescription">Description</label>
                <textarea
                  id="eventDescription"
                  name="eventDescription"
                  value={formData.eventDescription}
                  onChange={handleFieldChange}
                  rows={3}
                />
              </div>
            </div>

            {/* Date & Time Section */}
            <div className="form-section">
              <h3>Date & Time</h3>

              <div className="form-grid">
                <div className="form-row">
                  <label htmlFor="startDate">Start Date *</label>
                  <input
                    type="date"
                    id="startDate"
                    name="startDate"
                    value={formData.startDate}
                    onChange={handleFieldChange}
                    required
                  />
                </div>

                <div className="form-row">
                  <label htmlFor="startTime">Start Time *</label>
                  <input
                    type="time"
                    id="startTime"
                    name="startTime"
                    value={formData.startTime}
                    onChange={handleFieldChange}
                    required
                  />
                </div>

                <div className="form-row">
                  <label htmlFor="endDate">End Date *</label>
                  <input
                    type="date"
                    id="endDate"
                    name="endDate"
                    value={formData.endDate}
                    onChange={handleFieldChange}
                    required
                  />
                </div>

                <div className="form-row">
                  <label htmlFor="endTime">End Time *</label>
                  <input
                    type="time"
                    id="endTime"
                    name="endTime"
                    value={formData.endTime}
                    onChange={handleFieldChange}
                    required
                  />
                </div>
              </div>

              <div className="form-grid">
                <div className="form-row">
                  <label htmlFor="setupTime">Setup Time</label>
                  <input
                    type="time"
                    id="setupTime"
                    name="setupTime"
                    value={formData.setupTime}
                    onChange={handleFieldChange}
                  />
                </div>

                <div className="form-row">
                  <label htmlFor="teardownTime">Teardown Time</label>
                  <input
                    type="time"
                    id="teardownTime"
                    name="teardownTime"
                    value={formData.teardownTime}
                    onChange={handleFieldChange}
                  />
                </div>

                <div className="form-row">
                  <label htmlFor="doorOpenTime">Door Open Time</label>
                  <input
                    type="time"
                    id="doorOpenTime"
                    name="doorOpenTime"
                    value={formData.doorOpenTime}
                    onChange={handleFieldChange}
                  />
                </div>

                <div className="form-row">
                  <label htmlFor="doorCloseTime">Door Close Time</label>
                  <input
                    type="time"
                    id="doorCloseTime"
                    name="doorCloseTime"
                    value={formData.doorCloseTime}
                    onChange={handleFieldChange}
                  />
                </div>
              </div>
            </div>

            {/* Location Section */}
            <div className="form-section">
              <h3>Location</h3>

              <div className="form-row checkbox-row">
                <label>
                  <input
                    type="checkbox"
                    name="isOffsite"
                    checked={formData.isOffsite}
                    onChange={handleFieldChange}
                  />
                  This is an offsite event
                </label>
              </div>

              {formData.isOffsite ? (
                <>
                  <div className="form-row">
                    <label htmlFor="offsiteName">Venue Name *</label>
                    <input
                      type="text"
                      id="offsiteName"
                      name="offsiteName"
                      value={formData.offsiteName}
                      onChange={handleFieldChange}
                      required={formData.isOffsite}
                    />
                  </div>
                  <div className="form-row">
                    <label htmlFor="offsiteAddress">Address *</label>
                    <input
                      type="text"
                      id="offsiteAddress"
                      name="offsiteAddress"
                      value={formData.offsiteAddress}
                      onChange={handleFieldChange}
                      required={formData.isOffsite}
                    />
                  </div>
                </>
              ) : (
                <div className="form-row">
                  <label>Rooms</label>
                  <LocationListSelect
                    selectedRooms={formData.requestedRooms}
                    onRoomSelectionChange={handleRoomChange}
                    rooms={rooms}
                    checkRoomCapacity={checkRoomCapacity}
                  />
                </div>
              )}
            </div>

            {/* Additional Details Section */}
            <div className="form-section">
              <h3>Additional Details</h3>

              <div className="form-row">
                <label htmlFor="attendeeCount">Expected Attendees</label>
                <input
                  type="number"
                  id="attendeeCount"
                  name="attendeeCount"
                  value={formData.attendeeCount}
                  onChange={handleFieldChange}
                  min="0"
                />
              </div>

              <div className="form-row">
                <label htmlFor="specialRequirements">Special Requirements</label>
                <textarea
                  id="specialRequirements"
                  name="specialRequirements"
                  value={formData.specialRequirements}
                  onChange={handleFieldChange}
                  rows={2}
                />
              </div>

              {/* Categories */}
              <div className="form-row">
                <label>Categories</label>
                <div className="selector-trigger" onClick={() => setShowCategoryModal(true)}>
                  {formatCategories()}
                  <span className="edit-link">Edit</span>
                </div>
              </div>

              {/* Services */}
              <div className="form-row">
                <label>Services</label>
                <div className="selector-trigger" onClick={() => setShowServicesModal(true)}>
                  {formatServices()}
                  <span className="edit-link">Edit</span>
                </div>
              </div>
            </div>

            {/* Notes Section */}
            <div className="form-section">
              <h3>Notes</h3>

              <div className="form-row">
                <label htmlFor="setupNotes">Setup Notes</label>
                <textarea
                  id="setupNotes"
                  name="setupNotes"
                  value={formData.setupNotes}
                  onChange={handleFieldChange}
                  rows={2}
                />
              </div>

              <div className="form-row">
                <label htmlFor="doorNotes">Door Notes</label>
                <textarea
                  id="doorNotes"
                  name="doorNotes"
                  value={formData.doorNotes}
                  onChange={handleFieldChange}
                  rows={2}
                />
              </div>

              <div className="form-row">
                <label htmlFor="eventNotes">Event Notes</label>
                <textarea
                  id="eventNotes"
                  name="eventNotes"
                  value={formData.eventNotes}
                  onChange={handleFieldChange}
                  rows={2}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="form-actions">
              <button
                type="button"
                className="cancel-btn"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="submit-btn"
                disabled={submitting || !changeReason.trim()}
              >
                {submitting ? 'Submitting...' : 'Submit Edit Request'}
              </button>
            </div>
          </form>
        )}

        {/* Category Selector Modal */}
        {showCategoryModal && (
          <CategorySelectorModal
            isOpen={showCategoryModal}
            onClose={() => setShowCategoryModal(false)}
            selectedCategories={formData.categories}
            onSave={handleCategoryChange}
          />
        )}

        {/* Services Selector Modal */}
        {showServicesModal && (
          <ServicesSelectorModal
            isOpen={showServicesModal}
            onClose={() => setShowServicesModal(false)}
            selectedServices={formData.services}
            onSave={handleServicesChange}
          />
        )}
      </div>
    </div>
  );
}
