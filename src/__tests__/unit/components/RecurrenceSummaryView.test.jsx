// src/__tests__/unit/components/RecurrenceSummaryView.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RecurrenceSummaryView from '../../../components/RecurrenceSummaryView';

const weeklyPattern = {
  pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
  range: { type: 'endDate', startDate: '2026-04-14', endDate: '2026-12-31' },
  additions: ['2026-05-01'],
  exclusions: ['2026-06-30', '2026-07-07'],
};

describe('RecurrenceSummaryView', () => {
  it('renders empty-state message when no recurrence pattern', () => {
    render(<RecurrenceSummaryView recurrencePattern={null} />);
    expect(screen.getByText(/does not have a recurrence pattern/i)).toBeInTheDocument();
  });

  it('renders a summary sentence when a pattern exists', () => {
    render(<RecurrenceSummaryView recurrencePattern={weeklyPattern} />);
    expect(screen.getByText(/weekly|tuesday|every/i)).toBeInTheDocument();
  });

  it('renders both addition and exclusion sections when both present', () => {
    render(<RecurrenceSummaryView recurrencePattern={weeklyPattern} />);
    expect(screen.getByText(/Added dates \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Excluded dates \(2\)/)).toBeInTheDocument();
    expect(screen.getByText('5/1/2026')).toBeInTheDocument();
    expect(screen.getByText('6/30/2026')).toBeInTheDocument();
    expect(screen.getByText('7/7/2026')).toBeInTheDocument();
  });

  it('renders only additions section when exclusions are empty', () => {
    const patternAdditionsOnly = { ...weeklyPattern, exclusions: [] };
    render(<RecurrenceSummaryView recurrencePattern={patternAdditionsOnly} />);
    expect(screen.getByText(/Added dates \(1\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Excluded dates/)).toBeNull();
  });

  it('renders only exclusions section when additions are empty', () => {
    const patternExclusionsOnly = { ...weeklyPattern, additions: [] };
    render(<RecurrenceSummaryView recurrencePattern={patternExclusionsOnly} />);
    expect(screen.queryByText(/Added dates/)).toBeNull();
    expect(screen.getByText(/Excluded dates \(2\)/)).toBeInTheDocument();
  });

  it('omits exception sections entirely when neither additions nor exclusions', () => {
    const patternOnly = { ...weeklyPattern, additions: [], exclusions: [] };
    render(<RecurrenceSummaryView recurrencePattern={patternOnly} />);
    expect(screen.queryByText(/Added dates/)).toBeNull();
    expect(screen.queryByText(/Excluded dates/)).toBeNull();
  });

  it('renders ZERO disabled form controls (no fake-editable UI)', () => {
    const { container } = render(<RecurrenceSummaryView recurrencePattern={weeklyPattern} />);
    expect(container.querySelectorAll('input[disabled]')).toHaveLength(0);
    expect(container.querySelectorAll('select[disabled]')).toHaveLength(0);
    expect(container.querySelectorAll('button[disabled]')).toHaveLength(0);
  });
});
