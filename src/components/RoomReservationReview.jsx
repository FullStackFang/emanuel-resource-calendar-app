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
  graphToken, // Graph API token for calendar operations
  onApprove,
  onReject,
  onCancel,
  onSave,
  onHasChangesChange,
  onIsSavingChange,
  onIsNavigatingChange,
  onSaveFunctionReady,
  onFormDataReady, // Callback to expose form data getter to parent
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
  activeTab = 'details',
  editScope = null, // For recurring events: 'thisEvent' | 'allEvents' | null
  onFormValidChange = null // Callback when form validity changes
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
  const getProcessedFormDataRef = useRef(null); // Ref to hold the getProcessedFormData function

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
    console.log('[RoomReservationReview.handleDataChange] Called, onDataChange exists:', !!onDataChange);
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
        locations: formData.requestedRooms,  // Use locations field as single source of truth
        // Include Graph token for calendar updates
        graphToken: graphToken,
        // Include edit scope for recurring events
        editScope: editScope,
        // For 'thisEvent' scope, include occurrence identification data
        occurrenceDate: editScope === 'thisEvent' ? reservation.start?.dateTime || startDateTime : null,
        // Series master ID for recurring events - check multiple possible locations
        seriesMasterId: editScope ? (
          reservation.seriesMasterId ||
          reservation.graphData?.seriesMasterId ||
          (reservation.graphData?.type === 'seriesMaster' ? reservation.graphData?.id : null)
        ) : null
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
        formDataRequestedRoomsCount: formData.requestedRooms?.length,
        hasRecurrence: !!updatedData.recurrence,
        recurrenceData: updatedData.recurrence,
        editScope: updatedData.editScope,
        seriesMasterId: updatedData.seriesMasterId,
        hasGraphToken: !!updatedData.graphToken
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
  }, [formDataRef, validateRef, reservation, apiToken, graphToken, editScope, originalChangeKey, onSave]);

  // Expose save function to parent
  useEffect(() => {
    if (onSaveFunctionReady) {
      console.log('🔄 Updating save function reference in parent');
      onSaveFunctionReady(handleSaveChanges);
    }
  }, [onSaveFunctionReady, handleSaveChanges]);

  // Function to get processed form data (used by approve flow)
  const getProcessedFormData = useCallback(() => {
    const formData = formDataRef.current ? formDataRef.current() : {};
    const validateTimes = validateRef.current ? validateRef.current() : (() => true);

    // Validate times
    if (!validateTimes()) {
      logger.warn('Cannot get form data - time validation errors exist');
      return null;
    }

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

    const processedData = {
      ...formData,
      startDateTime,
      endDateTime,
      attendeeCount: parseInt(formData.attendeeCount) || 0,
      setupTimeMinutes,
      teardownTimeMinutes,
      locations: formData.requestedRooms, // Use locations field as single source of truth
      changeKey: originalChangeKey
    };

    // Remove separate date/time fields
    delete processedData.startDate;
    delete processedData.startTime;
    delete processedData.endDate;
    delete processedData.endTime;
    delete processedData.requestedRooms;

    return processedData;
  }, [originalChangeKey]);

  // Keep the ref updated with the latest getProcessedFormData function
  getProcessedFormDataRef.current = getProcessedFormData;

  // Expose form data getter to parent - only run once when onFormDataReady is set
  useEffect(() => {
    if (onFormDataReady) {
      console.log('🔄 Exposing form data getter to parent');
      // Pass a stable wrapper that uses the ref to always get the latest function
      onFormDataReady(() => {
        if (getProcessedFormDataRef.current) {
          return getProcessedFormDataRef.current();
        }
        return null;
      });
    }
  }, [onFormDataReady]); // Only re-run if onFormDataReady changes

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
          editScope={editScope}
          onFormDataRef={(getter) => { formDataRef.current = getter; }}
          onTimeErrorsRef={(getter) => { timeErrorsRef.current = getter; }}
          onValidateRef={(getter) => { validateRef.current = getter; }}
          onFormValidChange={onFormValidChange}
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

              {/* Tab: Admin (for troubleshooting) */}
              {activeTab === 'admin' && isAdmin && reservation && (
                <div style={{ padding: '20px' }}>
                  <h3 style={{ marginBottom: '15px', fontSize: '1rem', fontWeight: '600' }}>Database Record Info</h3>
                  <div style={{
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    backgroundColor: '#f5f5f5',
                    padding: '15px',
                    borderRadius: '4px',
                    maxHeight: '60vh',
                    overflow: 'auto'
                  }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>_id</td><td>{reservation._id || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>eventId</td><td>{reservation.eventId || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>graphData.id</td><td style={{ wordBreak: 'break-all' }}>{reservation.graphData?.id || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>userId</td><td>{reservation.userId || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>source</td><td>{reservation.source || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>status</td><td>{reservation.status || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>isDeleted</td><td>{String(reservation.isDeleted ?? '--')}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>calendarId</td><td style={{ wordBreak: 'break-all' }}>{reservation.calendarId || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>locationDisplayNames</td><td>{reservation.locationDisplayNames || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>locations</td><td>{JSON.stringify(reservation.locations) || '[]'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>eventSeriesId</td><td>{reservation.eventSeriesId || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>isRecurringMaster</td><td>{String(reservation.isRecurringMaster ?? '--')}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>recurrenceType</td><td>{reservation.recurrenceType || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>seriesMasterId</td><td>{reservation.seriesMasterId || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>isException</td><td>{String(reservation.isException ?? '--')}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>createdAt</td><td>{reservation.createdAt || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>createdBy</td><td>{reservation.createdBy || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>createdByEmail</td><td>{reservation.createdByEmail || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>createdByName</td><td>{reservation.createdByName || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>createdSource</td><td>{reservation.createdSource || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>updatedAt</td><td>{reservation.updatedAt || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>lastModifiedDateTime</td><td>{reservation.lastModifiedDateTime || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>lastSyncedAt</td><td>{reservation.lastSyncedAt || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>cachedAt</td><td>{reservation.cachedAt || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>lastAccessedAt</td><td>{reservation.lastAccessedAt || '--'}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>syncedFromOutlook</td><td>{String(reservation.syncedFromOutlook ?? '--')}</td></tr>
                        <tr><td style={{ fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' }}>sourceCalendars</td><td>{JSON.stringify(reservation.sourceCalendars) || '[]'}</td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        />
      </form>
    </div>
  );
}
