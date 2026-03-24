import { useState, useRef, useEffect, useCallback } from 'react';
import './TimePickerInput.css';

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function parseTimeValue(value) {
  if (!value) return { hour12: 12, minute: 0, ampm: 'AM' };
  const [h, m] = value.split(':').map(Number);
  const hour24 = h || 0;
  const minute = m || 0;
  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
  return { hour12, minute, ampm };
}

function to24Hour(hour12, ampm) {
  if (ampm === 'AM') return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function nearestFive(m) {
  return Math.round(m / 5) * 5 % 60;
}

export default function TimePickerInput({ value, onChange, id, name, disabled, required, className, clearable = false, ...rest }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const hoursRef = useRef(null);
  const minutesRef = useRef(null);

  const parsed = parseTimeValue(value);
  const roundedMinute = nearestFive(parsed.minute);

  // Close on outside click or Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Scroll selected values into view when dropdown opens
  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => {
      hoursRef.current?.querySelector('.selected')?.scrollIntoView({ block: 'center', behavior: 'instant' });
      minutesRef.current?.querySelector('.selected')?.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
  }, [isOpen]);

  const fireChange = useCallback((timeStr) => {
    const syntheticEvent = {
      target: { name, value: timeStr, id },
      currentTarget: { name, value: timeStr, id },
    };
    onChange(syntheticEvent);
  }, [name, id, onChange]);

  const handleSelect = (hour12, minute, ampm) => {
    const hour24 = to24Hour(hour12, ampm);
    fireChange(`${pad(hour24)}:${pad(minute)}`);
  };

  const handleClear = () => {
    fireChange('');
    setIsOpen(false);
  };

  return (
    <div className="time-picker-wrapper" ref={containerRef}>
      <input
        type="time"
        step="300"
        value={value}
        onChange={onChange}
        id={id}
        name={name}
        disabled={disabled}
        required={required}
        className={`${className || ''} time-picker-native-input`}
        {...rest}
      />
      {clearable && !disabled && value && (
        <button
          type="button"
          className="picker-clear-btn"
          onClick={handleClear}
          tabIndex={-1}
          aria-label="Clear time"
          title="Clear time"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
      {!disabled && (
        <button
          type="button"
          className="picker-icon-btn"
          onClick={() => setIsOpen(!isOpen)}
          tabIndex={-1}
          aria-label="Open time picker"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 4.5V8L10.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {isOpen && (
        <div className="time-picker-dropdown">
          <div className="time-picker-col" ref={hoursRef}>
            {HOURS.map(h => (
              <div
                key={h}
                className={`time-picker-option ${h === parsed.hour12 ? 'selected' : ''}`}
                onClick={() => handleSelect(h, roundedMinute, parsed.ampm)}
              >
                {pad(h)}
              </div>
            ))}
          </div>
          <div className="time-picker-col" ref={minutesRef}>
            {MINUTES.map(m => (
              <div
                key={m}
                className={`time-picker-option ${m === roundedMinute ? 'selected' : ''}`}
                onClick={() => handleSelect(parsed.hour12, m, parsed.ampm)}
              >
                {pad(m)}
              </div>
            ))}
          </div>
          <div className="time-picker-col time-picker-ampm-col">
            {['AM', 'PM'].map(p => (
              <div
                key={p}
                className={`time-picker-option ${p === parsed.ampm ? 'selected' : ''}`}
                onClick={() => handleSelect(parsed.hour12, parsed.minute, p)}
              >
                {p}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
