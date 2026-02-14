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
  originalData = null, // Original form data for comparison in edit request mode (Option C inline diff)
  onSchedulingConflictsChange = null // Callback when scheduling conflicts change: (hasConflicts) => void
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
  const [hasSchedulingConflicts, setHasSchedulingConflicts] = useState(false);
  const handleConflictChange = useCallback((hasConflicts) => {
    setHasSchedulingConflicts(hasConflicts);
    if (onSchedulingConflictsChange) onSchedulingConflictsChange(hasConflicts);
  }, [onSchedulingConflictsChange]);

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

  // Function to get processed form data (used by publish flow and draft save)
  // skipValidation: true for draft saves where dates/times are optional
  const getProcessedFormData = useCallback(({ skipValidation = false } = {}) => {
    const formData = formDataRef.current ? formDataRef.current() : {};

    if (!skipValidation) {
      const validateTimes = validateRef.current ? validateRef.current() : (() => true);
      if (!validateTimes()) {
        logger.warn('Cannot get form data - time validation errors exist');
        return null;
      }
    }

    const startDateTime = formData.startDate && formData.startTime
      ? `${formData.startDate}T${formData.startTime}` : null;
    const endDateTime = formData.endDate && formData.endTime
      ? `${formData.endDate}T${formData.endTime}` : null;

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

    // Only remove separate date/time fields for submission flow (not draft saves)
    if (!skipValidation) {
      delete processedData.startDate;
      delete processedData.startTime;
      delete processedData.endDate;
      delete processedData.endTime;
    }
    delete processedData.requestedRooms;

    return processedData;
  }, [eventVersion]);

  // Keep the ref updated with the latest getProcessedFormData function
  getProcessedFormDataRef.current = getProcessedFormData;

  // Expose form data getter to parent - only run once when onFormDataReady is set
  useEffect(() => {
    if (onFormDataReady) {
      // Pass a stable wrapper that uses the ref to always get the latest function
      onFormDataReady((options) => {
        if (getProcessedFormDataRef.current) {
          return getProcessedFormDataRef.current(options);
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
      logger.warn('Cannot publish - time validation errors exist');
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
          onConflictChange={handleConflictChange}
          renderAdditionalContent={() => (
            <>
              {/* Tab: Attachments */}
              {activeTab === 'attachments' && reservation && apiToken && (
                <div className="tab-content-pad">
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
                <div className="tab-content-pad">
                  <EventAuditHistory
                    eventId={reservation.eventId}
                    apiToken={apiToken}
                  />
                </div>
              )}

              {/* Tab: Admin (for troubleshooting) */}
              {activeTab === 'admin' && isAdmin && reservation && (
                <div className="tab-content-pad">
                  <div className="db-section">
                    <div className="db-header">
                      <div className="db-header-left">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                          <ellipse cx="12" cy="5" rx="9" ry="3" />
                          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                        </svg>
                        <span>Database Record</span>
                      </div>
                      <span className="db-field-count">{27} fields</span>
                    </div>
                    <div className="db-table-wrap">
                      <table className="db-table">
                        <tbody>
                          {[
                            ['_id', reservation._id],
                            ['eventId', reservation.eventId],
                            ['graphData.id', reservation.graphData?.id, true],
                            ['userId', reservation.userId],
                            ['source', reservation.source],
                            ['status', reservation.status],
                            ['isDeleted', String(reservation.isDeleted ?? '--')],
                            ['calendarId', reservation.calendarId, true],
                            ['locationDisplayNames', reservation.locationDisplayNames],
                            ['locations', JSON.stringify(reservation.locations) || '[]'],
                            ['eventSeriesId', reservation.eventSeriesId],
                            ['isRecurringMaster', String(reservation.isRecurringMaster ?? '--')],
                            ['recurrenceType', reservation.recurrenceType],
                            ['seriesMasterId', reservation.seriesMasterId],
                            ['isException', String(reservation.isException ?? '--')],
                            ['createdAt', reservation.createdAt],
                            ['createdBy', reservation.createdBy],
                            ['createdByEmail', reservation.createdByEmail],
                            ['createdByName', reservation.createdByName],
                            ['createdSource', reservation.createdSource],
                            ['updatedAt', reservation.updatedAt],
                            ['lastModifiedDateTime', reservation.lastModifiedDateTime],
                            ['lastSyncedAt', reservation.lastSyncedAt],
                            ['cachedAt', reservation.cachedAt],
                            ['lastAccessedAt', reservation.lastAccessedAt],
                            ['syncedFromOutlook', String(reservation.syncedFromOutlook ?? '--')],
                            ['sourceCalendars', JSON.stringify(reservation.sourceCalendars) || '[]'],
                          ].map(([field, value, breakAll]) => (
                            <tr key={field} className="db-row">
                              <td className="db-field-name">{field}</td>
                              <td className={`db-field-value${breakAll ? ' db-field-value--break' : ''}`}>{value || '--'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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
