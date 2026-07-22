import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RecurringIcon, RecurringExceptionIcon } from '../../../components/shared/CalendarIcons';

describe('CalendarIcons recurrence tooltips', () => {
  it('RecurringIcon exposes a default tooltip and accessible label', () => {
    const { container } = render(<RecurringIcon />);
    const svg = container.querySelector('svg');
    expect(svg.querySelector('title').textContent).toBe('Recurring event');
    expect(svg.getAttribute('aria-label')).toBe('Recurring event');
    expect(svg.getAttribute('role')).toBe('img');
  });

  it('RecurringExceptionIcon explains the slash means a modified occurrence', () => {
    const { container } = render(<RecurringExceptionIcon />);
    const title = container.querySelector('svg title').textContent;
    expect(title).toBe('Recurring event - this occurrence was modified from the series');
  });

  it('accepts a custom title', () => {
    const { container } = render(<RecurringIcon title='Weekly series' />);
    expect(container.querySelector('svg title').textContent).toBe('Weekly series');
  });
});
