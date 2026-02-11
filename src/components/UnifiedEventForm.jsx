// src/components/UnifiedEventForm.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMsal } from '@azure/msal-react';
import { logger } from '../utils/logger';
import { useNotification } from '../context/NotificationContext';
import { usePermissions } from '../hooks/usePermissions';
import APP_CONFIG from '../config/config';
import { transformEventToFlatStructure } from '../utils/eventTransformers';
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
  onSuccess,
  // Create mode props
  isPublic = false,
  token,
  prefillData = null,
  // Reservation-specific props
  reservation,
  onApprove,
  onReject,
  onSave,
  onHasChangesChange,
  onIsSavingChange,
  onSaveFunctionReady,
  onFormValidChange,
  onLockedEventClick,
  onDataChange, // Forward form data changes to parent (for draft tracking)
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
  headerContent,
  hideActionBar = false, // Hide internal action bar when wrapped in ReviewModal
  activeTab = 'details' // Tab control from ReviewModal
}) {
  // Mode-specific state
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [hasAutoFilled, setHasAutoFilled] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isFormValid, setIsFormValid] = useState(false);
  const [originalChangeKey, setOriginalChangeKey] = useState(null);
  const [auditRefreshTrigger, setAuditRefreshTrigger] = useState(0);
  const [activeHistoryTab, setActiveHistoryTab] = useState('attachments');
  const [initialData, setInitialData] = useState({});

  // Refs to access base component's state
  const formDataRef = useRef(null);
  const timeErrorsRef = useRef(null);
  const validateRef = useRef(null);

  // Refs to store save functions (prevents useEffect dependency loop)
  const handleSubmitRef = useRef(null);
  const handleSaveChangesRef = useRef(null);

  const navigate = useNavigate();
  const location = useLocation();
  const { accounts } = useMsal();
  const { showError, showWarning } = useNotification();
  const { isAdmin } = usePermissions();

  // Handle prefill data from AI chat or draft modal (either via prop or navigation state)
  useEffect(() => {
    const prefill = prefillData || location.state?.prefillData;
    if (mode === 'create' && prefill) {
      logger.debug('Received prefill data:', prefill);

      // Map prefill data to the form's expected field names
      // Supports both AI chat format (eventStartTime) and draft format (startTime)
      const mappedData = {
        eventTitle: prefill.eventTitle || '',
        eventDescription: prefill.eventDescription || '',
        // Support 'categories' (correct field), 'mecCategories' (deprecated), and 'category' (AI chat single)
        categories: prefill.categories || prefill.mecCategories || (prefill.category ? [prefill.category] : []),
        startDate: prefill.startDate || prefill.date || '',
        endDate: prefill.endDate || prefill.date || '',
        // Support both startTime (drafts) and eventStartTime (AI chat)
        startTime: prefill.startTime || prefill.eventStartTime || '',
        endTime: prefill.endTime || prefill.eventEndTime || '',
        setupTime: prefill.setupTime || '',
        doorOpenTime: prefill.doorOpenTime || '',
        doorCloseTime: prefill.doorCloseTime || '',
        teardownTime: prefill.teardownTime || '',
        // Support both requestedRooms (drafts) and locationId (AI chat)
        requestedRooms: prefill.requestedRooms || prefill.locations || (prefill.locationId ? [prefill.locationId] : []),
        attendeeCount: prefill.attendeeCount || '',
        specialRequirements: prefill.specialRequirements || '',
        services: prefill.services || {},
        // Offsite location fields
        isOffsite: prefill.isOffsite || false,
        offsiteName: prefill.offsiteName || '',
        offsiteAddress: prefill.offsiteAddress || '',
        offsiteLat: prefill.offsiteLat || null,
        offsiteLon: prefill.offsiteLon || null,
        virtualMeetingUrl: prefill.virtualMeetingUrl || '',
        department: prefill.department || '',
        phone: prefill.phone || '',
        // Include calendar info so the event shows up in calendar view
        calendarId: prefill.calendarId || null,
        calendarOwner: prefill.calendarOwner || null
      };

      logger.log('📋 UnifiedEventForm prefill - received prefill:', prefill);
      logger.log('📋 UnifiedEventForm prefill - prefill.categories:', prefill.categories);
      logger.log('📋 UnifiedEventForm prefill - prefill.services:', prefill.services);
      logger.log('📋 UnifiedEventForm prefill - mappedData:', mappedData);
      logger.log('📋 UnifiedEventForm prefill - mappedData.categories:', mappedData.categories);
      logger.log('📋 UnifiedEventForm prefill - mappedData.services:', mappedData.services);

      logger.log('📋 UnifiedEventForm prefill - BEFORE setInitialData, current initialData:', initialData);
      setInitialData(prev => {
        const newData = { ...prev, ...mappedData };
        logger.log('📋 UnifiedEventForm prefill - INSIDE setInitialData, prev:', prev);
        logger.log('📋 UnifiedEventForm prefill - INSIDE setInitialData, newData:', newData);
        logger.log('📋 UnifiedEventForm prefill - INSIDE setInitialData, newData.categories:', newData.categories);
        return newData;
      });
      setHasAutoFilled(true);
      // Don't set hasChanges here - loading prefill data is not a "change"
      // Setting it true here causes issues: App.jsx resets draftHasChanges to false,
      // but internal hasChanges stays true, so real changes don't trigger the useEffect
      logger.debug('Applied prefill data to form:', mappedData);
    }
  }, [mode, prefillData, location.state]);

  // Auto-fill user email/name in create mode (authenticated users only)
  useEffect(() => {
    if (mode === 'create' && !isPublic && accounts.length > 0 && !hasAutoFilled) {
      const userEmail = accounts[0].username;
      const displayName = accounts[0].name || '';

      setInitialData(prev => ({
        ...prev,
        requesterEmail: userEmail,
        requesterName: displayName
      }));

      setHasAutoFilled(true);
      logger.debug('Auto-filled user info for authenticated user:', { userEmail, displayName });
    }
  }, [mode, isPublic, accounts, hasAutoFilled]);

  // Notify parent when hasChanges or isSaving changes
  // Note: callbacks intentionally excluded from deps to prevent render loop
  useEffect(() => {
    if (onHasChangesChange) {
      onHasChangesChange(hasChanges);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChanges]);

  useEffect(() => {
    if (onIsSavingChange) {
      onIsSavingChange(isSaving);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSaving]);

  // Initialize form data from reservation or event based on mode using shared transformer
  useEffect(() => {
    if (mode === 'reservation' && reservation) {
      logger.log('📋 Initializing form data from reservation:', {
        id: reservation._id,
        startDateTime: reservation.startDateTime,
        endDateTime: reservation.endDateTime
      });

      // Use shared transformer for consistent transformation across all components
      const transformedData = transformEventToFlatStructure(reservation);
      if (transformedData) {
        setInitialData(transformedData);
        setOriginalChangeKey(transformedData.changeKey || reservation.changeKey);
      }
    } else if (mode === 'event' && event) {
      logger.log('📋 Initializing form data from event:', {
        id: event.id,
        subject: event.subject
      });

      // Use shared transformer for consistent transformation across all components
      const transformedData = transformEventToFlatStructure(event);
      if (transformedData) {
        setInitialData(transformedData);
        setOriginalChangeKey(transformedData.changeKey || event.changeKey);
      }
    }
  }, [mode, reservation, event]);

  // Handle new booking submission (create mode) or resubmit
  const handleSubmit = useCallback(async (e) => {
    if (e) e.preventDefault();

    // Prevent double-submission
    if (submitting) {
      logger.debug('Submission already in progress, ignoring duplicate click');
      return;
    }

    const formData = formDataRef.current ? formDataRef.current() : {};
    const validateTimes = validateRef.current ? validateRef.current() : (() => true);

    if (!validateTimes()) {
      setSubmitError('Please fix the time validation errors before submitting');
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    // Report saving state to parent (for ReviewModal button state)
    if (onIsSavingChange) {
      onIsSavingChange(true);
    }

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

      // Normal create mode
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

      // Call onSuccess callback if provided (for modal flow)
      if (onSuccess) {
        onSuccess(result);
      }

    } catch (err) {
      logger.error('Error submitting reservation:', err);
      setSubmitError(err.message || 'Failed to submit reservation request');
    } finally {
      setSubmitting(false);
      // Report saving state to parent
      if (onIsSavingChange) {
        onIsSavingChange(false);
      }
    }
  }, [formDataRef, validateRef, isPublic, token, apiToken, onSuccess, onIsSavingChange, submitting, navigate]);

  // Save changes (reservation mode)
  const handleSaveChanges = useCallback(async () => {
    logger.log('💾 Save button clicked');

    const formData = formDataRef.current ? formDataRef.current() : {};
    const validateTimes = validateRef.current ? validateRef.current() : (() => true);

    if (!validateTimes()) {
      showWarning('Cannot save: Please fix time validation errors');
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
        `${APP_CONFIG.API_BASE_URL}/admin/events/${reservation._id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify(updatedData)
        }
      );

      if (response.status === 409) {
        const data = await response.json();
        showWarning(`This reservation was modified by ${data.lastModifiedBy} while you were editing. Please refresh.`);
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to save changes: ${response.status}`);
      }

      const result = await response.json();
      logger.log('✅ Save successful:', result);

      setOriginalChangeKey(result.changeKey);
      setHasChanges(false);
      setAuditRefreshTrigger(prev => prev + 1);

      if (onSave) {
        onSave(result);
      }

    } catch (error) {
      console.error('❌ Save error:', error);
      showError(error, { context: 'UnifiedEventForm.handleSaveChanges', userMessage: 'Failed to save changes' });
    } finally {
      setIsSaving(false);
    }
  }, [formDataRef, validateRef, reservation, apiToken, originalChangeKey, onSave, showError, showWarning]);

  // Keep refs in sync with save functions (prevents stale closures without causing useEffect loops)
  handleSubmitRef.current = handleSubmit;
  handleSaveChangesRef.current = handleSaveChanges;

  // Expose save function to parent (use handleSubmit for create mode, handleSaveChanges for others)
  // Uses refs to access latest functions without dependency on the functions themselves
  // This prevents render loops caused by unstable callback props (onSuccess, etc.)
  useEffect(() => {
    if (onSaveFunctionReady) {
      // Create a wrapper that always calls the latest function from the ref
      const saveFunction = mode === 'create'
        ? (...args) => handleSubmitRef.current?.(...args)
        : (...args) => handleSaveChangesRef.current?.(...args);
      onSaveFunctionReady(saveFunction);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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
        location: (() => {
          if (!formData.requestedRooms?.length) return undefined;
          const locationDocs = (availableLocations || []).filter(loc =>
            formData.requestedRooms.includes(loc._id)
          );
          if (!locationDocs.length) return undefined;
          // Primary location is the first one
          return {
            displayName: locationDocs[0].displayName || locationDocs[0].name,
            locationType: 'default'
          };
        })(),
        locations: (() => {
          if (!formData.requestedRooms?.length) return undefined;
          const locationDocs = (availableLocations || []).filter(loc =>
            formData.requestedRooms.includes(loc._id)
          );
          if (!locationDocs.length) return undefined;
          // Build array of separate location objects for Graph API
          return locationDocs.map(loc => ({
            displayName: loc.displayName || loc.name,
            locationType: 'default'
          }));
        })(),
        locationIds: formData.requestedRooms, // Internal room IDs for database storage
        recurrence: formData.recurrence || null,  // Include recurrence pattern if exists
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
          <h2>Reservation Request Submitted</h2>
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
      status={reservation?.status}
      actions={actions}
      hasChanges={hasChanges}
      errors={{}}
      headerContent={headerContent}
      hideActionBar={hideActionBar}
    >
      {submitError && (
        <div className="error-message" style={{ margin: '10px' }}>
          {submitError}
        </div>
      )}

      <RoomReservationFormBase
        initialData={initialData}
        onDataChange={(updatedData) => {
          setHasChanges(true);
          // Forward form data to parent for draft tracking
          if (onDataChange) {
            onDataChange(updatedData);
          }
        }}
        onHasChangesChange={setHasChanges}
        onFormValidChange={(valid) => {
          setIsFormValid(valid);
          if (onFormValidChange) {
            onFormValidChange(valid);
          }
        }}
        readOnly={mode === 'event' ? readOnly : false}
        reservationStatus={mode === 'reservation' ? reservation?.status : null}
        currentReservationId={mode === 'reservation' ? reservation?._id : null}
        onLockedEventClick={onLockedEventClick}
        activeTab={activeTab}
        showAllTabs={!hideActionBar}
        onFormDataRef={(getter) => { formDataRef.current = getter; }}
        onTimeErrorsRef={(getter) => { timeErrorsRef.current = getter; }}
        onValidateRef={(getter) => { validateRef.current = getter; }}
        renderAdditionalContent={() => (
          <>
            {/* Attachments Tab Content */}
            {hideActionBar && activeTab === 'attachments' && (
              <div style={{ marginTop: '20px' }}>
                <section className="form-section">
                  {mode === 'reservation' && reservation && apiToken ? (
                    <AttachmentsSection
                      resourceId={reservation?.eventId}
                      resourceType="event"
                      apiToken={apiToken}
                      readOnly={reservation?.status === 'inactive'}
                    />
                  ) : (
                    <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
                      <p>Attachments can be added after submitting your request.</p>
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* History Tab Content */}
            {hideActionBar && activeTab === 'history' && (
              <div style={{ marginTop: '20px' }}>
                <section className="form-section">
                  {mode === 'reservation' && reservation && apiToken ? (
                    <ReservationAuditHistory
                      reservationId={reservation?._id}
                      apiToken={apiToken}
                      refreshTrigger={auditRefreshTrigger}
                    />
                  ) : (
                    <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
                      <p>History will be available after submitting your request.</p>
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* Admin Tab Content */}
            {hideActionBar && activeTab === 'admin' && (
              <div style={{ marginTop: '20px' }}>
                <section className="form-section">
                  <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
                    <p>Admin options will be available after the request is submitted.</p>
                  </div>
                </section>
              </div>
            )}

            {/* Legacy inline tabs - for standalone form without ReviewModal */}
            {!hideActionBar && mode === 'reservation' && reservation && apiToken && (
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
