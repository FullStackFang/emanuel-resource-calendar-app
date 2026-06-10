// src/components/shared/ReservationMarkerAdvisory.jsx
//
// Soft, non-blocking advisory shown in booking forms when the selected date is
// covered by an active marker flagged warnOnReservation (e.g. an office
// closure). It is advisory ONLY: it never blocks submission and never raises a
// scheduling conflict (checkRoomConflicts is untouched). Reuses the shared
// marker query so it stays in lockstep with the calendar ribbon.

import React, { useMemo, useState } from 'react';
import { useCalendarMarkersQuery } from '../../hooks/useCalendarMarkersQuery';
import { buildMarkersByDate, getMarkersForDate } from '../../utils/calendarMarkers';
import './ReservationMarkerAdvisory.css';

const TYPE_LABELS = { holiday: 'Holiday', officeClosed: 'Office Closed' };

export default function ReservationMarkerAdvisory({ apiToken, date }) {
  const { data: markers = [] } = useCalendarMarkersQuery(apiToken);
  const [dismissed, setDismissed] = useState({});

  const markersByDate = useMemo(() => buildMarkersByDate(markers), [markers]);

  const advisories = useMemo(
    () =>
      getMarkersForDate(markersByDate, date).filter(
        (m) => m.warnOnReservation && !dismissed[m._id]
      ),
    [markersByDate, date, dismissed]
  );

  if (!date || advisories.length === 0) return null;

  return (
    <div className="reservation-marker-advisory" role="status">
      {advisories.map((marker) => (
        <div key={marker._id} className={`reservation-marker-advisory-item rma--${marker.type}`}>
          <span className="rma-icon" aria-hidden="true">ⓘ</span>
          <span className="rma-text">
            <strong>{TYPE_LABELS[marker.type] || marker.type}: {marker.name}</strong> falls on the
            selected date. You can still submit this booking.
          </span>
          <button
            type="button"
            className="rma-dismiss"
            aria-label={`Dismiss ${marker.name} advisory`}
            onClick={() => setDismissed((prev) => ({ ...prev, [marker._id]: true }))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
