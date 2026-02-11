// src/components/EventManagement.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { usePermissions } from '../hooks/usePermissions';
import { useNotification } from '../context/NotificationContext';
import { useRooms } from '../context/LocationContext';
import ConflictDialog from './shared/ConflictDialog';
import APP_CONFIG from '../config/config';
import './EventManagement.css';

const TABS = [
  { key: 'all', label: 'All', statusParam: 'all' },
  { key: 'published', label: 'Published', statusParam: 'published' },
  { key: 'pending', label: 'Pending', statusParam: 'pending' },
  { key: 'approved', label: 'Approved', statusParam: 'approved' },
  { key: 'rejected', label: 'Rejected', statusParam: 'rejected' },
  { key: 'deleted', label: 'Deleted', statusParam: 'deleted' },
];

const PAGE_SIZE = 20;

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  try {
    const [h, m] = timeStr.split(':');
    const d = new Date();
    d.setHours(parseInt(h), parseInt(m));
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return timeStr;
  }
}

export default function EventManagement({ apiToken }) {
  const { isAdmin } = usePermissions();
  const { showSuccess, showError } = useNotification();
  const { getRoomName } = useRooms();

  // Data state
  const [events, setEvents] = useState([]);
  const [counts, setCounts] = useState({ total: 0, published: 0, pending: 0, approved: 0, rejected: 0, deleted: 0, draft: 0 });
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);

  // Filter state
  const [activeTab, setActiveTab] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);

  // UI state
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [restoringId, setRestoringId] = useState(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState(null);
  const [conflictDialog, setConflictDialog] = useState(null);

  const searchTimeoutRef = useRef(null);
  const debouncedSearchRef = useRef('');

  // Fetch counts
  const fetchCounts = useCallback(async () => {
    if (!apiToken) return;
    try {
      const res = await fetch(`${APP_CONFIG.API_BASE_URL}/events/list/counts?view=admin-browse`, {
        headers: { Authorization: `Bearer ${apiToken}` }
      });
      if (res.ok) {
        setCounts(await res.json());
      }
    } catch {
      // Silently fail
    }
  }, [apiToken]);

  // Fetch events
  const fetchEvents = useCallback(async () => {
    if (!apiToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        status: activeTab === 'all' ? 'all' : TABS.find(t => t.key === activeTab)?.statusParam || 'all',
      });
      if (debouncedSearchRef.current) params.set('search', debouncedSearchRef.current);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const res = await fetch(`${APP_CONFIG.API_BASE_URL}/events/list?view=admin-browse&${params}`, {
        headers: { Authorization: `Bearer ${apiToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
        const total = data.pagination?.totalCount || data.total || 0;
        setTotalPages(Math.max(1, Math.ceil(total / PAGE_SIZE)));
      }
    } catch (err) {
      showError(err, { context: 'EventManagement.fetchEvents' });
    } finally {
      setLoading(false);
    }
  }, [apiToken, page, activeTab, startDate, endDate, showError]);

  // Initial load
  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      debouncedSearchRef.current = searchTerm;
      setPage(1);
      fetchEvents();
    }, 500);
    return () => clearTimeout(searchTimeoutRef.current);
  }, [searchTerm]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page when tab or dates change
  useEffect(() => {
    setPage(1);
    setSelectedEvent(null);
  }, [activeTab, startDate, endDate]);

  // Get location display for an event
  const getLocationDisplay = (event) => {
    // Try locationDisplayNames first (array of strings, or single string)
    if (Array.isArray(event.locationDisplayNames) && event.locationDisplayNames.length > 0) {
      return event.locationDisplayNames.join(', ');
    }
    if (typeof event.locationDisplayNames === 'string' && event.locationDisplayNames) {
      return event.locationDisplayNames;
    }
    // Try locations array (ObjectIds) with room name resolution
    if (Array.isArray(event.locations) && event.locations.length > 0) {
      const names = event.locations.map(id => getRoomName(String(id)) || String(id));
      return names.join(', ');
    }
    // Try graphData location
    if (event.graphData?.location?.displayName) {
      return event.graphData.location.displayName;
    }
    // Try calendarData
    if (event.calendarData?.locationDisplayName) {
      return event.calendarData.locationDisplayName;
    }
    return '—';
  };

  // Get requester display
  const getRequester = (event) => {
    return event.calendarData?.requesterName
      || event.roomReservationData?.requesterName
      || event.roomReservationData?.requestedBy?.name
      || event.createdBy
      || '—';
  };

  // Get event date range display
  const getDateDisplay = (event) => {
    const start = event.calendarData?.startDateTime || event.startDateTime || event.graphData?.start?.dateTime;
    const end = event.calendarData?.endDateTime || event.endDateTime || event.graphData?.end?.dateTime;
    if (!start) return '—';
    const startStr = formatDate(start);
    const startTime = event.calendarData?.startTime || event.startTime || '';
    const endTime = event.calendarData?.endTime || event.endTime || '';
    if (startTime && endTime) {
      return `${startStr}, ${formatTime(startTime)} – ${formatTime(endTime)}`;
    }
    if (end) {
      return `${startStr} – ${formatDate(end)}`;
    }
    return startStr;
  };

  // Get event title
  const getTitle = (event) => {
    return event.calendarData?.eventTitle || event.eventTitle || event.graphData?.subject || 'Untitled Event';
  };

  // Handle delete (admin)
  const handleDeleteClick = (event) => {
    if (confirmDeleteId === String(event._id)) {
      handleDelete(event);
    } else {
      setConfirmDeleteId(String(event._id));
      setTimeout(() => {
        setConfirmDeleteId(prev => prev === String(event._id) ? null : prev);
      }, 3000);
    }
  };

  const handleDelete = async (event) => {
    const eventId = String(event._id);
    try {
      setDeletingId(eventId);
      setConfirmDeleteId(null);
      const res = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/events/${eventId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ _version: event._version }),
      });

      if (res.status === 409) {
        const conflict = await res.json();
        setConflictDialog({
          ...conflict,
          eventTitle: getTitle(event),
          staleData: event,
        });
        return;
      }

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete event');
      }

      showSuccess(`"${getTitle(event)}" deleted`);
      setSelectedEvent(null);
      fetchEvents();
      fetchCounts();
    } catch (err) {
      showError(err, { context: 'EventManagement.handleDelete' });
    } finally {
      setDeletingId(null);
    }
  };

  // Handle restore (admin)
  const handleRestoreClick = (event) => {
    if (confirmRestoreId === String(event._id)) {
      handleRestore(event);
    } else {
      setConfirmRestoreId(String(event._id));
      setTimeout(() => {
        setConfirmRestoreId(prev => prev === String(event._id) ? null : prev);
      }, 3000);
    }
  };

  const handleRestore = async (event) => {
    const eventId = String(event._id);
    try {
      setRestoringId(eventId);
      setConfirmRestoreId(null);
      const res = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/events/${eventId}/restore`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ _version: event._version }),
      });

      if (res.status === 409) {
        const conflict = await res.json();
        setConflictDialog({
          ...conflict,
          eventTitle: getTitle(event),
          staleData: event,
        });
        return;
      }

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to restore event');
      }

      const data = await res.json();
      showSuccess(`"${getTitle(event)}" restored to ${data.status}`);
      setSelectedEvent(null);
      fetchEvents();
      fetchCounts();
    } catch (err) {
      showError(err, { context: 'EventManagement.handleRestore' });
    } finally {
      setRestoringId(null);
    }
  };

  // Handle conflict dialog close
  const handleConflictClose = () => {
    setConflictDialog(null);
    fetchEvents();
    fetchCounts();
  };

  // Tab count lookup
  const getTabCount = (key) => {
    switch (key) {
      case 'all': return counts.total;
      case 'published': return counts.published;
      case 'pending': return counts.pending;
      case 'approved': return counts.approved;
      case 'rejected': return counts.rejected;
      case 'deleted': return counts.deleted;
      default: return 0;
    }
  };

  // Access denied
  if (!isAdmin) {
    return (
      <div className="em-access-denied">
        <div className="em-access-denied-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        </div>
        <h2>Access Denied</h2>
        <p>You need admin privileges to access Event Management.</p>
      </div>
    );
  }

  return (
    <div className="em-container">
      {/* Page Header */}
      <div className="em-page-header">
        <h2>Event Management</h2>
        <p className="em-page-header-subtitle">Browse, search, and manage all events across the system</p>
      </div>

      {/* Stats Cards */}
      <div className="em-stats-row">
        <div className="em-stat-card total">
          <div className="em-stat-icon total">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div className="em-stat-content">
            <h4>{counts.total.toLocaleString()}</h4>
            <p>Total Events</p>
          </div>
        </div>
        <div className="em-stat-card published">
          <div className="em-stat-icon published">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div className="em-stat-content">
            <h4>{counts.published.toLocaleString()}</h4>
            <p>Published Events</p>
          </div>
        </div>
        <div className="em-stat-card deleted">
          <div className="em-stat-icon deleted">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </div>
          <div className="em-stat-content">
            <h4>{counts.deleted.toLocaleString()}</h4>
            <p>Deleted Events</p>
          </div>
        </div>
      </div>

      {/* Controls Row */}
      <div className="em-controls-row">
        <div className="em-search-container">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="em-search-input"
            placeholder="Search events by title, description, or location..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="em-date-filters">
          <label>From</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <label>To</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="em-tabs">
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`em-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            <span className="em-tab-count">{getTabCount(tab.key).toLocaleString()}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="em-loading">
          <div className="em-loading-spinner" />
          <p>Loading events...</p>
        </div>
      ) : events.length === 0 ? (
        <div className="em-empty-state">
          <div className="em-empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <h3>No events found</h3>
          <p>
            {activeTab === 'deleted'
              ? 'No deleted events to display.'
              : searchTerm
                ? `No events match "${searchTerm}".`
                : 'No events match the current filters.'}
          </p>
        </div>
      ) : (
        <>
          {/* Event Cards */}
          <div className="em-events-grid">
            {events.map(event => {
              const eventId = String(event._id);
              const status = event.status || 'draft';
              const isDeleted = event.isDeleted || status === 'deleted';

              return (
                <div
                  key={eventId}
                  className={`em-event-card status-${status}`}
                >
                  {/* Card Header */}
                  <div className="em-event-card-header">
                    <div className="em-card-title-row">
                      <h3>{getTitle(event)}</h3>
                      <span className={`em-status-badge ${status}`}>
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </span>
                    </div>
                    <button
                      className="em-view-details-btn"
                      onClick={() => setSelectedEvent(event)}
                    >
                      View Details
                    </button>
                  </div>

                  {/* Info Grid */}
                  <div className="em-event-info">
                    <div className="em-event-info-item">
                      <span className="em-event-info-label">When</span>
                      <span className="em-event-info-value">{getDateDisplay(event)}</span>
                    </div>
                    <div className="em-event-info-item">
                      <span className="em-event-info-label">Where</span>
                      <span className="em-event-info-value">{getLocationDisplay(event)}</span>
                    </div>
                    <div className="em-event-info-item">
                      <span className="em-event-info-label">Requested By</span>
                      <span className="em-event-info-value">{getRequester(event)}</span>
                    </div>
                    {isDeleted && event.deletedAt && (
                      <div className="em-event-info-item">
                        <span className="em-event-info-label">Deleted At</span>
                        <span className="em-event-info-value">{formatDateTime(event.deletedAt)}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="em-pagination">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                Previous
              </button>
              <span className="em-pagination-info">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* Details Modal */}
      {selectedEvent && (() => {
        const event = selectedEvent;
        const eventId = String(event._id);
        const status = event.status || 'draft';
        const isDeleted = event.isDeleted || status === 'deleted';
        const requesterEmail = event.calendarData?.requesterEmail || event.roomReservationData?.requesterEmail || event.roomReservationData?.requestedBy?.email || '';
        const department = event.calendarData?.department || event.roomReservationData?.department || event.roomReservationData?.requestedBy?.department || '';
        const phone = event.calendarData?.phone || event.roomReservationData?.phone || event.roomReservationData?.requestedBy?.phone || '';
        const description = event.calendarData?.eventDescription || event.eventDescription || '';
        const categories = event.calendarData?.categories || event.categories || [];
        const setupTime = event.calendarData?.setupTime || event.setupTime || '';
        const teardownTime = event.calendarData?.teardownTime || event.teardownTime || '';
        const doorOpenTime = event.calendarData?.doorOpenTime || event.doorOpenTime || '';
        const doorCloseTime = event.calendarData?.doorCloseTime || event.doorCloseTime || '';
        const notes = event.roomReservationData?.internalNotes?.eventNotes || event.calendarData?.eventNotes || event.eventNotes || '';

        return (
          <div className="em-details-modal-overlay" onClick={() => setSelectedEvent(null)}>
            <div className="em-details-modal" onClick={(e) => e.stopPropagation()}>
              <h2>Event Details</h2>

              <div className="em-details-body">
                {/* Core Info */}
                <div className="em-detail-row">
                  <label>Event</label>
                  <span>{getTitle(event)}</span>
                </div>
                <div className="em-detail-row">
                  <label>Date & Time</label>
                  <span>{getDateDisplay(event)}</span>
                </div>
                <div className="em-detail-row">
                  <label>Location</label>
                  <span>{getLocationDisplay(event)}</span>
                </div>
                <div className="em-detail-row">
                  <label>Status</label>
                  <span>
                    <span className={`em-status-badge ${status}`}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </span>
                  </span>
                </div>

                {/* Requester Info */}
                <div className="em-detail-row">
                  <label>Requested By</label>
                  <span>{getRequester(event)}</span>
                </div>
                {requesterEmail && (
                  <div className="em-detail-row">
                    <label>Email</label>
                    <span>{requesterEmail}</span>
                  </div>
                )}
                {department && (
                  <div className="em-detail-row">
                    <label>Department</label>
                    <span>{department}</span>
                  </div>
                )}
                {phone && (
                  <div className="em-detail-row">
                    <label>Phone</label>
                    <span>{phone}</span>
                  </div>
                )}

                {/* Description */}
                {description && (
                  <div className="em-detail-row">
                    <label>Description</label>
                    <span>{description}</span>
                  </div>
                )}

                {/* Categories */}
                {categories.length > 0 && (
                  <div className="em-detail-row">
                    <label>Categories</label>
                    <span>{categories.join(', ')}</span>
                  </div>
                )}

                {/* Timing */}
                {(setupTime || teardownTime) && (
                  <div className="em-detail-row">
                    <label>Setup / Teardown</label>
                    <span>
                      {setupTime && `Setup: ${formatTime(setupTime)}`}
                      {setupTime && teardownTime && ' · '}
                      {teardownTime && `Teardown: ${formatTime(teardownTime)}`}
                    </span>
                  </div>
                )}
                {(doorOpenTime || doorCloseTime) && (
                  <div className="em-detail-row">
                    <label>Doors</label>
                    <span>
                      {doorOpenTime && `Open: ${formatTime(doorOpenTime)}`}
                      {doorOpenTime && doorCloseTime && ' · '}
                      {doorCloseTime && `Close: ${formatTime(doorCloseTime)}`}
                    </span>
                  </div>
                )}

                {/* Notes */}
                {notes && (
                  <div className="em-detail-row">
                    <label>Notes</label>
                    <span>{notes}</span>
                  </div>
                )}

                {/* Deletion Info */}
                {isDeleted && (event.deletedByEmail || event.deletedAt) && (
                  <div className="em-deletion-info">
                    {event.deletedByEmail && <div>Deleted by: {event.deletedByEmail}</div>}
                    {event.deletedAt && <div>Deleted at: {formatDateTime(event.deletedAt)}</div>}
                  </div>
                )}

                {/* Status History */}
                {event.statusHistory?.length > 0 && (
                  <div className="em-detail-section">
                    <h4>Status History</h4>
                    <div className="em-status-history">
                      {event.statusHistory.map((entry, idx) => (
                        <div key={idx} className="em-status-history-item">
                          <span className={`em-status-badge ${entry.status}`}>
                            {entry.status}
                          </span>
                          <span className="em-history-date">{formatDateTime(entry.changedAt)}</span>
                          {entry.changedByEmail && (
                            <span>by {entry.changedByEmail}</span>
                          )}
                          {entry.reason && (
                            <span>— {entry.reason}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Actions */}
              <div className="em-modal-actions">
                {isDeleted ? (
                  <button
                    className={`em-restore-btn ${confirmRestoreId === eventId ? 'confirm' : ''}`}
                    onClick={() => handleRestoreClick(event)}
                    disabled={restoringId === eventId}
                  >
                    {restoringId === eventId ? (
                      'Restoring...'
                    ) : confirmRestoreId === eventId ? (
                      'Confirm?'
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="1 4 1 10 7 10" />
                          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                        </svg>
                        Restore
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    className={`em-delete-btn ${confirmDeleteId === eventId ? 'confirm' : ''}`}
                    onClick={() => handleDeleteClick(event)}
                    disabled={deletingId === eventId}
                  >
                    {deletingId === eventId ? (
                      'Deleting...'
                    ) : confirmDeleteId === eventId ? (
                      'Confirm?'
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                        Delete
                      </>
                    )}
                  </button>
                )}
                <button className="em-close-btn" onClick={() => setSelectedEvent(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Conflict Dialog */}
      {conflictDialog && (
        <ConflictDialog
          isOpen={true}
          onClose={handleConflictClose}
          conflictData={conflictDialog}
          staleData={conflictDialog.staleData}
        />
      )}
    </div>
  );
}
