// src/components/shared/CalendarMarkerRibbon.jsx
//
// Shared holiday / office-closed ribbon used by Month (day cell), Week, and Day
// (day-column header) views. Renders one ribbon per marker so a multi-day span
// repeats and a day with two markers shows both. Returns null when there are no
// markers, so a cell/header keeps its existing first child when unmarked.

import React from 'react';
import { getMarkerRibbonColors } from '../../utils/calendarMarkers';
import './CalendarMarkerRibbon.css';

export const MarkerRibbonStack = ({ markers, variant }) => {
  if (!markers || markers.length === 0) return null;
  const stackClass = `marker-ribbon-stack${variant === 'header' ? ' marker-ribbon-stack--header' : ''}`;
  return (
    <div className={stackClass}>
      {markers.map((marker) => {
        const { dot } = getMarkerRibbonColors(marker);
        const typeClass = marker.type === 'officeClosed' ? 'marker-ribbon--closed' : 'marker-ribbon--holiday';
        return (
          <div
            key={marker._id || `${marker.type}-${marker.name}`}
            className={`marker-ribbon ${typeClass}`}
            title={marker.name}
          >
            <span className="marker-ribbon__dot" style={{ backgroundColor: dot }} aria-hidden="true" />
            <span className="marker-ribbon__label">{marker.name}</span>
          </div>
        );
      })}
    </div>
  );
};

export default MarkerRibbonStack;
