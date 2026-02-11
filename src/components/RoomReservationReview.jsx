// src/components/RoomReservationReview.jsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { logger } from '../utils/logger';
import { useNotification } from '../context/NotificationContext';
import { usePermissions } from '../hooks/usePermissions';
import APP_CONFIG from '../config/config';
import { transformEventToFlatStructure } from '../utils/eventTransformers';
import RoomReservationFormBase from './RoomReservationFormBase';
import EventAuditHistory from './EventAuditHistory';
import AttachmentsSection from './AttachmentsSection';
import ConflictDialog from './shared/ConflictDialog';
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
  prefetchedAvailability = null, // Pre-fetched room availability data from parent
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
  availableCalendars = [],
  defaultCalendar = '',
  selectedTargetCalendar = '',
  onTargetCalendarChange = () => {},
  createCalendarEvent = true,
  onCreateCalendarEventChange = () => {},
  activeTab = 'details',
  editScope = null, // For recurring events: 'thisEvent' | 'allEvents' | null
  onFormValidChange = null, // Callback when form validity changes
  readOnly = false, // Read-only mode for viewers
  isEditRequestMode = false, // Edit request mode - allows editing even when normally readOnly
  isViewingEditRequest = false, // Viewing an existing edit request (read-only with diff display)
  originalData = null // Original form data for comparison in edit request mode (Option C inline diff)
}) {
  const { showError, showWarning } = useNotification();
  const { isAdmin } = usePermissions();

  // In edit request mode, override readOnly to allow editing
  // In viewing edit request mode, force readOnly
  const effectiveReadOnly = isViewingEditRequest || (readOnly && !isEditRequestMode);
  // Review-specific state
  const [isSaving, setIsSaving] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [eventVersion, setEventVersion] = useState(reservation?._version || null);
  const [auditRefreshTrigger, setAuditRefreshTrigger] = useState(0);

  // Conflict dialog state
  const [conflictDialog, setConflictDialog] = useState({ isOpen: false, conflictType: 'data_changed', details: {} });

  // Refs to access base component's state
  const formDataRef = useRef(null);
  const timeErrorsRef = useRef(null);
  const validateRef = useRef(null);
  const getProcessedFormDataRef = useRef(null); // Ref to hold the getProcessedFormData function

  // Track previous reservation ID for changeKey updates
  const prevReservationIdRef = useRef(null);

  // Compute initialData synchronously from reservation prop using shared transformer (no flicker!)
  // The transformer handles: date/time parsing, HTML stripping, offsite detection, auto-defaults
  const initialData = useMemo(() => {
    if (!reservation) return {};
    return transformEventToFlatStructure(reservation);
  }, [reservation]);

  // Update version when reservation changes
  useEffect(() => {
    const currentId = reservation?._id || reservation?.eventId;
    if (currentId && currentId !== prevReservationIdRef.current) {
      setEventVersion(reservation?._version || null);
      prevReservationIdRef.current = currentId;
    }
  }, [reservation]);

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

    const formData = formDataRef.current ? formDataRef.current() : {};
    const validateTimes = validateRef.current ? validateRef.current() : (() => true);

    // Validate times before saving
    if (!validateTimes()) {
      logger.warn('Cannot save - time validation errors exist');
      showWarning('Cannot save: Please fix time validation errors');
      return;
    }

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
        // Series master ID for recurring events - check top-level (authoritative) then graphData (fallback)
        seriesMasterId: editScope ? (
          reservation.seriesMasterId ||
          reservation.graphData?.seriesMasterId ||
          ((reservation.eventType || reservation.graphData?.type) === 'seriesMaster' ? reservation.graphData?.id : null)
        ) : null
      };

      // Remove separate date/time fields and old requestedRooms field
      delete updatedData.startDate;
      delete updatedData.startTime;
      delete updatedData.endDate;
      delete updatedData.endTime;
      delete updatedData.requestedRooms;  // Remove old field name

      logger.debug('Saving event', { reservationId: reservation._id });

      const updateEndpoint = `${APP_CONFIG.API_BASE_URL}/admin/events/${reservation._id}`;

      // Include _version for optimistic concurrency control
      updatedData._version = eventVersion;

      const response = await fetch(
        updateEndpoint,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify(updatedData)
        }
      );

      // Handle conflict (409)
      if (response.status === 409) {
        const data = await response.json();
        const conflictDetails = data.details || {};
        const currentStatus = conflictDetails.currentStatus || data.currentStatus;

        logger.warn('Conflict detected (409)', { details: conflictDetails });

        // Determine conflict type based on status change
        const expectedStatus = reservation?.status;
        const conflictType = currentStatus && currentStatus !== expectedStatus
          ? 'status_changed'
          : 'data_changed';

        setConflictDialog({
          isOpen: true,
          conflictType,
          details: conflictDetails,
          staleData: reservation
        });
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to save changes: ${response.status}`);
      }

      const result = await response.json();

      // Update eventVersion with the new version from server
      setEventVersion(result._version || eventVersion);

      // Refresh audit history
      setAuditRefreshTrigger(prev => prev + 1);

      // Notify parent of successful save
      if (onSave) {
        onSave(result);
      }

    } catch (error) {
      console.error('❌ Save error:', error);
      logger.error('Error saving changes:', error);
      showError(error, { context: 'RoomReservationReview.handleSaveChanges', userMessage: 'Failed to save changes' });
    } finally {
      setIsSaving(false);
    }
  }, [formDataRef, validateRef, reservation, apiToken, graphToken, editScope, eventVersion, onSave]);

  // Expose save function to parent
  useEffect(() => {
    if (onSaveFunctionReady) {
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
      _version: eventVersion
    };

    // Remove separate date/time fields
    delete processedData.startDate;
    delete processedData.startTime;
    delete processedData.endDate;
    delete processedData.endTime;
    delete processedData.requestedRooms;

    return processedData;
  }, [eventVersion]);

  // Keep the ref updated with the latest getProcessedFormData function
  getProcessedFormDataRef.current = getProcessedFormData;

  // Expose form data getter to parent - only run once when onFormDataReady is set
  useEffect(() => {
    if (onFormDataReady) {
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
        _version: eventVersion
      };

      delete updatedData.startDate;
      delete updatedData.startTime;
      delete updatedData.endDate;
      delete updatedData.endTime;

      onApprove(updatedData, formData.reviewNotes, eventVersion);
    }
  };

  // Reject handler
  const handleReject = () => {
    const formData = formDataRef.current ? formDataRef.current() : {};
    if (onReject) {
      onReject(formData.reviewNotes);
    }
  };

  // Data is computed synchronously via useMemo, so it's ready on first render
  // Only show empty state if reservation prop is missing entirely
  if (!reservation) {
    return null;
  }

  return (
    <div className="room-reservation-form" style={{ maxWidth: '100%', padding: '10px' }}>
      <form onSubmit={(e) => e.preventDefault()}>
        <RoomReservationFormBase
          initialData={initialData}
          prefetchedAvailability={prefetchedAvailability}
          onDataChange={handleDataChange}
          onHasChangesChange={onHasChangesChange}
          onIsNavigatingChange={setIsNavigating}
          readOnly={effectiveReadOnly}
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
          isEditRequestMode={isEditRequestMode}
          isViewingEditRequest={isViewingEditRequest}
          originalData={originalData}
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
                  <EventAuditHistory
                    eventId={reservation.eventId}
                    apiToken={apiToken}
                  />
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

      {/* Conflict Dialog for 409 version conflicts */}
      <ConflictDialog
        isOpen={conflictDialog.isOpen}
        onClose={() => setConflictDialog(prev => ({ ...prev, isOpen: false }))}
        onRefresh={() => {
          setConflictDialog(prev => ({ ...prev, isOpen: false }));
          // Trigger parent to reload the event data
          if (onSave) onSave(null);
        }}
        conflictType={conflictDialog.conflictType}
        eventTitle={reservation?.eventTitle || reservation?.subject || 'Event'}
        details={conflictDialog.details}
        staleData={conflictDialog.staleData}
      />
    </div>
  );
}
