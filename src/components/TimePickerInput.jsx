import { useCallback } from 'react';
import './TimePickerInput.css';

export default function TimePickerInput({ value, onChange, id, name, disabled, required, className, clearable = false, ...rest }) {
  const fireChange = useCallback((timeStr) => {
    const syntheticEvent = {
      target: { name, value: timeStr, id },
      currentTarget: { name, value: timeStr, id },
    };
    onChange(syntheticEvent);
  }, [name, id, onChange]);

  const handleClear = () => {
    fireChange('');
  };

  return (
    <div className="time-picker-wrapper">
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
    </div>
  );
}
