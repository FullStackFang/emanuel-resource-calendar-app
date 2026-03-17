import { useRef } from 'react';
import './DatePickerInput.css';

export default function DatePickerInput({ value, onChange, id, name, disabled, required, className, min, max, ...rest }) {
  const inputRef = useRef(null);

  return (
    <div className="date-picker-wrapper">
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={onChange}
        id={id}
        name={name}
        disabled={disabled}
        required={required}
        className={`${className || ''} date-picker-native-input`}
        min={min}
        max={max}
        {...rest}
      />
      {!disabled && (
        <button
          type="button"
          className="picker-icon-btn"
          onClick={() => inputRef.current?.showPicker()}
          tabIndex={-1}
          aria-label="Open date picker"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
            <line x1="2" y1="6.5" x2="14" y2="6.5" stroke="currentColor" strokeWidth="1.5" />
            <line x1="5.5" y1="1.5" x2="5.5" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="10.5" y1="1.5" x2="10.5" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
