// src/components/RoomReservationReview.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import RoomReservationFormBase from './RoomReservationFormBase';
import ReservationAuditHistory from './ReservationAuditHistory';
import EventAuditHistory from './EventAuditHistory';
import AttachmentsSection from './AttachmentsSection';
import './RoomReservationForm.css';

/**
 * RoomReservationReview - Review/edit mode for existing reservations
 * Thin wrapper around RoomReservationFormBase that handles:
 * - Initialization from reservation object
 * - Tab-based rendering
 * - Save/Approve/Reject actions
 * - Parent callbacks
 * - Concurrency control
 * - Audit history and attachments
 */
export default function RoomReservationReview({
  reservation,
  apiToken,
  onApprove,
  onReject,
  onCancel,
  onSave,
  onHasChangesChange,
  onIsSavingChange,
  onIsNavigatingChange,
  onSaveFunctionReady,
  onDataChange,
  onLockedEventClick,
  onNavigateToSeriesEvent,
  isAdmin = false,
  availableCalendars = [],
  defaultCalendar = '',
  selectedTargetCalendar = '',
  onTargetCalendarChange = () => {},
  createCalendarEvent = true,
  onCreateCalendarEventChange = () => {},
  activeTab = 'details'
}) {
  // Review-specific state
  const [initialData, setInitialData] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [originalChangeKey, setOriginalChangeKey] = useState(null);
  const [auditRefreshTrigger, setAuditRefreshTrigger] = useState(0);

  // Refs to access base component's state
  const formDataRef = useRef(null);
  const timeErrorsRef = useRef(null);
  const validateRef = useRef(null);

  // Notify parent when isSaving changes
  useEffect(() => {
    if (onIsSavingChange) {
      onIsSavingChange(isSaving);
    }
  }, [isSaving, onIsSavingChange]);

  // Notify parent when isNavigating changes
  useEffect(() => {
    if (onIsNavigatingChange) {
      onIsNavigatingChange(isNavigating);
    }
  }, [isNavigating, onIsNavigatingChange]);

  // Track if form has been initialized to prevent re-initialization on every change
  const isInitializedRef = React.useRef(false);
  const reservationIdRef = React.useRef(null);

  // Initialize form data from reservation (only once per reservation)
  useEffect(() => {
    if (reservation) {
      // Only initialize if this is a different reservation (different ID or first time)
      const currentReservationId = reservation._id || reservation.eventId || JSON.stringify(reservation);
      const isDifferentReservation = reservationIdRef.current !== currentReservationId;

      if (!isInitializedRef.current || isDifferentReservation) {
        console.log('📋 Initializing form data from reservation:', {
          id: reservation._id,
          startDateTime: reservation.startDateTime,
          endDateTime: reservation.endDateTime,
          startDate: reservation.startDate,
          startTime: reservation.startTime,
          endDate: reservation.endDate,
          endTime: reservation.endTime
        });

        // Handle both formats: combined datetime OR separate date/time fields
        let startDate, startTime, endDate, endTime;

        if (reservation.startDate && reservation.endDate) {
          // New format: separate date/time fields
          startDate = reservation.startDate;
          startTime = reservation.startTime || '';
          endDate = reservation.endDate;
          endTime = reservation.endTime || '';
        } else if (reservation.startDateTime && reservation.endDateTime) {
          // Old format: combined datetime fields
          const startDateTime = new Date(reservation.startDateTime);
          const endDateTime = new Date(reservation.endDateTime);

          // Validate dates
          if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
            console.error('❌ Invalid date values in reservation:', {
              startDateTime: reservation.startDateTime,
              endDateTime: reservation.endDateTime,
              parsedStart: startDateTime,
              parsedEnd: endDateTime
            });
            return;
          }

          startDate = startDateTime.toISOString().split('T')[0];
          startTime = startDateTime.toTimeString().slice(0, 5);
          endDate = endDateTime.toISOString().split('T')[0];
          endTime = endDateTime.toTimeString().slice(0, 5);
        } else {
          // No valid date/time information
          console.error('❌ Missing date/time information in reservation');
          startDate = '';
          startTime = '';
          endDate = '';
          endTime = '';
        }

        setInitialData({
          requesterName: reservation.roomReservationData?.requestedBy?.name || reservation.requesterName || '',
          requesterEmail: reservation.roomReservationData?.requestedBy?.email || reservation.requesterEmail || '',
          department: reservation.roomReservationData?.requestedBy?.department || reservation.department || '',
          phone: reservation.roomReservationData?.requestedBy?.phone || reservation.phone || '',
          eventTitle: reservation.eventTitle || '',
          eventDescription: reservation.eventDescription || '',
          startDate,
          startTime,
          endDate,
          endTime,
          doorOpenTime: reservation.doorOpenTime || '',
          doorCloseTime: reservation.doorCloseTime || '',
          setupTime: reservation.setupTime || '',
          teardownTime: reservation.teardownTime || '',
          setupNotes: reservation.setupNotes || '',
          doorNotes: reservation.doorNotes || '',
          eventNotes: reservation.eventNotes || '',
          attendeeCount: reservation.attendeeCount || '',
          requestedRooms: reservation.locations || [],  // Use locations field as single source of truth
          specialRequirements: reservation.specialRequirements || '',
          setupTimeMinutes: reservation.setupTimeMinutes || 0,
          teardownTimeMinutes: reservation.teardownTimeMinutes || 0,
          contactEmail: reservation.roomReservationData?.contactPerson?.email || reservation.contactEmail || '',
          contactName: reservation.roomReservationData?.contactPerson?.name || reservation.contactName || '',
          isOnBehalfOf: reservation.roomReservationData?.contactPerson?.isOnBehalfOf || reservation.isOnBehalfOf || false,
          reviewNotes: reservation.roomReservationData?.reviewNotes || reservation.reviewNotes || '',
          isAllDayEvent: reservation.isAllDayEvent || false,
          virtualMeetingUrl: reservation.virtualMeetingUrl || reservation.graphData?.onlineMeetingUrl || null,
          graphData: reservation.graphData || null,
          eventId: reservation.eventId || null,
          eventSeriesId: reservation.eventSeriesId || null,
          seriesIndex: reservation.seriesIndex || null,
          seriesLength: reservation.seriesLength || null
        });

        // Store original changeKey for optimistic concurrency control
        setOriginalChangeKey(reservation.changeKey);

        // Mark as initialized for this reservation
        isInitializedRef.current = true;
        reservationIdRef.current = currentReservationId;
      }
    }
  }, [reservation]);

  // Handle data changes from base component
  const handleDataChange = (updatedData) => {
    if (onDataChange) {
      onDataChange(updatedData);
    }
  };

  // Helper function to convert time difference to minutes
  const calculateTimeBufferMinutes = (eventTime, bufferTime) => {
    if (!eventTime || !bufferTime) return 0;

    const eventDate = new Date(`1970-01-01T${eventTime}:00`);
    const bufferDate = new Date(`1970-01-01T${bufferTime}:00`);

    const diffMs = Math.abs(eventDate.getTime() - bufferDate.getTime());
    return Math.floor(diffMs / (1000 * 60));
  };

  // Save changes
  const handleSaveChanges = useCallback(async () => {
    console.log('💾 Save button clicked');

    const formData = formDataRef.current ? formDataRef.current() : {};
    const validateTimes = validateRef.current ? validateRef.current() : (() => true);

    // Validate times before saving
    if (!validateTimes()) {
      console.log('❌ Time validation failed');
      logger.warn('Cannot save - time validation errors exist');
      alert('Cannot save: Please fix time validation errors');
      return;
    }

    console.log('✅ Validation passed, starting save...');
    setIsSaving(true);
    try {
      const startDateTime = `${formData.startDate}T${formData.startTime}`;
      const endDateTime = `${formData.endDate}T${formData.endTime}`;

      // Calculate setup/teardown minutes
      let setupTimeMinutes = formData.setupTimeMinutes || 0;
      let teardownTimeMinutes = formData.teardownTimeMinutes || 0;

      if (formData.setupTime) {
        setupTimeMinutes = calculateTimeBufferMinutes(formData.startTime, formData.setupTime);
      }
      if (formData.teardownTime) {
        teardownTimeMinutes = calculateTimeBufferMinutes(formData.endTime, formData.teardownTime);
      }

      const updatedData = {
        ...formData,
        startDateTime,
        endDateTime,
        attendeeCount: parseInt(formData.attendeeCount) || 0,
        setupTimeMinutes,
        teardownTimeMinutes,
        locations: formData.requestedRooms  // Use locations field as single source of truth
      };

      // Remove separate date/time fields and old requestedRooms field
      delete updatedData.startDate;
      delete updatedData.startTime;
      delete updatedData.endDate;
      delete updatedData.endTime;
      delete updatedData.requestedRooms;  // Remove old field name

      console.log('📤 Sending save request to API...', {
        reservationId: reservation._id,
        locationsCount: updatedData.locations?.length,
        locationIds: updatedData.locations,
        hasRequestedRooms: 'requestedRooms' in updatedData,
        formDataRequestedRoomsCount: formData.requestedRooms?.length
      });

      // Use correct endpoint based on event type
      // New unified events use /admin/events, legacy reservations use /admin/room-reservations
      const updateEndpoint = reservation._isNewUnifiedEvent
        ? `${APP_CONFIG.API_BASE_URL}/admin/events/${reservation._id}`
        : `${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${reservation._id}`;

      // Make API call with If-Match header for optimistic concurrency control
      const response = await fetch(
        updateEndpoint,
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

      console.log('📥 API response received:', { status: response.status, ok: response.ok });

      // Handle conflict (409)
      if (response.status === 409) {
        const data = await response.json();
        const changes = data.changes || [];
        const changesList = changes.map(c => `- ${c.field}: ${c.oldValue} → ${c.newValue}`).join('\n');

        const message = `This reservation was modified by ${data.lastModifiedBy} while you were editing.\n\n` +
                       `Changes made:\n${changesList}\n\n` +
                       `Your changes have NOT been saved. Please refresh to see the latest version.\n` +
                       `(Your changes will be lost)`;

        console.log('⚠️ Conflict detected (409):', data);
        alert(message);
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to save changes: ${response.status}`);
      }

      const result = await response.json();
      console.log('✅ Save successful:', result);

      // Update originalChangeKey with the new changeKey from server
      setOriginalChangeKey(result.changeKey);

      // Refresh audit history
      setAuditRefreshTrigger(prev => prev + 1);

      // Notify parent of successful save
      if (onSave) {
        onSave(result);
      }

    } catch (error) {
      console.error('❌ Save error:', error);
      logger.error('Error saving changes:', error);
      alert(`Failed to save changes: ${error.message}`);
    } finally {
      setIsSaving(false);
      console.log('💾 Save process complete');
    }
  }, [formDataRef, validateRef, reservation, apiToken, originalChangeKey, onSave]);

  // Expose save function to parent
  useEffect(() => {
    if (onSaveFunctionReady) {
      console.log('🔄 Updating save function reference in parent');
      onSaveFunctionReady(handleSaveChanges);
    }
  }, [onSaveFunctionReady, handleSaveChanges]);

  // Approve handler
  const handleApprove = () => {
    const formData = formDataRef.current ? formDataRef.current() : {};
    const validateTimes = validateRef.current ? validateRef.current() : (() => true);

    // Validate times before approval
    if (!validateTimes()) {
      logger.warn('Cannot approve - time validation errors exist');
      return;
    }

    if (onApprove) {
      const startDateTime = `${formData.startDate}T${formData.startTime}`;
      const endDateTime = `${formData.endDate}T${formData.endTime}`;

      // Calculate setup/teardown minutes
      let setupTimeMinutes = formData.setupTimeMinutes || 0;
      let teardownTimeMinutes = formData.teardownTimeMinutes || 0;

      if (formData.setupTime) {
        setupTimeMinutes = calculateTimeBufferMinutes(formData.startTime, formData.setupTime);
      }
      if (formData.teardownTime) {
        teardownTimeMinutes = calculateTimeBufferMinutes(formData.endTime, formData.teardownTime);
      }

      const updatedData = {
        ...formData,
        startDateTime,
        endDateTime,
        attendeeCount: parseInt(formData.attendeeCount) || 0,
        setupTimeMinutes,
        teardownTimeMinutes,
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

  return (
    <div className="room-reservation-form" style={{ maxWidth: '100%', padding: '10px' }}>
      <form onSubmit={(e) => e.preventDefault()}>
        <RoomReservationFormBase
          initialData={initialData}
          onDataChange={handleDataChange}
          onHasChangesChange={onHasChangesChange}
          onIsNavigatingChange={setIsNavigating}
          readOnly={false}
          isAdmin={isAdmin}
          reservationStatus={reservation?.status}
          currentReservationId={reservation?._id}
          onLockedEventClick={onLockedEventClick}
          onNavigateToSeriesEvent={onNavigateToSeriesEvent}
          defaultCalendar={defaultCalendar}
          apiToken={apiToken}
          activeTab={activeTab}
          showAllTabs={false}
          onFormDataRef={(getter) => { formDataRef.current = getter; }}
          onTimeErrorsRef={(getter) => { timeErrorsRef.current = getter; }}
          onValidateRef={(getter) => { validateRef.current = getter; }}
          renderAdditionalContent={() => (
            <>
              {/* Tab: Attachments */}
              {activeTab === 'attachments' && reservation && apiToken && (
                <div style={{ padding: '20px' }}>
                  <AttachmentsSection
                    resourceId={reservation?.eventId}
                    resourceType="event"
                    apiToken={apiToken}
                    readOnly={reservation?.status === 'inactive'}
                  />
                </div>
              )}

              {/* Tab: History */}
              {activeTab === 'history' && reservation && apiToken && (
                <div style={{ padding: '20px' }}>
                  {reservation._isNewUnifiedEvent ? (
                    <EventAuditHistory
                      eventId={reservation.eventId}
                      apiToken={apiToken}
                    />
                  ) : (
                    <ReservationAuditHistory
                      reservationId={reservation._id}
                      apiToken={apiToken}
                      refreshTrigger={auditRefreshTrigger}
                    />
                  )}
                </div>
              )}
            </>
          )}
        />
      </form>
    </div>
  );
}
