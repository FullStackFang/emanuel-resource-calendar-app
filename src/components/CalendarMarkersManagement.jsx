// src/components/CalendarMarkersManagement.jsx
//
// "Holidays & Closures" screen (admins + Events-department members).
// Create/edit/delete calendar markers
// (holiday / office-closed day annotations). Mutations invalidate
// keys.calendarMarkers so the calendar ribbon refreshes in the same tab (same
// single-tab invalidation contract as Categories — cross-tab freshness waits
// for staleTime). Delete uses the in-button confirmation pattern (no
// window.confirm); feedback via useNotification() toasts.

import React, { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { keys } from '../queries/keys';
import { useCalendarMarkersQuery } from '../hooks/useCalendarMarkersQuery';
import { useNotification } from '../context/NotificationContext';
import LoadingSpinner from './shared/LoadingSpinner';
import DatePickerInput from './DatePickerInput';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';
import './CalendarMarkersManagement.css';

const TYPE_LABELS = { holiday: 'Holiday', officeClosed: 'Office Closed' };

const emptyForm = () => {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return {
    type: 'holiday',
    name: '',
    note: '',
    startDate: iso,
    endDate: iso,
    warnOnReservation: false,
    pushToOutlook: false,
    color: '',
  };
};

const formatRange = (startDate, endDate) =>
  startDate === endDate ? startDate : `${startDate} → ${endDate}`;

export default function CalendarMarkersManagement({ apiToken }) {
  const queryClient = useQueryClient();
  const { showSuccess, showError } = useNotification();
  const { data: markers = [], isLoading } = useCalendarMarkersQuery(apiToken);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState(emptyForm());

  // In-button delete confirmation: id awaiting confirmation, id being deleted.
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const invalidateMarkers = () =>
    queryClient.invalidateQueries({ queryKey: keys.calendarMarkers.all() });

  // Sorted by start date (then name) so the list reads chronologically.
  const sortedMarkers = useMemo(
    () =>
      [...markers].sort(
        (a, b) => (a.startDate || '').localeCompare(b.startDate || '') || (a.name || '').localeCompare(b.name || '')
      ),
    [markers]
  );

  const openCreate = () => {
    setEditing(null);
    setFormData(emptyForm());
    setError('');
    setShowModal(true);
  };

  const openEdit = (marker) => {
    setEditing(marker);
    setFormData({
      type: marker.type,
      name: marker.name || '',
      note: marker.note || '',
      startDate: marker.startDate,
      endDate: marker.endDate,
      warnOnReservation: !!marker.warnOnReservation,
      pushToOutlook: !!marker.pushToOutlook,
      color: marker.color || '',
    });
    setError('');
    setShowModal(true);
  };

  const updateField = (updates) => setFormData((prev) => ({ ...prev, ...updates }));

  // Common-sense date behavior: moving the start date forward past the end date
  // (or onto an empty end) drags the end date along, so a single-day marker is
  // one click and the range can never start out invalid.
  const handleStartDateChange = (e) => {
    const startDate = e.target.value;
    setFormData((prev) => ({
      ...prev,
      startDate,
      endDate: !prev.endDate || prev.endDate < startDate ? startDate : prev.endDate,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError('Name is required');
      return;
    }
    if (formData.endDate < formData.startDate) {
      setError('End date must be on or after the start date');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const url = editing
        ? `${APP_CONFIG.API_BASE_URL}/calendar-markers/${editing._id}`
        : `${APP_CONFIG.API_BASE_URL}/calendar-markers`;
      const method = editing ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
        body: JSON.stringify({
          ...formData,
          name: formData.name.trim(),
          color: formData.color || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save marker');
      }

      const saved = await response.json();
      invalidateMarkers();
      setShowModal(false);
      setEditing(null);
      // The marker write always succeeds even if Outlook sync failed; surface
      // the partial success without blocking (it reconciles on the next edit).
      if (saved.graphSyncError) {
        logger.warn('Marker Outlook sync error surfaced to admin:', saved.graphSyncError);
        showSuccess('Marker saved, but Outlook sync failed (will retry on next edit)');
      } else {
        showSuccess(editing ? 'Marker updated' : 'Marker created');
      }
    } catch (err) {
      logger.error('Error saving calendar marker:', err);
      setError(err.message || 'Failed to save marker');
      showError(err.message || 'Failed to save marker');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (marker) => {
    // First click arms the confirm state; second click (same id) performs it.
    if (confirmDeleteId !== marker._id) {
      setConfirmDeleteId(marker._id);
      return;
    }
    try {
      setDeletingId(marker._id);
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/calendar-markers/${marker._id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete marker');
      }
      invalidateMarkers();
      showSuccess('Marker deleted');
      setConfirmDeleteId(null);
    } catch (err) {
      logger.error('Error deleting calendar marker:', err);
      showError(err.message || 'Failed to delete marker');
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return <LoadingSpinner variant="card" text="Loading markers..." />;
  }

  return (
    <div className="markers-management">
      <div className="markers-header">
        <div className="markers-header-content">
          <h2>Holidays &amp; Closures</h2>
          <p className="markers-header-subtitle">
            Mark whole days as holidays or office closures. They appear as ribbons on the calendar
            and can optionally warn on booking or sync to the shared Outlook calendar.
          </p>
        </div>
        <button onClick={openCreate} className="markers-add-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add Marker
        </button>
      </div>

      {sortedMarkers.length > 0 ? (
        <div className="markers-list">
          {sortedMarkers.map((marker) => {
            const isConfirming = confirmDeleteId === marker._id;
            const isDeleting = deletingId === marker._id;
            return (
              <div key={marker._id} className={`marker-row marker-row--${marker.type}`}>
                <span className={`marker-type-pill marker-type-pill--${marker.type}`}>
                  {TYPE_LABELS[marker.type] || marker.type}
                </span>
                <div className="marker-row-main">
                  <span className="marker-row-name">{marker.name}</span>
                  <span className="marker-row-dates">{formatRange(marker.startDate, marker.endDate)}</span>
                  {marker.note && <span className="marker-row-note">{marker.note}</span>}
                </div>
                <div className="marker-row-flags">
                  {marker.warnOnReservation && <span className="marker-flag" title="Warns on reservation">⚠ Warn</span>}
                  {marker.pushToOutlook && <span className="marker-flag" title="Pushed to Outlook">📅 Outlook</span>}
                </div>
                <div className="marker-row-actions">
                  <button className="marker-edit-btn" onClick={() => openEdit(marker)}>Edit</button>
                  <button
                    className={`marker-delete-btn ${isConfirming ? 'confirm' : ''}`}
                    onClick={() => handleDelete(marker)}
                    disabled={isDeleting}
                  >
                    {isDeleting ? 'Deleting...' : isConfirming ? 'Confirm?' : 'Delete'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="markers-empty">
          <h3>No markers yet</h3>
          <p>Add a holiday or office closure to annotate the calendar.</p>
          <button onClick={openCreate} className="markers-add-btn">Add your first marker</button>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editing ? 'Edit Marker' : 'Add Marker'}</h3>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                {error && <div className="markers-error" role="alert">{error}</div>}

                <div className="form-group">
                  <label>Type</label>
                  <select value={formData.type} onChange={(e) => updateField({ type: e.target.value })}>
                    <option value="holiday">Holiday</option>
                    <option value="officeClosed">Office Closed</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Name <span className="required">*</span></label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => updateField({ name: e.target.value })}
                    placeholder="e.g. Rosh Hashanah"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Note</label>
                  <textarea
                    value={formData.note}
                    onChange={(e) => updateField({ note: e.target.value })}
                    placeholder="Optional details"
                    rows={2}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Start date</label>
                    <DatePickerInput
                      aria-label="Start date"
                      value={formData.startDate}
                      onChange={handleStartDateChange}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>End date</label>
                    <DatePickerInput
                      aria-label="End date"
                      value={formData.endDate}
                      onChange={(e) => updateField({ endDate: e.target.value })}
                      min={formData.startDate}
                      required
                    />
                  </div>
                </div>

                <div className="form-group form-checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={formData.warnOnReservation}
                      onChange={(e) => updateField({ warnOnReservation: e.target.checked })}
                    />
                    Warn when booking a room on this day (non-blocking)
                  </label>
                </div>

                <div className="form-group form-checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={formData.pushToOutlook}
                      onChange={(e) => updateField({ pushToOutlook: e.target.checked })}
                    />
                    Push to the shared Outlook calendar as an all-day event
                  </label>
                </div>

                <div className="form-group">
                  <label>Color override (optional)</label>
                  <div className="markers-color-row">
                    <input
                      type="color"
                      value={formData.color || '#eab308'}
                      onChange={(e) => updateField({ color: e.target.value })}
                    />
                    {formData.color && (
                      <button type="button" className="markers-color-clear" onClick={() => updateField({ color: '' })}>
                        Use type default
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <div className="modal-actions">
                  <button type="button" className="cancel-btn" onClick={() => setShowModal(false)} disabled={saving}>
                    Cancel
                  </button>
                  <button type="submit" className="save-btn" disabled={saving}>
                    {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Marker'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
