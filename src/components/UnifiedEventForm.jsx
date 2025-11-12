// src/components/UnifiedEventForm.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMsal } from '@azure/msal-react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import UnifiedFormLayout from './UnifiedFormLayout';
import RoomReservationFormBase from './RoomReservationFormBase';
import ReservationAuditHistory from './ReservationAuditHistory';
import AttachmentsSection from './AttachmentsSection';
import './RoomReservationForm.css';

/**
 * UnifiedEventForm - UNIFIED FORM for reservations, events, and new bookings
 * Thin wrapper around RoomReservationFormBase that handles:
 * - Three modes: 'create', 'reservation', 'event'
 * - UnifiedFormLayout integration
 * - Mode-specific submission logic
 *
 * Supports three modes:
 * - 'create': New room reservation request (booking form)
 * - 'reservation': Room reservation review/editing (admin review modal)
 * - 'event': Calendar event editing (calendar click)
 */
export default function UnifiedEventForm({
  mode = 'reservation',
  // Common props
  apiToken,
  onCancel,
  // Create mode props
  isPublic = false,
  token,
  // Reservation-specific props
  reservation,
  onApprove,
  onReject,
  onSave,
  onHasChangesChange,
  onIsSavingChange,
  onSaveFunctionReady,
  onLockedEventClick,
  // Event-specific props
  event,
  categories,
  availableLocations,
  schemaExtensions,
  onDelete,
  readOnly,
  userTimeZone,
  savingEvent,
  // UI customization
  headerContent
}) {
  // Mode-specific state
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [hasAutoFilled, setHasAutoFilled] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [originalChangeKey, setOriginalChangeKey] = useState(null);
  const [auditRefreshTrigger, setAuditRefreshTrigger] = useState(0);
  const [activeHistoryTab, setActiveHistoryTab] = useState('attachments');
  const [initialData, setInitialData] = useState({});

  // Refs to access base component's state
  const formDataRef = useRef(null);
  const timeErrorsRef = useRef(null);
  const validateRef = useRef(null);

  const navigate = useNavigate();
  const { accounts } = useMsal();

  // Auto-fill user email/name in create mode (authenticated users only)
  useEffect(() => {
    if (mode === 'create' && !isPublic && accounts.length > 0 && !hasAutoFilled) {
      const userEmail = accounts[0].username;
      const displayName = accounts[0].name || '';

      setInitialData({
        requesterEmail: userEmail,
        requesterName: displayName
      });

      setHasAutoFilled(true);
      logger.debug('Auto-filled user info for authenticated user:', { userEmail, displayName });
    }
  }, [mode, isPublic, accounts, hasAutoFilled]);

  // Notify parent when hasChanges or isSaving changes
  useEffect(() => {
    if (onHasChangesChange) {
      onHasChangesChange(hasChanges);
    }
  }, [hasChanges, onHasChangesChange]);

  useEffect(() => {
    if (onIsSavingChange) {
      onIsSavingChange(isSaving);
    }
  }, [isSaving, onIsSavingChange]);

  // Initialize form data from reservation or event based on mode
  useEffect(() => {
    if (mode === 'reservation' && reservation) {
      console.log('📋 Initializing form data from reservation:', {
        id: reservation._id,
        startDateTime: reservation.startDateTime,
        endDateTime: reservation.endDateTime
      });

      const startDateTime = new Date(reservation.startDateTime);
      const endDateTime = new Date(reservation.endDateTime);

      if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
        console.error('❌ Invalid date values in reservation');
        return;
      }

      setInitialData({
        requesterName: reservation.roomReservationData?.requestedBy?.name || reservation.requesterName || '',
        requesterEmail: reservation.roomReservationData?.requestedBy?.email || reservation.requesterEmail || '',
        department: reservation.roomReservationData?.requestedBy?.department || reservation.department || '',
        phone: reservation.roomReservationData?.requestedBy?.phone || reservation.phone || '',
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
        setupTimeMinutes: reservation.setupTimeMinutes || 0,
        teardownTimeMinutes: reservation.teardownTimeMinutes || 0,
        contactEmail: reservation.roomReservationData?.contactPerson?.email || reservation.contactEmail || '',
        contactName: reservation.roomReservationData?.contactPerson?.name || reservation.contactName || '',
        isOnBehalfOf: reservation.roomReservationData?.contactPerson?.isOnBehalfOf || reservation.isOnBehalfOf || false,
        reviewNotes: reservation.roomReservationData?.reviewNotes || reservation.reviewNotes || '',
        isAllDayEvent: reservation.isAllDayEvent || false
      });

      setOriginalChangeKey(reservation.changeKey);
    } else if (mode === 'event' && event) {
      console.log('📋 Initializing form data from event:', {
        id: event.id,
        subject: event.subject
      });

      const startDateTime = event.start?.dateTime ? new Date(event.start.dateTime) : new Date();
      const endDateTime = event.end?.dateTime ? new Date(event.end.dateTime) : new Date();
      const locationString = typeof event.location === 'object'
        ? event.location?.displayName || ''
        : event.location || '';

      setInitialData({
        eventTitle: event.subject || '',
        eventDescription: event.body?.content || event.bodyPreview || '',
        startDate: startDateTime.toISOString().split('T')[0],
        startTime: startDateTime.toTimeString().slice(0, 5),
        endDate: endDateTime.toISOString().split('T')[0],
        endTime: endDateTime.toTimeString().slice(0, 5),
        requestedRooms: locationString ? locationString.split('; ').filter(Boolean) : [],
        attendeeCount: event.attendees?.length || '',
        setupTimeMinutes: event.internalEnrichment?.setupTimeMinutes || 0,
        teardownTimeMinutes: event.internalEnrichment?.teardownTimeMinutes || 0,
        setupTime: event.internalEnrichment?.setupTime || '',
        teardownTime: event.internalEnrichment?.teardownTime || '',
        doorOpenTime: event.internalEnrichment?.doorOpenTime || '',
        doorCloseTime: event.internalEnrichment?.doorCloseTime || '',
        setupNotes: event.internalEnrichment?.setupNotes || '',
        eventNotes: event.internalEnrichment?.notes || '',
        isAllDayEvent: event.isAllDay || false
      });

      setOriginalChangeKey(event.changeKey);
    }
  }, [mode, reservation, event]);

  // Handle new booking submission (create mode)
  const handleSubmit = useCallback(async (e) => {
    if (e) e.preventDefault();

    const formData = formDataRef.current ? formDataRef.current() : {};
    const validateTimes = validateRef.current ? validateRef.current() : (() => true);

    if (!validateTimes()) {
      setSubmitError('Please fix the time validation errors before submitting');
      return;
    }

    setSubmitting(true);
    setSubmitError('');

    try {
      const startDateTime = `${formData.startDate}T${formData.startTime}`;
      const endDateTime = `${formData.endDate}T${formData.endTime}`;

      const payload = {
        ...formData,
        startDateTime,
        endDateTime,
        attendeeCount: parseInt(formData.attendeeCount) || 0
      };

      delete payload.startDate;
      delete payload.startTime;
      delete payload.endDate;
      delete payload.endTime;
      delete payload.reviewNotes;

      const endpoint = isPublic
        ? `${APP_CONFIG.API_BASE_URL}/room-reservations/public/${token}`
        : `${APP_CONFIG.API_BASE_URL}/events/request`;

      logger.debug('Submitting room reservation request:', { endpoint, isPublic });

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
      logger.log('Room reservation submitted successfully:', result);

      setSuccess(true);

    } catch (err) {
      logger.error('Error submitting reservation:', err);
      setSubmitError(err.message || 'Failed to submit reservation request');
    } finally {
      setSubmitting(false);
    }
  }, [formDataRef, validateRef, isPublic, token, apiToken]);

  // Save changes (reservation mode)
  const handleSaveChanges = useCallback(async () => {
    console.log('💾 Save button clicked');

    const formData = formDataRef.current ? formDataRef.current() : {};
    const validateTimes = validateRef.current ? validateRef.current() : (() => true);

    if (!validateTimes()) {
      alert('Cannot save: Please fix time validation errors');
      return;
    }

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

      delete updatedData.startDate;
      delete updatedData.startTime;
      delete updatedData.endDate;
      delete updatedData.endTime;

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${reservation._id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`,
            'If-Match': originalChangeKey || ''
          },
          body: JSON.stringify(updatedData)
        }
      );

      if (response.status === 409) {
        const data = await response.json();
        alert(`This reservation was modified by ${data.lastModifiedBy} while you were editing. Please refresh.`);
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to save changes: ${response.status}`);
      }

      const result = await response.json();
      console.log('✅ Save successful:', result);

      setOriginalChangeKey(result.changeKey);
      setHasChanges(false);
      setAuditRefreshTrigger(prev => prev + 1);

      if (onSave) {
        onSave(result);
      }

    } catch (error) {
      console.error('❌ Save error:', error);
      alert(`Failed to save changes: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  }, [formDataRef, validateRef, reservation, apiToken, originalChangeKey, onSave]);

  // Expose save function to parent
  useEffect(() => {
    if (onSaveFunctionReady) {
      onSaveFunctionReady(handleSaveChanges);
    }
  }, [onSaveFunctionReady, handleSaveChanges]);

  // Approve handler
  const handleApprove = () => {
    const formData = formDataRef.current ? formDataRef.current() : {};
    const validateTimes = validateRef.current ? validateRef.current() : (() => true);

    if (!validateTimes()) {
      logger.warn('Cannot approve - time validation errors exist');
      return;
    }

    if (onApprove) {
      const startDateTime = `${formData.startDate}T${formData.startTime}`;
      const endDateTime = `${formData.endDate}T${formData.endTime}`;

      const updatedData = {
        ...formData,
        startDateTime,
        endDateTime,
        attendeeCount: parseInt(formData.attendeeCount) || 0,
        changeKey: originalChangeKey
      };

      delete updatedData.startDate;
      delete updatedData.startTime;
      delete updatedData.endDate;
      delete updatedData.endTime;

      onApprove(updatedData, formData.reviewNotes, originalChangeKey);
    }
  };

  // Reject handler
  const handleReject = () => {
    const formData = formDataRef.current ? formDataRef.current() : {};
    if (onReject) {
      onReject(formData.reviewNotes);
    }
  };

  // Event save handler
  const handleEventSave = () => {
    const formData = formDataRef.current ? formDataRef.current() : {};

    if (onSave) {
      const eventData = {
        id: event?.id,
        subject: formData.eventTitle,
        body: { content: formData.eventDescription, contentType: 'Text' },
        start: {
          dateTime: `${formData.startDate}T${formData.startTime}`,
          timeZone: userTimeZone || 'America/New_York'
        },
        end: {
          dateTime: `${formData.endDate}T${formData.endTime}`,
          timeZone: userTimeZone || 'America/New_York'
        },
        location: {
          displayName: formData.requestedRooms.join('; ')
        },
        internalEnrichment: {
          setupTimeMinutes: formData.setupTimeMinutes,
          teardownTimeMinutes: formData.teardownTimeMinutes,
          setupTime: formData.setupTime,
          teardownTime: formData.teardownTime,
          doorOpenTime: formData.doorOpenTime,
          doorCloseTime: formData.doorCloseTime,
          setupNotes: formData.setupNotes,
          notes: formData.eventNotes
        }
      };
      onSave(eventData);
    }
  };

  // Configure actions based on mode
  const currentFormData = formDataRef.current ? formDataRef.current() : {};
  const currentTimeErrors = timeErrorsRef.current ? timeErrorsRef.current() : [];

  const actions = mode === 'create' ? [
    {
      label: 'Submit Request',
      onClick: handleSubmit,
      className: 'submit-btn',
      icon: '✓',
      disabled: submitting || currentFormData.requestedRooms?.length === 0 || currentTimeErrors.length > 0
    },
    {
      label: 'Cancel',
      onClick: onCancel || (() => navigate('/')),
      className: 'cancel-btn',
      disabled: submitting
    }
  ] : mode === 'reservation' ? [
    {
      label: 'Approve',
      onClick: handleApprove,
      className: 'approve-btn',
      icon: '✓',
      disabled: isSaving || currentTimeErrors.length > 0 || reservation?.status !== 'pending'
    },
    {
      label: 'Reject',
      onClick: handleReject,
      className: 'reject-btn',
      icon: '✗',
      disabled: isSaving || reservation?.status !== 'pending'
    },
    {
      label: 'Save',
      onClick: handleSaveChanges,
      className: 'save-btn',
      icon: '💾',
      disabled: !hasChanges || isSaving
    },
    {
      label: 'Cancel',
      onClick: onCancel,
      className: 'cancel-btn',
      disabled: isSaving
    }
  ] : [
    {
      label: 'Save',
      onClick: handleEventSave,
      className: 'save-btn',
      icon: '💾',
      disabled: savingEvent || readOnly
    },
    {
      label: 'Delete',
      onClick: onDelete,
      className: 'reject-btn',
      icon: '🗑',
      hidden: !onDelete || readOnly
    },
    {
      label: 'Cancel',
      onClick: onCancel,
      className: 'cancel-btn',
      disabled: savingEvent
    }
  ];

  // Determine title based on mode
  const formTitle = mode === 'create'
    ? 'Space Booking Request'
    : mode === 'reservation'
      ? (currentFormData.eventTitle
          ? `"${currentFormData.eventTitle}" Details`
          : (reservation?.status === 'pending' ? 'Review Reservation Request' : 'View Reservation Details'))
      : (readOnly ? 'View Event' : 'Edit Event');

  // Success screen for create mode
  if (mode === 'create' && success) {
    return (
      <div className="room-reservation-form">
        <div className="success-message">
          <h2>✅ Reservation Request Submitted!</h2>
          <p>Your space booking request has been submitted successfully.</p>
          <p>You will receive a confirmation email once it has been reviewed.</p>

          <div className="form-actions" style={{ marginTop: '30px' }}>
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

  return (
    <UnifiedFormLayout
      title={formTitle}
      actions={actions}
      hasChanges={hasChanges}
      errors={{}}
      headerContent={headerContent}
    >
      {submitError && (
        <div className="error-message" style={{ margin: '10px' }}>
          ❌ {submitError}
        </div>
      )}

      <RoomReservationFormBase
        initialData={initialData}
        onDataChange={(updatedData) => {
          setHasChanges(true);
        }}
        onHasChangesChange={setHasChanges}
        readOnly={mode === 'event' ? readOnly : false}
        isAdmin={true}
        reservationStatus={mode === 'reservation' ? reservation?.status : null}
        currentReservationId={mode === 'reservation' ? reservation?._id : null}
        onLockedEventClick={onLockedEventClick}
        showAllTabs={true}
        onFormDataRef={(getter) => { formDataRef.current = getter; }}
        onTimeErrorsRef={(getter) => { timeErrorsRef.current = getter; }}
        onValidateRef={(getter) => { validateRef.current = getter; }}
        renderAdditionalContent={() => (
          <>
            {/* Attachments & History Tabs - only in reservation mode */}
            {mode === 'reservation' && reservation && apiToken && (
              <div style={{ marginTop: '20px' }}>
                <section className="form-section">
                  <div className="history-tabs-container">
                    <div className="history-tabs">
                      <div
                        className={`history-tab ${activeHistoryTab === 'attachments' ? 'active' : ''}`}
                        onClick={() => setActiveHistoryTab('attachments')}
                      >
                        📎 Attachments
                      </div>
                      <div
                        className={`history-tab ${activeHistoryTab === 'history' ? 'active' : ''}`}
                        onClick={() => setActiveHistoryTab('history')}
                      >
                        📝 History
                      </div>
                    </div>
                  </div>

                  <div className="history-tab-content">
                    {activeHistoryTab === 'attachments' ? (
                      <AttachmentsSection
                        resourceId={reservation?.eventId}
                        resourceType="event"
                        apiToken={apiToken}
                        readOnly={reservation?.status === 'inactive'}
                      />
                    ) : (
                      <ReservationAuditHistory
                        reservationId={reservation?._id}
                        apiToken={apiToken}
                        refreshTrigger={auditRefreshTrigger}
                      />
                    )}
                  </div>
                </section>
              </div>
            )}
          </>
        )}
      />
    </UnifiedFormLayout>
  );
}
