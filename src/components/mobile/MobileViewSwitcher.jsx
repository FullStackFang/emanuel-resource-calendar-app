import React from 'react';
import './MobileViewSwitcher.css';

export const CALENDAR_VIEWS = [
  { id: 'agenda', label: 'Agenda' },
  { id: 'threeDay', label: '3 Day' },
];

/**
 * Segmented control for the calendar tab's presentation.
 *
 * Lives on its own row beneath the week strip, right-aligned — deliberately NOT
 * beside the month label, whose caret opens the date picker and would collide
 * with these tap targets.
 *
 * @param {'agenda'|'threeDay'} activeView
 * @param {(view: string) => void} onChange
 */
function MobileViewSwitcher({ activeView, onChange }) {
  return (
    <div className="mobile-view-switcher-row">
      <div className="mobile-view-switcher" role="group" aria-label="Calendar view">
        {CALENDAR_VIEWS.map(view => (
          <button
            key={view.id}
            type="button"
            className={`mobile-view-switcher-segment ${activeView === view.id ? 'active' : ''}`}
            onClick={() => onChange(view.id)}
            aria-pressed={activeView === view.id}
          >
            {view.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default React.memo(MobileViewSwitcher);
