// src/__tests__/unit/components/TimePickerInput.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TimePickerInput from '../../../components/TimePickerInput';

describe('TimePickerInput', () => {
  const defaultProps = {
    value: '10:45',
    onChange: vi.fn(),
    id: 'startTime',
    name: 'startTime',
  };

  it('renders with the provided value', () => {
    const { container } = render(<TimePickerInput {...defaultProps} />);
    const input = container.querySelector('input[type="time"]');
    expect(input).toBeTruthy();
    expect(input.value).toBe('10:45');
  });

  it('shows clear button when clearable and has value', () => {
    render(<TimePickerInput {...defaultProps} clearable />);
    const clearBtn = screen.getByLabelText('Clear time');
    expect(clearBtn).toBeTruthy();
  });

  it('does not show clear button when value is empty', () => {
    render(<TimePickerInput {...defaultProps} value="" clearable />);
    const clearBtn = screen.queryByLabelText('Clear time');
    expect(clearBtn).toBeNull();
  });

  it('does not show clear button when disabled', () => {
    render(<TimePickerInput {...defaultProps} clearable disabled />);
    const clearBtn = screen.queryByLabelText('Clear time');
    expect(clearBtn).toBeNull();
  });

  describe('clear button click', () => {
    it('calls onChange with empty string value', () => {
      const onChange = vi.fn();
      render(<TimePickerInput {...defaultProps} onChange={onChange} clearable />);

      const clearBtn = screen.getByLabelText('Clear time');
      fireEvent.click(clearBtn);

      expect(onChange).toHaveBeenCalledTimes(1);
      const event = onChange.mock.calls[0][0];
      expect(event.target.name).toBe('startTime');
      expect(event.target.value).toBe('');
      expect(event.target.id).toBe('startTime');
    });

    it('fires onChange with empty value for endTime field', () => {
      const onChange = vi.fn();
      render(
        <TimePickerInput
          value="17:00"
          onChange={onChange}
          id="endTime"
          name="endTime"
          clearable
        />
      );

      fireEvent.click(screen.getByLabelText('Clear time'));

      const event = onChange.mock.calls[0][0];
      expect(event.target.name).toBe('endTime');
      expect(event.target.value).toBe('');
    });

    it('produces empty string, never reservation time fallback', () => {
      // This test documents the contract: clear MUST produce '' (empty string),
      // not any fallback value. Parent components must respect this.
      const onChange = vi.fn();
      render(<TimePickerInput {...defaultProps} value="10:45" onChange={onChange} clearable />);

      fireEvent.click(screen.getByLabelText('Clear time'));

      const clearedValue = onChange.mock.calls[0][0].target.value;
      expect(clearedValue).toBe('');
      expect(clearedValue).not.toBe('10:45');
    });
  });
});
