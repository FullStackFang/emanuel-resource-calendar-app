import React from 'react';
import './MobileViewSwitcher.css';

function AgendaIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <circle cx="3.5" cy="6" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="18" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ThreeDayIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="4" width="5" height="16" rx="1" />
      <rect x="9.5" y="4" width="5" height="16" rx="1" />
      <rect x="16.5" y="4" width="5" height="16" rx="1" />
    </svg>
  );
}

export const CALENDAR_VIEWS = [
  { id: 'agenda', label: 'Agenda' },
  { id: 'threeDay', label: '3 Day' },
];

const VIEW_ICONS = {
  agenda: AgendaIcon,
  threeDay: ThreeDayIcon,
};

/**
 * Segmented control for the calendar tab's presentation.
 *
 * Icon-only and sized to match `.mobile-week-nav`, because it is rendered inside
 * the week strip's header row rather than on a row of its own. The standalone
 * row it replaced spent ~61px of a phone screen on a pill that occupied about a
 * third of its width; folding it up here returns all of that to the grid.
 *
 * The labels remain the buttons' accessible names — the icons carry no text, so
 * `aria-label` is the only name a screen reader (or a test) gets.
 *
 * @param {'agenda'|'threeDay'} activeView
 * @param {(view: string) => void} onChange
 */
function MobileViewSwitcher({ activeView, onChange }) {
  return (
    <div className="mobile-view-switcher" role="group" aria-label="Calendar view">
      {CALENDAR_VIEWS.map(({ id, label }) => {
        const Icon = VIEW_ICONS[id];
        return (
          <button
            key={id}
            type="button"
            className={`mobile-view-switcher-segment ${activeView === id ? 'active' : ''}`}
            onClick={() => onChange(id)}
            aria-pressed={activeView === id}
            aria-label={label}
            title={label}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}

export default React.memo(MobileViewSwitcher);
