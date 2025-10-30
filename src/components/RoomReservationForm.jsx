// src/components/RoomReservationForm.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMsal } from '@azure/msal-react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import RoomReservationFormBase from './RoomReservationFormBase';
import './RoomReservationForm.css';

/**
 * RoomReservationForm - Creation mode for new room reservation requests
 * Thin wrapper around RoomReservationFormBase that handles:
 * - MSAL auto-fill for authenticated users
 * - Public token-based access
 * - POST submission to create new reservations
 * - Success screen rendering
 */
export default function RoomReservationForm({ apiToken, isPublic }) {
  const { token } = useParams();
  const navigate = useNavigate();
  const { accounts } = useMsal();

  // Creation-specific state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [hasAutoFilled, setHasAutoFilled] = useState(false);
  const [initialData, setInitialData] = useState({});

  // Refs to access base component's state
  const formDataRef = useRef(null);
  const timeErrorsRef = useRef(null);
  const validateRef = useRef(null);

  // Auto-fill user email if authenticated and not in public mode (only once)
  useEffect(() => {
    if (!isPublic && accounts.length > 0 && !hasAutoFilled) {
      const userEmail = accounts[0].username;
      const displayName = accounts[0].name || '';

      setInitialData({
        requesterEmail: userEmail,
        requesterName: displayName
      });

      setHasAutoFilled(true);
    }
  }, [isPublic, accounts, hasAutoFilled]);

  // Helper function to convert time difference to minutes
  const calculateTimeBufferMinutes = (eventTime, bufferTime) => {
    if (!eventTime || !bufferTime) return 0;

    const eventDate = new Date(`1970-01-01T${eventTime}:00`);
    const bufferDate = new Date(`1970-01-01T${bufferTime}:00`);

    const diffMs = Math.abs(eventDate.getTime() - bufferDate.getTime());
    return Math.floor(diffMs / (1000 * 60));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Get current form data from base component
    const formData = formDataRef.current ? formDataRef.current() : {};
    const timeErrors = timeErrorsRef.current ? timeErrorsRef.current() : [];
    const validateTimes = validateRef.current ? validateRef.current() : (() => true);

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

    } catch (err) {
      logger.error('Error submitting reservation:', err);
      setError(err.message || 'Failed to submit reservation request');
    } finally {
      setLoading(false);
    }
  };

  // Success screen
  if (success) {
    return (
      <div className="room-reservation-form">
        <div className="success-message">
          <h2>✅ Reservation Request Submitted!</h2>
          <p>Your space booking request has been submitted successfully.</p>
          <p>You will receive a confirmation email once it has been reviewed.</p>

          <div className="success-actions" style={{ marginTop: '30px' }}>
            <button
              type="button"
              className="submit-btn"
              onClick={() => {
                if (isPublic) {
                  window.location.href = '/';
                } else {
                  navigate('/');
                }
              }}
            >
              Return to Calendar
            </button>

            {!isPublic && (
              <button
                type="button"
                className="cancel-btn"
                onClick={() => {
                  setSuccess(false);
                  setInitialData({});
                  setHasAutoFilled(false);
                }}
              >
                Submit Another Request
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Get current form data for button validation
  const currentFormData = formDataRef.current ? formDataRef.current() : {};
  const currentTimeErrors = timeErrorsRef.current ? timeErrorsRef.current() : [];

  return (
    <div className="room-reservation-form" style={{
      display: 'flex',
      flexDirection: 'column',
      maxHeight: 'calc(100vh - 90px)',
      overflow: 'hidden'
    }}>
      {error && (
        <div className="error-message">
          ❌ {error}
        </div>
      )}

      {/* Sticky Action Bar at top */}
      <div className="review-action-bar">
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Space Booking Request</h2>

        <div className="review-actions">
          <button
            type="submit"
            form="space-booking-form"
            className="action-btn submit-btn"
            disabled={loading || currentFormData.requestedRooms?.length === 0 || currentTimeErrors.length > 0}
          >
            {loading ? 'Submitting...' : '✓ Submit Request'}
          </button>

          {!isPublic && (
            <button
              type="button"
              className="action-btn cancel-btn"
              onClick={() => navigate('/')}
              disabled={loading}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Scrollable form content */}
      <form id="space-booking-form" onSubmit={handleSubmit} style={{ flex: 1, overflow: 'auto', padding: '10px' }}>
        <RoomReservationFormBase
          initialData={initialData}
          onFormDataRef={(getter) => { formDataRef.current = getter; }}
          onTimeErrorsRef={(getter) => { timeErrorsRef.current = getter; }}
          onValidateRef={(getter) => { validateRef.current = getter; }}
          showAllTabs={true}
        />
      </form>
    </div>
  );
}
