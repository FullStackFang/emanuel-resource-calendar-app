// src/components/scheduling/SeedDatePicker.jsx
//
// Seed-date picker for the New Scheduling Sheet panel. Two months side by side
// (holiday spans straddle a month boundary — High Holy Days run Sep into Oct —
// and paging mid-selection is where people lose track of what they picked),
// with the chosen days rendered below as the actual `.ss-tab` day-tab pills the
// workbook is about to grow. The panel previews its own outcome rather than
// restating the calendar in a second list.
//
// Not MultiDatePicker: that component's substance is its two-up chip list, and
// this surface replaces the chip list outright. What is left in common — toggle
// a day in a Set — is a dozen lines, so bending the shared component here would
// cost more CSS than the logic is worth.

import React from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

/** Local-calendar YYYY-MM-DD. Deliberately not toISOString(), which reports the
 *  UTC day and shifts every pick backwards for any user east of Greenwich. */
function toDateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatTabLabel(dateKey) {
  const d = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * @param {string[]} selectedDates - YYYY-MM-DD, any order
 * @param {(dates: string[]) => void} onChange - receives the next set, sorted
 * @param {boolean} disabled
 */
export default function SeedDatePicker({ selectedDates = [], onChange, disabled = false }) {
  const selected = React.useMemo(() => [...selectedDates].sort(), [selectedDates]);
  const highlighted = React.useMemo(
    () => selected.map((d) => new Date(`${d}T00:00:00`)),
    [selected]
  );

  const toggle = (dateKey) => {
    if (disabled) return;
    const next = selected.includes(dateKey)
      ? selected.filter((d) => d !== dateKey)
      : [...selected, dateKey].sort();
    onChange(next);
  };

  return (
    <div className="ss-seed" data-testid="seed-date-picker">
      <div className="ss-seed-calendar">
        <DatePicker
          inline
          monthsShown={2}
          selected={null}
          disabled={disabled}
          highlightDates={highlighted}
          onChange={(date) => date && toggle(toDateKey(date))}
        />
      </div>

      {selected.length === 0 ? (
        <p className="ss-seed-hint">
          Click the days this sheet covers. They need not be consecutive, and more can be added later.
        </p>
      ) : (
        <>
          <p className="ss-seed-count">
            <strong>{selected.length} day tab{selected.length === 1 ? '' : 's'}</strong> will be created:
          </p>
          <div className="ss-seed-strip" data-testid="seed-date-strip">
            {selected.map((d) => (
              <button
                key={d}
                type="button"
                className="ss-tab ss-seed-tab"
                disabled={disabled}
                title={`Remove ${formatTabLabel(d)}`}
                aria-label={`Remove ${formatTabLabel(d)} from the seeded days`}
                onClick={() => toggle(d)}
              >
                {formatTabLabel(d)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
