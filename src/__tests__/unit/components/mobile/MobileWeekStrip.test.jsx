// src/__tests__/unit/components/mobile/MobileWeekStrip.test.jsx
//
// Locks three mobile week-strip behaviors:
//  1. The month label is a button that opens the date picker, and picking a
//     date there calls onDateSelect.
//  2. The "Today" pill lives inline in the header's main group (next to the
//     label), NOT absolutely positioned over a week-nav chevron. This is the
//     structural guard against the tap-target collision that previously made
//     it impossible to keep paging forward.
//  3. The view switcher occupies the header's right edge and is omitted when
//     the caller owns no view preference. The chevrons pair up on the left to
//     free that edge, so nothing else may be rendered into it.
//
// useScrollLock (used by the embedded picker) is mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('../../../../hooks/useScrollLock', () => ({ default: vi.fn() }));

import MobileWeekStrip from '../../../../components/mobile/MobileWeekStrip';

describe('MobileWeekStrip', () => {
  let onDateSelect;

  beforeEach(() => {
    onDateSelect = vi.fn();
  });

  it('renders the month label as a button that opens the date picker', () => {
    render(
      <MobileWeekStrip
        // June 10, 2026 — a week (Jun 7-13) wholly inside one month, so this
        // test exercises the picker rather than the two-month label format.
        selectedDate={new Date(2026, 5, 10)}
        onDateSelect={onDateSelect}
        eventDates={new Set()}
      />
    );

    const label = screen.getByRole('button', { name: /June 2026/i });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(label);
    expect(screen.getByRole('dialog', { name: /choose date/i })).toBeTruthy();
  });

  it('selecting a date in the picker calls onDateSelect', () => {
    render(
      <MobileWeekStrip
        selectedDate={new Date(2026, 5, 10)}
        onDateSelect={onDateSelect}
        eventDates={new Set()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /June 2026/i }));
    fireEvent.click(screen.getByRole('button', { name: /June 18, 2026/i }));

    expect(onDateSelect).toHaveBeenCalledTimes(1);
    const picked = onDateSelect.mock.calls[0][0];
    expect(picked.getMonth()).toBe(5);
    expect(picked.getDate()).toBe(18);
    // picker closes after a selection
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('omits the Today pill while the current week is in view', () => {
    render(
      <MobileWeekStrip
        selectedDate={new Date()}
        onDateSelect={onDateSelect}
        eventDates={new Set()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
  });

  it('places the Today pill inline in the main group, not over a chevron', () => {
    // A date far from "now" guarantees the Today affordance is shown.
    render(
      <MobileWeekStrip
        selectedDate={new Date(2030, 0, 15)}
        onDateSelect={onDateSelect}
        eventDates={new Set()}
      />
    );

    const todayBtn = screen.getByRole('button', { name: 'Today' });
    const main = todayBtn.closest('.mobile-week-header-main');
    expect(main).toBeTruthy();

    // Both chevrons and the label are flow siblings of Today. The original bug
    // was an absolutely-positioned pill painting on top of the next-week
    // chevron; sharing one flex row is what makes that unrepresentable.
    const nextBtn = screen.getByRole('button', { name: /next week/i });
    expect(main.contains(nextBtn)).toBe(true);
    expect(nextBtn.style.position).toBe('');
    expect(todayBtn.style.position).toBe('');

    expect(within(main).getByRole('button', { name: /January 2030/i })).toBeTruthy();
  });

  it('renders the view switcher on the header edge, outside the main group', () => {
    const onViewChange = vi.fn();
    const { container } = render(
      <MobileWeekStrip
        selectedDate={new Date(2026, 5, 3)}
        onDateSelect={onDateSelect}
        eventDates={new Set()}
        activeView="threeDay"
        onViewChange={onViewChange}
      />
    );

    const switcher = screen.getByRole('group', { name: 'Calendar view' });
    // It is a direct child of the header, not of the nav/label group — that is
    // what pins it to the right edge instead of letting it float mid-row.
    expect(switcher.parentElement).toBe(container.querySelector('.mobile-week-strip-header'));
    expect(container.querySelector('.mobile-week-header-main').contains(switcher)).toBe(false);

    // Icon-only buttons: the labels survive as accessible names.
    expect(screen.getByRole('button', { name: '3 Day' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Agenda' }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Agenda' }));
    expect(onViewChange).toHaveBeenCalledWith('agenda');
  });

  it('omits the switcher entirely when no view preference is supplied', () => {
    render(
      <MobileWeekStrip
        selectedDate={new Date(2026, 5, 3)}
        onDateSelect={onDateSelect}
        eventDates={new Set()}
      />
    );
    expect(screen.queryByRole('group', { name: 'Calendar view' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Agenda' })).toBeNull();
  });

  // Sharing the header row with the switcher leaves the label about 90px. A
  // spelled-out two-month label ('July / August 2026') wants 114 and would
  // ellipsize for one week of every month, so the two-month forms abbreviate
  // and the one-month form — the other three weeks — does not.
  describe('month label width budget', () => {
    const labelText = (container) =>
      container.querySelector('.mobile-week-label').textContent;

    it('spells the month out when the week sits inside one month', () => {
      const { container } = render(
        <MobileWeekStrip
          selectedDate={new Date(2026, 5, 10)} // Jun 7-13
          onDateSelect={onDateSelect}
          eventDates={new Set()}
          activeView="agenda"
          onViewChange={vi.fn()}
        />
      );
      expect(labelText(container)).toContain('June 2026');
    });

    it('abbreviates both months when the week crosses a month boundary', () => {
      const { container } = render(
        <MobileWeekStrip
          selectedDate={new Date(2026, 6, 30)} // Jul 26 - Aug 1
          onDateSelect={onDateSelect}
          eventDates={new Set()}
          activeView="agenda"
          onViewChange={vi.fn()}
        />
      );
      expect(labelText(container)).toContain('Jul / Aug 2026');
    });

    it('abbreviates and keeps both years when the week crosses a year', () => {
      const { container } = render(
        <MobileWeekStrip
          selectedDate={new Date(2026, 11, 30)} // Dec 27 2026 - Jan 2 2027
          onDateSelect={onDateSelect}
          eventDates={new Set()}
          activeView="agenda"
          onViewChange={vi.fn()}
        />
      );
      // The longest label the strip can produce. It still overruns the budget
      // and ellipsizes, but only for one week a year, and both years survive
      // for anyone who widens or opens the picker.
      expect(labelText(container)).toContain('Dec 2026 / Jan 2027');
      // Truncation itself is a CSS contract (min-width:0 + overflow:hidden on
      // the button, ellipsis on the span). jsdom lays nothing out, so this only
      // asserts the span the rule targets still exists, and that the label
      // never displaces the switcher out of the header.
      expect(container.querySelector('.mobile-week-label span')).toBeTruthy();
      expect(screen.getByRole('group', { name: 'Calendar view' })).toBeTruthy();
    });
  });

  it('advances a week when the next chevron is tapped', () => {
    render(
      <MobileWeekStrip
        selectedDate={new Date(2026, 5, 3)}
        onDateSelect={onDateSelect}
        eventDates={new Set()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /next week/i }));
    const next = onDateSelect.mock.calls[0][0];
    expect(next.getDate()).toBe(10); // June 3 + 7
  });
});
