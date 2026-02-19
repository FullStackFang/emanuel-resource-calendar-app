// src/components/MyReservations.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { logger } from '../utils/logger';
import { useNotification } from '../context/NotificationContext';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import { usePermissions } from '../hooks/usePermissions';
import { useReviewModal } from '../hooks/useReviewModal';
import { transformEventToFlatStructure, transformEventsToFlatStructure } from '../utils/eventTransformers';
import ReviewModal from './shared/ReviewModal';
import RoomReservationReview from './RoomReservationReview';
import ConflictDialog from './shared/ConflictDialog';
import LoadingSpinner from './shared/LoadingSpinner';
import './MyReservations.css';

export default function MyReservations({ apiToken }) {
  const { canSubmitReservation, canEditEvents, canApproveReservations, permissionsLoading } = usePermissions();
  const { showWarning, showSuccess, showError } = useNotification();
  const [allReservations, setAllReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('draft');
  const [page, setPage] = useState(1);
  const [restoreConflicts, setRestoreConflicts] = useState(null);

  // Use room context for efficient room name resolution
  const { getRoomDetails } = useRooms();

  // --- useReviewModal hook (replaces manual modal state) ---
  const reviewModal = useReviewModal({
    apiToken,
    onSuccess: () => { loadMyReservations(); },
    onError: (error) => { showError(error, { context: 'MyReservations' }); }
  });

  // Local state for requester actions in ReviewModal
  const [cancelRequestReason, setCancelRequestReason] = useState('');
  const [isCancellingRequest, setIsCancellingRequest] = useState(false);
  const [isResubmitting, setIsResubmitting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [hasSchedulingConflicts, setHasSchedulingConflicts] = useState(false);

  // Local state for pending edit (owner editing pending events)
  const [savingPendingEdit, setSavingPendingEdit] = useState(false);
  // Local state for rejected edit (owner editing rejected events + resubmitting)
  const [savingRejectedEdit, setSavingRejectedEdit] = useState(false);

  // Local state for edit request mode (requester requesting edits on published events)
  const [isEditRequestMode, setIsEditRequestMode] = useState(false);
  const [editRequestChangeReason, setEditRequestChangeReason] = useState('');
  const [submittingEditRequest, setSubmittingEditRequest] = useState(false);

  // Local state for viewing existing edit requests on published events
  const [existingEditRequest, setExistingEditRequest] = useState(null);
  const [isViewingEditRequest, setIsViewingEditRequest] = useState(false);
  const [originalEventData, setOriginalEventData] = useState(null);
  // Transform originalEventData to flat structure for inline diff comparison
  const flatOriginalEventData = useMemo(() =>
    originalEventData ? transformEventToFlatStructure(originalEventData) : null,
  [originalEventData]);
  const [loadingEditRequest, setLoadingEditRequest] = useState(false);

  // Helper to get event field with calendarData fallback
  const getEventField = (event, field, defaultValue = undefined) => {
    if (!event) return defaultValue;
    if (event.calendarData?.[field] !== undefined) return event.calendarData[field];
    if (event[field] !== undefined) return event[field];
    return defaultValue;
  };

  // Extract and transform pendingEditRequest from an event
  const fetchExistingEditRequest = useCallback((event) => {
    if (!event) return null;

    setLoadingEditRequest(true);
    try {
      if (event.pendingEditRequest && event.pendingEditRequest.status === 'pending') {
        const pendingReq = event.pendingEditRequest;
        return {
          _id: event._id,
          eventId: event.eventId,
          editRequestId: pendingReq.id,
          status: pendingReq.status,
          requestedBy: pendingReq.requestedBy,
          changeReason: pendingReq.changeReason,
          proposedChanges: pendingReq.proposedChanges,
          originalValues: pendingReq.originalValues,
          reviewedBy: pendingReq.reviewedBy,
          reviewedAt: pendingReq.reviewedAt,
          reviewNotes: pendingReq.reviewNotes,
          eventTitle: pendingReq.proposedChanges?.eventTitle || event.eventTitle,
          eventDescription: pendingReq.proposedChanges?.eventDescription || event.eventDescription,
          startDateTime: pendingReq.proposedChanges?.startDateTime || event.startDateTime,
          endDateTime: pendingReq.proposedChanges?.endDateTime || event.endDateTime,
          startDate: pendingReq.proposedChanges?.startDateTime?.split('T')[0] || event.startDate,
          startTime: pendingReq.proposedChanges?.startDateTime?.split('T')[1]?.substring(0, 5) || event.startTime,
          endDate: pendingReq.proposedChanges?.endDateTime?.split('T')[0] || event.endDate,
          endTime: pendingReq.proposedChanges?.endDateTime?.split('T')[1]?.substring(0, 5) || event.endTime,
          attendeeCount: pendingReq.proposedChanges?.attendeeCount ?? getEventField(event, 'attendeeCount'),
          locations: pendingReq.proposedChanges?.locations || getEventField(event, 'locations', []),
          locationDisplayNames: pendingReq.proposedChanges?.locationDisplayNames || getEventField(event, 'locationDisplayNames', ''),
          requestedRooms: pendingReq.proposedChanges?.requestedRooms || getEventField(event, 'requestedRooms', []),
          categories: pendingReq.proposedChanges?.categories || getEventField(event, 'categories', []),
          services: pendingReq.proposedChanges?.services || getEventField(event, 'services', {}),
          setupTimeMinutes: pendingReq.proposedChanges?.setupTimeMinutes ?? getEventField(event, 'setupTimeMinutes'),
          teardownTimeMinutes: pendingReq.proposedChanges?.teardownTimeMinutes ?? getEventField(event, 'teardownTimeMinutes'),
          setupTime: pendingReq.proposedChanges?.setupTime || getEventField(event, 'setupTime', ''),
          teardownTime: pendingReq.proposedChanges?.teardownTime || getEventField(event, 'teardownTime', ''),
          doorOpenTime: pendingReq.proposedChanges?.doorOpenTime || getEventField(event, 'doorOpenTime', ''),
          doorCloseTime: pendingReq.proposedChanges?.doorCloseTime || getEventField(event, 'doorCloseTime', ''),
          setupNotes: pendingReq.proposedChanges?.setupNotes ?? getEventField(event, 'setupNotes'),
          doorNotes: pendingReq.proposedChanges?.doorNotes ?? getEventField(event, 'doorNotes'),
          eventNotes: pendingReq.proposedChanges?.eventNotes ?? getEventField(event, 'eventNotes'),
          specialRequirements: pendingReq.proposedChanges?.specialRequirements ?? getEventField(event, 'specialRequirements'),
          isOffsite: pendingReq.proposedChanges?.isOffsite ?? getEventField(event, 'isOffsite', false),
          offsiteName: pendingReq.proposedChanges?.offsiteName || getEventField(event, 'offsiteName', ''),
          offsiteAddress: pendingReq.proposedChanges?.offsiteAddress || getEventField(event, 'offsiteAddress', ''),
          createdAt: pendingReq.requestedBy?.requestedAt
        };
      }
      return null;
    } finally {
      setLoadingEditRequest(false);
    }
  }, []);

  // Check for existing edit requests when ReviewModal opens with a published event
  useEffect(() => {
    if (reviewModal.isOpen && reviewModal.currentItem?.status === 'published') {
      const editRequest = fetchExistingEditRequest(reviewModal.currentItem);
      setExistingEditRequest(editRequest);
    } else if (!reviewModal.isOpen) {
      setExistingEditRequest(null);
      setIsViewingEditRequest(false);
      setOriginalEventData(null);
    }
  }, [reviewModal.isOpen, reviewModal.currentItem, fetchExistingEditRequest]);

  // View the edit request data in the form
  const handleViewEditRequest = useCallback(() => {
    if (existingEditRequest) {
      const currentData = reviewModal.editableData;
      if (currentData) {
        setOriginalEventData(JSON.parse(JSON.stringify(currentData)));
      }
      reviewModal.updateData(existingEditRequest);
      setIsViewingEditRequest(true);
    }
  }, [existingEditRequest, reviewModal]);

  // Toggle back to the original published event
  const handleViewOriginalEvent = useCallback(() => {
    if (originalEventData) {
      reviewModal.updateData(originalEventData);
      setIsViewingEditRequest(false);
    }
  }, [originalEventData, reviewModal]);

  // Reset local state when modal closes
  useEffect(() => {
    if (!reviewModal.isOpen) {
      setIsEditRequestMode(false);
      setEditRequestChangeReason('');
      setCancelRequestReason('');
      setHasSchedulingConflicts(false);
      setSavingPendingEdit(false);
      setSubmittingEditRequest(false);
    }
  }, [reviewModal.isOpen]);

  const isRequesterOnly = !canEditEvents && !canApproveReservations;

  const loadMyReservations = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      // Load all user's reservations including deleted (API automatically filters by user)
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/list?view=my-events&limit=1000&includeDeleted=true`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (!response.ok) throw new Error('Failed to load reservations');

      const data = await response.json();
      // Transform events to flatten calendarData fields to top-level for easier access
      const transformedReservations = transformEventsToFlatStructure(data.events || []);
      setAllReservations(transformedReservations);
    } catch (err) {
      logger.error('Error loading user reservations:', err);
      setError('Failed to load your reservation requests');
    } finally {
      setLoading(false);
    }
  }, [apiToken]);

  // Load all user's reservations once on mount
  useEffect(() => {
    if (apiToken) {
      loadMyReservations();
    }
  }, [loadMyReservations]);

  // Listen for refresh event (triggered after draft submission)
  useEffect(() => {
    const handleRefresh = () => loadMyReservations();
    window.addEventListener('refresh-my-reservations', handleRefresh);
    return () => window.removeEventListener('refresh-my-reservations', handleRefresh);
  }, [loadMyReservations]);

  // Client-side filtering with memoization
  const filteredReservations = useMemo(() => {
    if (activeTab === 'draft') {
      return allReservations.filter(r => r.status === 'draft');
    }
    if (activeTab === 'pending') {
      return allReservations.filter(r => r.status === 'pending');
    }
    if (activeTab === 'published') {
      // Published = published status WITHOUT a pending edit request
      return allReservations.filter(r =>
        r.status === 'published' &&
        (!r.pendingEditRequest || r.pendingEditRequest.status !== 'pending')
      );
    }
    if (activeTab === 'published_edit') {
      // Published Edit = published status WITH a pending edit request
      return allReservations.filter(r =>
        r.status === 'published' &&
        r.pendingEditRequest?.status === 'pending'
      );
    }
    if (activeTab === 'rejected') {
      return allReservations.filter(r => r.status === 'rejected');
    }
    if (activeTab === 'cancelled') {
      return allReservations.filter(r => r.status === 'cancelled');
    }
    if (activeTab === 'deleted') {
      return allReservations.filter(r => r.status === 'deleted');
    }
    return allReservations.filter(reservation => reservation.status === activeTab);
  }, [allReservations, activeTab]);

  // Count for each status tab
  const statusCounts = useMemo(() => ({
    draft: allReservations.filter(r => r.status === 'draft').length,
    pending: allReservations.filter(r => r.status === 'pending').length,
    published: allReservations.filter(r =>
      r.status === 'published' &&
      (!r.pendingEditRequest || r.pendingEditRequest.status !== 'pending')
    ).length,
    published_edit: allReservations.filter(r =>
      r.status === 'published' &&
      r.pendingEditRequest?.status === 'pending'
    ).length,
    rejected: allReservations.filter(r => r.status === 'rejected').length,
    cancelled: allReservations.filter(r => r.status === 'cancelled').length,
    deleted: allReservations.filter(r => r.status === 'deleted').length,
  }), [allReservations]);

  // Pagination for filtered results
  const itemsPerPage = 20;
  const totalPages = Math.ceil(filteredReservations.length / itemsPerPage);
  const startIndex = (page - 1) * itemsPerPage;
  const paginatedReservations = filteredReservations.slice(startIndex, startIndex + itemsPerPage);

  // Reset page when tab changes
  const handleTabChange = (newTab) => {
    setActiveTab(newTab);
    setPage(1);
  };

  // Calculate days until draft auto-deletes
  const getDaysUntilDelete = (draftCreatedAt) => {
    if (!draftCreatedAt) return null;
    const createdDate = new Date(draftCreatedAt);
    const deleteDate = new Date(createdDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const now = new Date();
    const daysRemaining = Math.ceil((deleteDate - now) / (24 * 60 * 60 * 1000));
    return Math.max(0, daysRemaining);
  };

  // Format date/time for conflict modal display
  const formatDateTime = (date) => {
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  // --- Requester action handlers (local, not in hook) ---

  // Cancel Request (requester, pending events) — used by ReviewModal's onCancelRequest button
  const handleCancelRequest = useCallback(async () => {
    const item = reviewModal.currentItem;
    if (!item) return;
    if (!cancelRequestReason.trim()) {
      showWarning('Please enter a cancellation reason');
      return;
    }

    setIsCancellingRequest(true);
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/room-reservations/${item._id}/cancel`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({ reason: cancelRequestReason, _version: item._version || null })
      });

      if (!response.ok) throw new Error('Failed to cancel reservation');

      showSuccess(`"${item.eventTitle}" has been cancelled`);
      setCancelRequestReason('');
      reviewModal.closeModal(true);
      loadMyReservations();
    } catch (err) {
      logger.error('Error cancelling reservation:', err);
      showError(err, { context: 'MyReservations.handleCancelRequest' });
    } finally {
      setIsCancellingRequest(false);
    }
  }, [reviewModal, cancelRequestReason, apiToken, loadMyReservations, showSuccess, showWarning, showError]);

  // Resubmit (requester, rejected events) — used by ReviewModal's onResubmit button
  const handleResubmit = useCallback(async () => {
    const item = reviewModal.currentItem;
    if (!item) return;

    setIsResubmitting(true);
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/room-reservations/${item._id}/resubmit`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({ _version: item._version || null })
      });

      if (!response.ok) throw new Error('Failed to resubmit reservation');

      showSuccess(`"${item.eventTitle}" resubmitted for review`);
      reviewModal.closeModal(true);
      loadMyReservations();
    } catch (err) {
      logger.error('Error resubmitting reservation:', err);
      showError(err, { context: 'MyReservations.handleResubmit' });
    } finally {
      setIsResubmitting(false);
    }
  }, [reviewModal, apiToken, loadMyReservations, showSuccess, showError]);

  // Restore (owner, deleted/cancelled events) — used by ReviewModal's onRestore button
  const handleRestore = useCallback(async () => {
    const item = reviewModal.currentItem;
    if (!item) return;

    setIsRestoring(true);
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/room-reservations/${item._id}/restore`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({ _version: item._version || null })
      });

      if (response.status === 409) {
        const data = await response.json();
        if (data.error === 'SchedulingConflict') {
          setRestoreConflicts({ ...data, eventTitle: item.eventTitle });
          return;
        }
        throw new Error(data.message || 'Version conflict');
      }

      if (!response.ok) throw new Error('Failed to restore reservation');

      const result = await response.json();
      showSuccess(`"${item.eventTitle}" restored to ${result.status}`);
      reviewModal.closeModal(true);
      loadMyReservations();
    } catch (err) {
      logger.error('Error restoring reservation:', err);
      showError(err, { context: 'MyReservations.handleRestore' });
    } finally {
      setIsRestoring(false);
    }
  }, [reviewModal, apiToken, loadMyReservations, showSuccess, showError]);

  // Save Pending Edit (owner editing pending events) — used by ReviewModal's onSavePendingEdit button
  const handleSavePendingEdit = useCallback(async () => {
    const item = reviewModal.currentItem;
    const formData = reviewModal.editableData;
    if (!item || !formData) return;

    if (!formData.eventTitle?.trim()) {
      showWarning('Event title is required');
      return;
    }
    if (!formData.startDate || !formData.endDate) {
      showWarning('Start date and end date are required');
      return;
    }
    if (!formData.startTime || !formData.endTime) {
      showWarning('Start time and end time are required');
      return;
    }

    setSavingPendingEdit(true);
    try {
      const payload = {
        _version: reviewModal.eventVersion,
        eventTitle: formData.eventTitle || '',
        eventDescription: formData.eventDescription || '',
        startDateTime: `${formData.startDate}T${formData.startTime}`,
        endDateTime: `${formData.endDate}T${formData.endTime}`,
        startDate: formData.startDate,
        startTime: formData.startTime,
        endDate: formData.endDate,
        endTime: formData.endTime,
        attendeeCount: parseInt(formData.attendeeCount) || 0,
        requestedRooms: formData.requestedRooms || formData.locations || [],
        specialRequirements: formData.specialRequirements || '',
        department: formData.department || '',
        phone: formData.phone || '',
        setupTime: formData.setupTime || null,
        teardownTime: formData.teardownTime || null,
        doorOpenTime: formData.doorOpenTime || null,
        doorCloseTime: formData.doorCloseTime || null,
        categories: formData.categories || [],
        services: formData.services || {},
        virtualMeetingUrl: formData.virtualMeetingUrl || null,
        isOffsite: formData.isOffsite || false,
        offsiteName: formData.offsiteName || '',
        offsiteAddress: formData.offsiteAddress || '',
      };

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/room-reservations/${item._id}/edit`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify(payload)
        }
      );

      if (response.status === 409) {
        const errorData = await response.json();
        if (errorData.error === 'SchedulingConflict') {
          showError(`Cannot save: ${errorData.conflicts?.length || 0} scheduling conflict(s). Adjust times or rooms.`);
          return;
        }
        throw new Error(errorData.error || 'Conflict detected');
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save changes');
      }

      showSuccess('Reservation updated successfully');
      reviewModal.closeModal(true);
      loadMyReservations();
    } catch (err) {
      logger.error('Error saving pending edit:', err);
      showError(err, { context: 'MyReservations.handleSavePendingEdit' });
    } finally {
      setSavingPendingEdit(false);
    }
  }, [reviewModal, apiToken, loadMyReservations, showWarning, showSuccess, showError]);

  // Save Rejected Edit (owner editing rejected events + resubmitting) — used by ReviewModal's onSaveRejectedEdit button
  const handleSaveRejectedEdit = useCallback(async () => {
    const item = reviewModal.currentItem;
    const formData = reviewModal.editableData;
    if (!item || !formData) return;

    if (!formData.eventTitle?.trim()) {
      showWarning('Event title is required');
      return;
    }
    if (!formData.startDate || !formData.endDate) {
      showWarning('Start date and end date are required');
      return;
    }
    if (!formData.startTime || !formData.endTime) {
      showWarning('Start time and end time are required');
      return;
    }

    setSavingRejectedEdit(true);
    try {
      const payload = {
        _version: reviewModal.eventVersion,
        eventTitle: formData.eventTitle || '',
        eventDescription: formData.eventDescription || '',
        startDateTime: `${formData.startDate}T${formData.startTime}`,
        endDateTime: `${formData.endDate}T${formData.endTime}`,
        startDate: formData.startDate,
        startTime: formData.startTime,
        endDate: formData.endDate,
        endTime: formData.endTime,
        attendeeCount: parseInt(formData.attendeeCount) || 0,
        requestedRooms: formData.requestedRooms || formData.locations || [],
        specialRequirements: formData.specialRequirements || '',
        department: formData.department || '',
        phone: formData.phone || '',
        setupTime: formData.setupTime || null,
        teardownTime: formData.teardownTime || null,
        doorOpenTime: formData.doorOpenTime || null,
        doorCloseTime: formData.doorCloseTime || null,
        categories: formData.categories || [],
        services: formData.services || {},
        virtualMeetingUrl: formData.virtualMeetingUrl || null,
        isOffsite: formData.isOffsite || false,
        offsiteName: formData.offsiteName || '',
        offsiteAddress: formData.offsiteAddress || '',
      };

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/room-reservations/${item._id}/edit`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify(payload)
        }
      );

      if (response.status === 409) {
        const errorData = await response.json();
        if (errorData.error === 'SchedulingConflict') {
          showError(`Cannot save: ${errorData.conflicts?.length || 0} scheduling conflict(s). Adjust times or rooms.`);
          return;
        }
        throw new Error(errorData.error || 'Conflict detected');
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save changes');
      }

      showSuccess(`"${item.eventTitle}" updated and resubmitted for review`);
      reviewModal.closeModal(true);
      loadMyReservations();
    } catch (err) {
      logger.error('Error saving rejected edit:', err);
      showError(err, { context: 'MyReservations.handleSaveRejectedEdit' });
    } finally {
      setSavingRejectedEdit(false);
    }
  }, [reviewModal, apiToken, loadMyReservations, showWarning, showSuccess, showError]);

  // Edit request handlers (requester requesting edits on published events)
  const handleRequestEdit = useCallback(() => {
    // Store the original data before enabling edit mode (for inline diff)
    const currentData = reviewModal.editableData;
    if (currentData) {
      setOriginalEventData(JSON.parse(JSON.stringify(currentData)));
    }
    setIsEditRequestMode(true);
  }, [reviewModal.editableData]);

  const handleCancelEditRequest = useCallback(() => {
    setIsEditRequestMode(false);
    setEditRequestChangeReason('');
  }, []);

  const handleSubmitEditRequest = useCallback(async () => {
    const item = reviewModal.currentItem;
    const formData = reviewModal.editableData;
    if (!item || !formData) return;

    if (!formData.eventTitle?.trim()) {
      showWarning('Event title is required');
      return;
    }

    setSubmittingEditRequest(true);
    try {
      const payload = {
        _version: reviewModal.eventVersion,
        eventTitle: formData.eventTitle || '',
        eventDescription: formData.eventDescription || '',
        startDateTime: formData.startDate && formData.startTime
          ? `${formData.startDate}T${formData.startTime}` : null,
        endDateTime: formData.endDate && formData.endTime
          ? `${formData.endDate}T${formData.endTime}` : null,
        attendeeCount: parseInt(formData.attendeeCount) || 0,
        requestedRooms: formData.requestedRooms || formData.locations || [],
        specialRequirements: formData.specialRequirements || '',
        department: formData.department || '',
        phone: formData.phone || '',
        setupTime: formData.setupTime || null,
        teardownTime: formData.teardownTime || null,
        doorOpenTime: formData.doorOpenTime || null,
        doorCloseTime: formData.doorCloseTime || null,
        categories: formData.categories || [],
        services: formData.services || {},
        virtualMeetingUrl: formData.virtualMeetingUrl || null,
        isOffsite: formData.isOffsite || false,
        offsiteName: formData.offsiteName || '',
        offsiteAddress: formData.offsiteAddress || '',
      };

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/events/${item._id}/request-edit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify(payload)
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit edit request');
      }

      showSuccess('Edit request submitted');
      setIsEditRequestMode(false);
      setEditRequestChangeReason('');
      reviewModal.closeModal(true);
      loadMyReservations();
    } catch (err) {
      logger.error('Error submitting edit request:', err);
      showError(err, { context: 'MyReservations.handleSubmitEditRequest' });
    } finally {
      setSubmittingEditRequest(false);
    }
  }, [reviewModal, apiToken, loadMyReservations, showWarning, showSuccess, showError]);

  // Show loading while permissions are being determined
  if (permissionsLoading) {
    return <LoadingSpinner />;
  }

  // Access control - hide for Viewer role
  if (!canSubmitReservation) {
    return (
      <div className="my-reservations">
        <div className="access-denied">
          <h2>Access Restricted</h2>
          <p>You do not have permission to view reservations.</p>
        </div>
      </div>
    );
  }

  if (loading && allReservations.length === 0) {
    return <LoadingSpinner />;
  }

  // Determine ReviewModal title
  const getModalTitle = () => {
    const item = reviewModal.currentItem;
    if (!item) return 'Event Details';
    const status = item.status;
    const title = reviewModal.editableData?.eventTitle || item.eventTitle || 'Event';
    if (reviewModal.isDraft) return `Edit Draft: ${title}`;
    if (status === 'pending') return `${isRequesterOnly ? 'View' : 'Review'} Pending: ${title}`;
    return `${isRequesterOnly ? 'View' : 'Edit'} ${title}`;
  };

  return (
    <div className="my-reservations">
      {/* Page Header - Editorial Style */}
      <div className="my-reservations-header">
        <div className="my-reservations-header-content">
          <h1>My Reservations</h1>
          <p className="my-reservations-header-subtitle">Track and manage your room reservation requests</p>
        </div>
        <button
          className="new-reservation-btn"
          onClick={() => window.dispatchEvent(new CustomEvent('open-new-reservation-modal'))}
          disabled={!canSubmitReservation}
          title={!canSubmitReservation ? 'You do not have permission to submit reservations' : 'Create a new reservation request'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14"></path>
          </svg>
          New Reservation
        </button>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="tabs-container">
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'draft' ? 'active' : ''}`}
            onClick={() => handleTabChange('draft')}
          >
            Draft
            <span className="count draft-count">({statusCounts.draft})</span>
          </button>
          <button
            className={`tab ${activeTab === 'pending' ? 'active' : ''}`}
            onClick={() => handleTabChange('pending')}
          >
            Pending
            <span className="count">({statusCounts.pending})</span>
          </button>
          <button
            className={`tab ${activeTab === 'published' ? 'active' : ''}`}
            onClick={() => handleTabChange('published')}
          >
            Published
            <span className="count">({statusCounts.published})</span>
          </button>
          <button
            className={`tab ${activeTab === 'published_edit' ? 'active' : ''}`}
            onClick={() => handleTabChange('published_edit')}
          >
            Published Edit
            <span className="count">({statusCounts.published_edit})</span>
          </button>
          <button
            className={`tab ${activeTab === 'rejected' ? 'active' : ''}`}
            onClick={() => handleTabChange('rejected')}
          >
            Rejected
            <span className="count">({statusCounts.rejected})</span>
          </button>
          <button
            className={`tab ${activeTab === 'cancelled' ? 'active' : ''}`}
            onClick={() => handleTabChange('cancelled')}
          >
            Cancelled
            <span className="count">({statusCounts.cancelled})</span>
          </button>
          <button
            className={`tab ${activeTab === 'deleted' ? 'active' : ''}`}
            onClick={() => handleTabChange('deleted')}
          >
            Deleted
            <span className="count">({statusCounts.deleted})</span>
          </button>
        </div>
      </div>

      {/* Reservations List */}
      <div className="mr-reservations-list">
        {paginatedReservations.map(reservation => {
          const isOnBehalfOf = reservation.roomReservationData?.contactPerson?.isOnBehalfOf;
          const contactName = reservation.roomReservationData?.contactPerson?.name;
          const isDraft = reservation.status === 'draft';

          return (
            <div key={reservation._id} className={`mr-card ${isDraft ? 'mr-card-draft' : ''}`}>
              {/* Card Header - Event Title + Actions */}
              <div className="mr-card-header">
                <div className="mr-card-title-row">
                  <h3 className="mr-card-title">{reservation.eventTitle || 'Untitled'}</h3>
                  {reservation.attendeeCount > 0 && (
                    <span className="mr-attendee-pill">{reservation.attendeeCount} attendees</span>
                  )}
                  {isOnBehalfOf && contactName && (
                    <span className="mr-delegation-pill">On behalf of {contactName}</span>
                  )}
                </div>
                <div className="mr-card-actions">
                  <button
                    className="mr-btn mr-btn-primary"
                    onClick={() => reviewModal.openModal(reservation)}
                  >
                    View Details
                  </button>
                </div>
              </div>

              {/* Card Body - Key Info Grid */}
              <div className="mr-card-body">
                {/* When */}
                <div className="mr-info-block">
                  <span className="mr-info-label">When</span>
                  <div className="mr-info-value mr-datetime">
                    {reservation.startDateTime && reservation.endDateTime ? (
                      <>
                        <span className="mr-date">
                          {new Date(reservation.startDateTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </span>
                        <span className="mr-time">
                          {new Date(reservation.startDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          {' – '}
                          {new Date(reservation.endDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        </span>
                      </>
                    ) : (
                      <span className="mr-not-set">Not set</span>
                    )}
                  </div>
                </div>

                {/* Where */}
                <div className="mr-info-block">
                  <span className="mr-info-label">Where</span>
                  <div className="mr-info-value mr-rooms">
                    {reservation.requestedRooms && reservation.requestedRooms.length > 0 ? (
                      reservation.requestedRooms.map(roomId => {
                        const roomDetails = getRoomDetails(roomId);
                        return (
                          <span key={roomId} className="mr-room-tag" title={roomDetails.location || ''}>
                            {roomDetails.name}
                          </span>
                        );
                      })
                    ) : (
                      <span className="mr-not-set">None selected</span>
                    )}
                  </div>
                </div>

                {/* Categories */}
                <div className="mr-info-block">
                  <span className="mr-info-label">Categories</span>
                  <div className="mr-info-value mr-categories">
                    {reservation.categories && reservation.categories.length > 0 ? (
                      reservation.categories.map((cat, i) => (
                        <span key={i} className="mr-category-tag">{cat}</span>
                      ))
                    ) : (
                      <span className="mr-not-set">—</span>
                    )}
                  </div>
                </div>

                {/* Submitted/Saved */}
                <div className="mr-info-block">
                  <span className="mr-info-label">{isDraft ? 'Saved' : 'Submitted'}</span>
                  <div className="mr-info-value mr-submitted">
                    {new Date(isDraft
                      ? (reservation.lastDraftSaved || reservation.submittedAt)
                      : reservation.submittedAt
                    ).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>

                {/* Status Info (contextual) */}
                <div className="mr-info-block">
                  <span className="mr-info-label">
                    {isDraft ? 'Expires' : reservation.reviewNotes ? 'Reason' : 'Last Modified'}
                  </span>
                  <div className="mr-info-value mr-status-info">
                    {isDraft && reservation.draftCreatedAt ? (
                      <span className="mr-expires">in {getDaysUntilDelete(reservation.draftCreatedAt)} days</span>
                    ) : reservation.reviewNotes ? (
                      <span className="mr-rejection" title={reservation.reviewNotes}>{reservation.reviewNotes}</span>
                    ) : (reservation.actionDate || reservation.lastModifiedDateTime) ? (
                      <span>{new Date(reservation.actionDate || reservation.lastModifiedDateTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    ) : (
                      <span className="mr-not-set">&mdash;</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Description Preview (if exists) */}
              {reservation.eventDescription && (
                <div className="mr-card-description">
                  {reservation.eventDescription}
                </div>
              )}
            </div>
          );
        })}

        {paginatedReservations.length === 0 && !loading && (
          <div className="mr-empty-state">
            <div className="mr-empty-icon">
              {activeTab === 'draft' ? '📝' : activeTab === 'pending' ? '⏳' : activeTab === 'published' ? '✅' : activeTab === 'rejected' ? '❌' : activeTab === 'deleted' ? '🗑️' : '📁'}
            </div>
            <h3>No {activeTab === 'published_edit' ? 'pending edits' : activeTab} reservations</h3>
            <p>
              {activeTab === 'draft'
                ? "You don't have any saved drafts."
                : activeTab === 'pending'
                ? "You don't have any pending requests."
                : activeTab === 'published'
                ? "You don't have any published reservations."
                : activeTab === 'published_edit'
                ? "No reservations with pending edit requests."
                : activeTab === 'rejected'
                ? "You don't have any rejected reservations."
                : activeTab === 'deleted'
                ? "You don't have any deleted reservations."
                : `You don't have any ${activeTab} reservations.`}
            </p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <button
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span className="page-info">Page {page} of {totalPages}</span>
          <button
            disabled={page === totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}

      {/* ReviewModal — unified event form (replaces old details-modal) */}
      <ReviewModal
        isOpen={reviewModal.isOpen}
        title={getModalTitle()}
        onClose={reviewModal.closeModal}
        // Admin/approver actions from hook
        onApprove={!isRequesterOnly ? reviewModal.handleApprove : null}
        onReject={!isRequesterOnly ? reviewModal.handleReject : null}
        onSave={!isRequesterOnly && !reviewModal.isDraft && reviewModal.currentItem?.status !== 'pending' ? reviewModal.handleSave : null}
        onDelete={!isRequesterOnly ? reviewModal.handleDelete : null}
        // Mode and status
        mode={reviewModal.currentItem?.status === 'pending' ? 'review' : 'edit'}
        isPending={reviewModal.currentItem?.status === 'pending'}
        isFormValid={reviewModal.isFormValid}
        isSaving={reviewModal.isSaving}
        isDeleting={reviewModal.isDeleting}
        isApproving={reviewModal.isApproving}
        showActionButtons={true}
        isRequesterOnly={isRequesterOnly}
        itemStatus={reviewModal.currentItem?.status || null}
        eventVersion={reviewModal.eventVersion}
        hasChanges={isEditRequestMode ? reviewModal.hasChanges : reviewModal.hasChanges}
        // Admin confirmation states from hook
        isDeleteConfirming={reviewModal.pendingDeleteConfirmation}
        onCancelDelete={reviewModal.cancelDeleteConfirmation}
        isApproveConfirming={reviewModal.pendingApproveConfirmation}
        onCancelApprove={reviewModal.cancelApproveConfirmation}
        isRejectConfirming={reviewModal.pendingRejectConfirmation}
        onCancelReject={reviewModal.cancelRejectConfirmation}
        isRejecting={reviewModal.isRejecting}
        rejectionReason={reviewModal.rejectionReason}
        onRejectionReasonChange={reviewModal.setRejectionReason}
        isSaveConfirming={reviewModal.pendingSaveConfirmation}
        onCancelSave={reviewModal.cancelSaveConfirmation}
        // Requester action buttons (Phase 2 props)
        onCancelRequest={isRequesterOnly && reviewModal.currentItem?.status === 'pending' ? handleCancelRequest : null}
        isCancellingRequest={isCancellingRequest}
        cancelRequestReason={cancelRequestReason}
        onCancelRequestReasonChange={setCancelRequestReason}
        onResubmit={isRequesterOnly && reviewModal.currentItem?.status === 'rejected' ? handleResubmit : null}
        isResubmitting={isResubmitting}
        onRestore={isRequesterOnly && ['deleted', 'cancelled'].includes(reviewModal.currentItem?.status) ? handleRestore : null}
        isRestoring={isRestoring}
        // Owner pending edit (requester editing their own pending event)
        onSavePendingEdit={isRequesterOnly && reviewModal.currentItem?.status === 'pending' ? handleSavePendingEdit : null}
        savingPendingEdit={savingPendingEdit}
        // Rejected edit props (editing rejected events + resubmitting)
        onSaveRejectedEdit={isRequesterOnly && reviewModal.currentItem?.status === 'rejected' ? handleSaveRejectedEdit : null}
        savingRejectedEdit={savingRejectedEdit}
        // Existing edit request props (viewing pending edit requests)
        existingEditRequest={existingEditRequest}
        isViewingEditRequest={isViewingEditRequest}
        loadingEditRequest={loadingEditRequest}
        onViewEditRequest={handleViewEditRequest}
        onViewOriginalEvent={handleViewOriginalEvent}
        // Edit request props (requester requesting edits on published events)
        canRequestEdit={isRequesterOnly && reviewModal.currentItem?.status === 'published' && !reviewModal.currentItem?.pendingEditRequest?.status && !isEditRequestMode && !isViewingEditRequest}
        onRequestEdit={handleRequestEdit}
        isEditRequestMode={isEditRequestMode}
        editRequestChangeReason={editRequestChangeReason}
        onEditRequestChangeReasonChange={setEditRequestChangeReason}
        onSubmitEditRequest={handleSubmitEditRequest}
        onCancelEditRequest={handleCancelEditRequest}
        isSubmittingEditRequest={submittingEditRequest}
        detectedChanges={reviewModal.hasChanges ? [{ field: 'changes' }] : []}
        // Edit request submission via modal button
        onSubmitEditRequestModal={isEditRequestMode ? handleSubmitEditRequest : null}
        submittingEditRequestModal={submittingEditRequest}
        // Draft props from hook
        isDraft={reviewModal.isDraft}
        onSaveDraft={reviewModal.isDraft ? reviewModal.handleSaveDraft : null}
        savingDraft={reviewModal.savingDraft}
        isDraftConfirming={reviewModal.pendingDraftConfirmation}
        onCancelDraft={reviewModal.cancelDraftConfirmation}
        canSaveDraft={reviewModal.canSaveDraft}
        showDraftDialog={reviewModal.showDraftDialog}
        onDraftDialogSave={reviewModal.handleDraftDialogSave}
        onDraftDialogDiscard={reviewModal.handleDraftDialogDiscard}
        onDraftDialogCancel={reviewModal.handleDraftDialogCancel}
        onSubmitDraft={reviewModal.isDraft ? reviewModal.handleSubmitDraft : null}
        // Scheduling conflicts
        hasSchedulingConflicts={hasSchedulingConflicts}
        // Inline diff data (flat-transformed for comparison with formData)
        originalData={flatOriginalEventData}
      >
        {reviewModal.currentItem && (
          <RoomReservationReview
            reservation={reviewModal.editableData}
            prefetchedAvailability={reviewModal.prefetchedAvailability}
            apiToken={apiToken}
            onDataChange={reviewModal.updateData}
            onFormDataReady={reviewModal.setFormDataGetter}
            onFormValidChange={reviewModal.setIsFormValid}
            readOnly={!canEditEvents && !canApproveReservations && !isEditRequestMode && !reviewModal.isDraft && reviewModal.currentItem?.status !== 'pending' && reviewModal.currentItem?.status !== 'rejected'}
            editScope={reviewModal.editScope}
            onSchedulingConflictsChange={setHasSchedulingConflicts}
          />
        )}
      </ReviewModal>

      {/* Conflict Dialog for version conflicts */}
      <ConflictDialog
        isOpen={!!reviewModal.conflictInfo}
        onClose={() => {
          reviewModal.dismissConflict();
          reviewModal.closeModal(true);
          loadMyReservations();
        }}
        onRefresh={() => {
          reviewModal.dismissConflict();
          reviewModal.closeModal(true);
          loadMyReservations();
        }}
        conflictType={reviewModal.conflictInfo?.conflictType}
        eventTitle={reviewModal.conflictInfo?.eventTitle}
        details={reviewModal.conflictInfo?.details}
        staleData={reviewModal.conflictInfo?.staleData}
      />

      {/* Scheduling Conflict Modal (for restore conflicts) */}
      {restoreConflicts && (
        <div className="mr-modal-overlay" onClick={() => setRestoreConflicts(null)}>
          <div className="mr-scheduling-conflict-modal" onClick={e => e.stopPropagation()}>
            <h3>Scheduling Conflict</h3>
            <p>
              Cannot restore &quot;{restoreConflicts.eventTitle}&quot; because
              {' '}{restoreConflicts.conflicts.length} conflicting event{restoreConflicts.conflicts.length > 1 ? 's' : ''} now
              {' '}occupy the same room and time.
            </p>
            <ul className="mr-conflict-list">
              {restoreConflicts.conflicts.map(c => (
                <li key={c.id}>
                  <strong>{c.eventTitle}</strong>
                  <span className="mr-conflict-time">
                    {formatDateTime(c.startDateTime)} &ndash; {formatDateTime(c.endDateTime)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mr-conflict-guidance">
              Please submit a new reservation with different times, or contact an admin to override.
            </p>
            <div className="mr-conflict-actions">
              <button
                className="mr-btn-close"
                onClick={() => setRestoreConflicts(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
