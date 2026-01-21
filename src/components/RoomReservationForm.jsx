// src/components/RoomReservationForm.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useMsal } from '@azure/msal-react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import RoomReservationFormBase from './RoomReservationFormBase';
import DraftSaveDialog from './shared/DraftSaveDialog';
import './RoomReservationForm.css';

/**
 * RoomReservationForm - Creation mode for new room reservation requests
 * Thin wrapper around RoomReservationFormBase that handles:
 * - MSAL auto-fill for authenticated users
 * - Public token-based access
 * - POST submission to create new reservations
 * - Draft save/edit/submit functionality
 * - Success screen rendering
 */
export default function RoomReservationForm({ apiToken, isPublic }) {
  const { token } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { accounts } = useMsal();

  // Check if we're editing an existing draft
  const editingDraft = location.state?.draft || null;
  const initialDraftId = editingDraft?._id || null;

  // Creation-specific state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [hasAutoFilled, setHasAutoFilled] = useState(false);
  const [initialData, setInitialData] = useState({});

  // Draft-specific state
  const [draftId, setDraftId] = useState(initialDraftId);
  const [hasChanges, setHasChanges] = useState(false);
  const [showDraftDialog, setShowDraftDialog] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);

  // Refs to access base component's state
  const formDataRef = useRef(null);
  const timeErrorsRef = useRef(null);
  const validateRef = useRef(null);

  // Auto-fill user email if authenticated and not in public mode (only once)
  // Also handle loading existing draft data
  useEffect(() => {
    if (!isPublic && accounts.length > 0 && !hasAutoFilled) {
      const userEmail = accounts[0].username;
      const displayName = accounts[0].name || '';

      // If editing a draft, populate form with draft data
      if (editingDraft) {
        setInitialData({
          requesterEmail: userEmail,
          requesterName: displayName,
          eventTitle: editingDraft.eventTitle || '',
          eventDescription: editingDraft.eventDescription || '',
          startDate: editingDraft.startDateTime ? new Date(editingDraft.startDateTime).toISOString().split('T')[0] : '',
          endDate: editingDraft.endDateTime ? new Date(editingDraft.endDateTime).toISOString().split('T')[0] : '',
          startTime: editingDraft.startDateTime ? new Date(editingDraft.startDateTime).toTimeString().slice(0, 5) : '',
          endTime: editingDraft.endDateTime ? new Date(editingDraft.endDateTime).toTimeString().slice(0, 5) : '',
          requestedRooms: editingDraft.requestedRooms || editingDraft.locations || [],
          attendeeCount: editingDraft.attendeeCount || '',
          setupTime: editingDraft.setupTime || '',
          teardownTime: editingDraft.teardownTime || '',
          doorOpenTime: editingDraft.doorOpenTime || '',
          doorCloseTime: editingDraft.doorCloseTime || '',
          categories: editingDraft.categories || editingDraft.mecCategories || [],  // categories is the correct field, mecCategories is deprecated
          services: editingDraft.services || {},
          specialRequirements: editingDraft.specialRequirements || '',
          virtualMeetingUrl: editingDraft.virtualMeetingUrl || '',
          isOffsite: editingDraft.isOffsite || false,
          offsiteName: editingDraft.offsiteName || '',
          offsiteAddress: editingDraft.offsiteAddress || '',
          offsiteLat: editingDraft.offsiteLat || null,
          offsiteLon: editingDraft.offsiteLon || null,
          department: editingDraft.roomReservationData?.department || '',
          phone: editingDraft.roomReservationData?.phone || ''
        });
      } else {
        setInitialData({
          requesterEmail: userEmail,
          requesterName: displayName
        });
      }

      setHasAutoFilled(true);
    }
  }, [isPublic, accounts, hasAutoFilled, editingDraft]);

  // Track changes in the form
  const handleFormDataChange = useCallback((updatedData) => {
    setHasChanges(true);
    setDraftSaved(false);
  }, []);

  // Warn user before leaving page with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasChanges && !draftSaved && !success) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasChanges, draftSaved, success]);

  // Helper function to convert time difference to minutes
  const calculateTimeBufferMinutes = (eventTime, bufferTime) => {
    if (!eventTime || !bufferTime) return 0;

    const eventDate = new Date(`1970-01-01T${eventTime}:00`);
    const bufferDate = new Date(`1970-01-01T${bufferTime}:00`);

    const diffMs = Math.abs(eventDate.getTime() - bufferDate.getTime());
    return Math.floor(diffMs / (1000 * 60));
  };

  // Build draft payload from form data
  const buildDraftPayload = (formData) => {
    // Combine date and time if both exist
    const startDateTime = formData.startDate && formData.startTime
      ? `${formData.startDate}T${formData.startTime}`
      : null;
    const endDateTime = formData.endDate && formData.endTime
      ? `${formData.endDate}T${formData.endTime}`
      : null;

    let setupTimeMinutes = formData.setupTimeMinutes || 0;
    let teardownTimeMinutes = formData.teardownTimeMinutes || 0;

    if (formData.setupTime && formData.startTime) {
      setupTimeMinutes = calculateTimeBufferMinutes(formData.startTime, formData.setupTime);
    }
    if (formData.teardownTime && formData.endTime) {
      teardownTimeMinutes = calculateTimeBufferMinutes(formData.endTime, formData.teardownTime);
    }

    return {
      eventTitle: formData.eventTitle,
      eventDescription: formData.eventDescription,
      startDateTime,
      endDateTime,
      attendeeCount: parseInt(formData.attendeeCount) || 0,
      requestedRooms: formData.requestedRooms || [],
      requiredFeatures: formData.requiredFeatures || [],
      specialRequirements: formData.specialRequirements || '',
      department: formData.department || '',
      phone: formData.phone || '',
      setupTimeMinutes,
      teardownTimeMinutes,
      setupTime: formData.setupTime || null,
      teardownTime: formData.teardownTime || null,
      doorOpenTime: formData.doorOpenTime || null,
      doorCloseTime: formData.doorCloseTime || null,
      setupNotes: formData.setupNotes || '',
      doorNotes: formData.doorNotes || '',
      eventNotes: formData.eventNotes || '',
      isOnBehalfOf: formData.isOnBehalfOf || false,
      contactName: formData.contactName || '',
      contactEmail: formData.contactEmail || '',
      mecCategories: formData.categories || formData.mecCategories || [],  // Read from 'categories' (mecCategories is deprecated)
      services: formData.services || {},
      recurrence: formData.recurrence || null,
      virtualMeetingUrl: formData.virtualMeetingUrl || null,
      isOffsite: formData.isOffsite || false,
      offsiteName: formData.offsiteName || '',
      offsiteAddress: formData.offsiteAddress || '',
      offsiteLat: formData.offsiteLat || null,
      offsiteLon: formData.offsiteLon || null
    };
  };

  // Save as draft
  const handleSaveDraft = async () => {
    const formData = formDataRef.current ? formDataRef.current() : {};

    // Minimal validation - only eventTitle required
    if (!formData.eventTitle?.trim()) {
      setError('Event title is required to save as draft');
      return;
    }

    setSavingDraft(true);
    setError('');

    try {
      const payload = buildDraftPayload(formData);

      const endpoint = draftId
        ? `${APP_CONFIG.API_BASE_URL}/room-reservations/draft/${draftId}`
        : `${APP_CONFIG.API_BASE_URL}/room-reservations/draft`;

      const method = draftId ? 'PUT' : 'POST';

      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save draft');
      }

      const result = await response.json();
      logger.log('Draft saved:', result);

      // Update draft ID if this was a new draft
      if (!draftId) {
        setDraftId(result._id);
      }

      setDraftSaved(true);
      setHasChanges(false);

    } catch (err) {
      logger.error('Error saving draft:', err);
      setError(err.message || 'Failed to save draft');
    } finally {
      setSavingDraft(false);
      setShowDraftDialog(false);
    }
  };

  // Submit draft for approval (when editing existing draft)
  const handleSubmitDraft = async () => {
    if (!draftId) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/room-reservations/draft/${draftId}/submit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          }
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        if (errorData.validationErrors) {
          throw new Error(`Incomplete draft: ${errorData.validationErrors.join(', ')}`);
        }
        if (errorData.conflicts) {
          throw new Error('Scheduling conflict detected. Please adjust your times.');
        }
        throw new Error(errorData.error || 'Failed to submit draft');
      }

      const result = await response.json();
      logger.log('Draft submitted:', result);

      setSuccess(true);
      setHasChanges(false);

    } catch (err) {
      logger.error('Error submitting draft:', err);
      setError(err.message || 'Failed to submit draft');
    } finally {
      setLoading(false);
    }
  };

  // Handle close/cancel with unsaved changes
  const handleClose = () => {
    if (hasChanges && !draftSaved) {
      setShowDraftDialog(true);
    } else {
      navigate('/');
    }
  };

  // Handle discard from draft dialog
  const handleDiscard = () => {
    setShowDraftDialog(false);
    setHasChanges(false);
    navigate('/');
  };

  // Can save draft if eventTitle exists
  const canSaveDraft = () => {
    const formData = formDataRef.current ? formDataRef.current() : {};
    return !!formData.eventTitle?.trim();
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
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
          {draftId ? 'Edit Draft' : 'Space Booking Request'}
          {draftSaved && <span style={{ color: '#22c55e', fontSize: '0.875rem', marginLeft: '12px' }}>✓ Draft saved</span>}
        </h2>

        <div className="review-actions">
          {/* Save as Draft button - only for authenticated users, not public */}
          {!isPublic && (
            <button
              type="button"
              className="action-btn draft-btn"
              onClick={handleSaveDraft}
              disabled={loading || savingDraft || !currentFormData.eventTitle?.trim()}
              title={!currentFormData.eventTitle?.trim() ? 'Event title is required to save as draft' : 'Save your progress as a draft'}
            >
              {savingDraft ? 'Saving...' : '📝 Save Draft'}
            </button>
          )}

          {/* Submit button - shows "Submit Draft" if editing a draft */}
          {draftId ? (
            <button
              type="button"
              className="action-btn submit-btn"
              onClick={handleSubmitDraft}
              disabled={loading || savingDraft || currentFormData.requestedRooms?.length === 0 || currentTimeErrors.length > 0}
            >
              {loading ? 'Submitting...' : '✓ Submit for Approval'}
            </button>
          ) : (
            <button
              type="submit"
              form="space-booking-form"
              className="action-btn submit-btn"
              disabled={loading || savingDraft || currentFormData.requestedRooms?.length === 0 || currentTimeErrors.length > 0}
            >
              {loading ? 'Submitting...' : '✓ Submit Request'}
            </button>
          )}

          {!isPublic && (
            <button
              type="button"
              className="action-btn cancel-btn"
              onClick={handleClose}
              disabled={loading || savingDraft}
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
          onDataChange={handleFormDataChange}
          showAllTabs={true}
        />
      </form>

      {/* Draft Save Dialog */}
      <DraftSaveDialog
        isOpen={showDraftDialog}
        onSaveDraft={handleSaveDraft}
        onDiscard={handleDiscard}
        onCancel={() => setShowDraftDialog(false)}
        canSaveDraft={canSaveDraft()}
        saving={savingDraft}
      />
    </div>
  );
}
