// src/__tests__/unit/components/mobile/MobileThreeDay.test.jsx
//
// Pins the 3-day grid's geometry to fixture times. The grid is the one place in
// the mobile shell where a timezone mistake is silent-but-visible — a block
// drawn an hour off still looks like a valid calendar — so the block-position
// assertions here are exact pixel values derived from the documented constants
// (52px/hour over an 8px top inset), not tolerances.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import MobileThreeDay, {
  HOUR_HEIGHT,
  GRID_TOP_INSET,
  MIN_BLOCK_HEIGHT,
  INITIAL_SCROLL_TOP,
  TIER_MED_MIN_HEIGHT,
  TIER_TALL_MIN_HEIGHT,
  densityTier,
  layoutDayEvents,
} from '../../../../components/mobile/MobileThreeDay';

const resolveCategoryColor = (name) => (name === 'Worship' ? '#1ba1e2' : '#cccccc');

function timed(id, title, startTime, endTime, extra = {}) {
  return {
    id,
    status: 'published',
    eventTitle: title,
    categories: ['Worship'],
    locationDisplayNames: 'Greenwald Hall',
    startDate: '2026-07-15',
    endDate: '2026-07-15',
    startDateTime: `2026-07-15T${startTime}:00`,
    endDateTime: `2026-07-15T${endTime}:00`,
    ...extra,
  };
}

function renderGrid(groupedEvents = {}, props = {}) {
  return render(
    <MobileThreeDay
      selectedDate={new Date(2026, 6, 15)}
      groupedEvents={groupedEvents}
      resolveCategoryColor={resolveCategoryColor}
      loading={false}
      error={null}
      onEventTap={vi.fn()}
      onRetry={vi.fn()}
      {...props}
    />
  );
}

/** Block styles are inline px strings; parse back to numbers for assertions. */
function px(el, prop) {
  return parseFloat(el.style[prop]);
}

describe('MobileThreeDay', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 15, 10, 30, 0)); // Wed Jul 15 2026, 10:30
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('columns', () => {
    it('renders three consecutive days with the selected date leftmost', () => {
      renderGrid();

      expect(screen.getByTestId('three-day-column-2026-07-15')).toBeTruthy();
      expect(screen.getByTestId('three-day-column-2026-07-16')).toBeTruthy();
      expect(screen.getByTestId('three-day-column-2026-07-17')).toBeTruthy();
      expect(screen.queryByTestId('three-day-column-2026-07-14')).toBeNull();
    });

    it('rolls the window across a month boundary', () => {
      renderGrid({}, { selectedDate: new Date(2026, 6, 31) });

      expect(screen.getByTestId('three-day-column-2026-07-31')).toBeTruthy();
      expect(screen.getByTestId('three-day-column-2026-08-01')).toBeTruthy();
      expect(screen.getByTestId('three-day-column-2026-08-02')).toBeTruthy();
    });

    it('tints today column and fills its header number', () => {
      const { container } = renderGrid();

      const todayColumns = container.querySelectorAll('.mobile-three-day-column.today');
      expect(todayColumns).toHaveLength(1);
      expect(todayColumns[0].getAttribute('data-testid')).toBe('three-day-column-2026-07-15');
      expect(container.querySelectorAll('.mobile-three-day-header-cell.today')).toHaveLength(1);
    });

    it('opens scrolled to 9 AM', () => {
      renderGrid();
      // 8px inset + 9 hours of 52px.
      expect(INITIAL_SCROLL_TOP).toBe(GRID_TOP_INSET + 9 * HOUR_HEIGHT);
      expect(INITIAL_SCROLL_TOP).toBe(476);
    });
  });

  describe('timed blocks', () => {
    it('positions a 10:00-11:30 event at the 10:00 line spanning 1.5 hour-heights', () => {
      renderGrid({ '2026-07-15': [timed('e1', 'Board Meeting', '10:00', '11:30')] });

      const block = screen.getByRole('button', { name: /Board Meeting/i });
      expect(px(block, 'top')).toBe(GRID_TOP_INSET + 10 * HOUR_HEIGHT); // 528
      expect(px(block, 'height')).toBe(1.5 * HOUR_HEIGHT);              // 78
    });

    it('positions a half-past start correctly', () => {
      renderGrid({ '2026-07-15': [timed('e1', 'Minyan', '07:30', '08:00')] });

      const block = screen.getByRole('button', { name: /Minyan/i });
      expect(px(block, 'top')).toBe(GRID_TOP_INSET + 7.5 * HOUR_HEIGHT);
      expect(px(block, 'height')).toBe(0.5 * HOUR_HEIGHT);
    });

    it('enforces a minimum block height for very short events', () => {
      renderGrid({ '2026-07-15': [timed('e1', 'Quick Sync', '09:00', '09:10')] });

      // 10 minutes would be ~8.7px — too small to tap.
      const block = screen.getByRole('button', { name: /Quick Sync/i });
      expect(px(block, 'height')).toBe(MIN_BLOCK_HEIGHT);
    });

    it('clamps an event that ends on a later day to midnight', () => {
      renderGrid({
        '2026-07-15': [timed('e1', 'Overnight', '22:00', '02:00', { endDate: '2026-07-16' })],
      });

      const block = screen.getByRole('button', { name: /Overnight/i });
      expect(px(block, 'top')).toBe(GRID_TOP_INSET + 22 * HOUR_HEIGHT);
      expect(px(block, 'height')).toBe(2 * HOUR_HEIGHT);
    });

    it('does not render the start time as text, but keeps it in the accessible name', () => {
      // The Y position states the time. Spending a 30-minute block's only line
      // restating it is what this rule exists to prevent — and with the visible
      // time gone, the aria-label is the ONLY source of it for a screen reader.
      renderGrid({ '2026-07-15': [timed('e1', 'Board Meeting', '19:00', '20:30')] });

      expect(screen.queryByText('7:00 PM')).toBeNull();
      expect(screen.getByText('Board Meeting')).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'Board Meeting, 7:00 PM' })
      ).toBeTruthy();
    });

    it('colors a block with a 3px category rail over an 8% wash', () => {
      renderGrid({ '2026-07-15': [timed('e1', 'Board Meeting', '10:00', '11:00')] });

      const block = screen.getByRole('button', { name: /Board Meeting/i });
      // jsdom normalizes both to rgb()/rgba(), which is a happy accident: it
      // turns the `+ '14'` alpha suffix into a readable 0.08 to assert against.
      expect(block.style.borderLeft).toBe('3px solid rgb(27, 161, 226)');
      expect(block.style.background).toBe('rgba(27, 161, 226, 0.08)');
      // The rail replaces the outline — no full border.
      expect(block.style.border).toBe('');
    });

    it('falls back to gray for an unknown or missing category', () => {
      renderGrid({
        '2026-07-15': [timed('e1', 'Mystery', '10:00', '11:00', { categories: [] })],
      });

      const block = screen.getByRole('button', { name: /Mystery/i });
      expect(block.style.borderLeft).toBe('3px solid rgb(204, 204, 204)');
      expect(block.style.background).toBe('rgba(204, 204, 204, 0.08)');
    });

    it('dims a pending event', () => {
      renderGrid({
        '2026-07-15': [timed('e1', 'Requested Room', '10:00', '11:00', { status: 'pending' })],
      });

      const block = screen.getByRole('button', { name: /Requested Room/i });
      expect(block.className).toContain('pending');
      expect(screen.getByRole('button', { name: /Requested Room/i }).classList.contains('pending')).toBe(true);
    });

    it('calls onEventTap with the tapped event', () => {
      const onEventTap = vi.fn();
      const event = timed('e1', 'Board Meeting', '10:00', '11:00');
      renderGrid({ '2026-07-15': [event] }, { onEventTap });

      fireEvent.click(screen.getByRole('button', { name: /Board Meeting/i }));

      expect(onEventTap).toHaveBeenCalledWith(event);
    });

    it('places events in their own day column', () => {
      renderGrid({
        '2026-07-15': [timed('e1', 'Day One', '10:00', '11:00')],
        '2026-07-17': [{ ...timed('e2', 'Day Three', '10:00', '11:00'), startDate: '2026-07-17' }],
      });

      const col1 = screen.getByTestId('three-day-column-2026-07-15');
      const col3 = screen.getByTestId('three-day-column-2026-07-17');
      expect(col1.textContent).toContain('Day One');
      expect(col3.textContent).toContain('Day Three');
      expect(col1.textContent).not.toContain('Day Three');
    });
  });

  describe('text density', () => {
    it('classifies tiers at the documented pixel boundaries', () => {
      expect(densityTier(TIER_MED_MIN_HEIGHT - 1)).toBe('short');
      expect(densityTier(TIER_MED_MIN_HEIGHT)).toBe('med');
      expect(densityTier(TIER_TALL_MIN_HEIGHT - 1)).toBe('med');
      expect(densityTier(TIER_TALL_MIN_HEIGHT)).toBe('tall');
    });

    it('maps real durations onto the tiers', () => {
      // 30 min -> 26px, 45 min -> 39px, 60 min -> 52px, 90 min -> 78px.
      const tierOf = (start, end) =>
        layoutDayEvents([timed('x', 'X', start, end)])[0].tier;

      expect(tierOf('10:00', '10:30')).toBe('short');
      expect(tierOf('10:00', '10:45')).toBe('med');
      expect(tierOf('10:00', '11:00')).toBe('tall');
      expect(tierOf('10:00', '11:30')).toBe('tall');
    });

    it('gives a minimum-height block the short tier', () => {
      const [block] = layoutDayEvents([timed('x', 'X', '10:00', '10:05')]);
      expect(block.height).toBe(MIN_BLOCK_HEIGHT);
      expect(block.tier).toBe('short');
    });

    it('puts the tier on the rendered block so CSS can clamp it', () => {
      renderGrid({
        '2026-07-15': [
          timed('a', 'Half Hour', '08:00', '08:30'),
          timed('b', 'Three Quarters', '09:00', '09:45'),
          timed('c', 'Full Hour', '10:00', '11:00'),
        ],
      });

      expect(screen.getByRole('button', { name: /Half Hour/i }).className).toContain('short');
      expect(screen.getByRole('button', { name: /Three Quarters/i }).className).toContain('med');
      expect(screen.getByRole('button', { name: /Full Hour/i }).className).toContain('tall');
    });

    it('shows the location only on tall blocks', () => {
      renderGrid({
        '2026-07-15': [
          timed('a', 'Half Hour', '08:00', '08:30'),
          timed('b', 'Three Quarters', '09:00', '09:45'),
          timed('c', 'Full Hour', '10:00', '11:00'),
        ],
      });

      const textOf = (name) => screen.getByRole('button', { name }).textContent;
      expect(textOf(/Half Hour/i)).not.toContain('Greenwald Hall');
      expect(textOf(/Three Quarters/i)).not.toContain('Greenwald Hall');
      expect(textOf(/Full Hour/i)).toContain('Greenwald Hall');
    });

    it('omits the location line on a tall block that has no location', () => {
      const { container } = renderGrid({
        '2026-07-15': [
          timed('c', 'Full Hour', '10:00', '11:00', { locationDisplayNames: '' }),
        ],
      });
      expect(container.querySelector('.mobile-three-day-block-location')).toBeNull();
    });
  });

  describe('overlaps', () => {
    it('splits the column equally between two overlapping events', () => {
      renderGrid({
        '2026-07-15': [
          timed('e1', 'First', '10:00', '11:30'),
          timed('e2', 'Second', '11:00', '12:00'),
        ],
      });

      const first = screen.getByRole('button', { name: /First/i });
      const second = screen.getByRole('button', { name: /Second/i });

      expect(first.style.width).toBe('50%');
      expect(second.style.width).toBe('50%');
      expect(first.style.left).toBe('0%');
      expect(second.style.left).toBe('50%');
    });

    it('gives a non-overlapping event the full column width', () => {
      renderGrid({
        '2026-07-15': [
          timed('e1', 'First', '09:00', '10:00'),
          timed('e2', 'Second', '11:00', '12:00'),
        ],
      });

      expect(screen.getByRole('button', { name: /First/i }).style.width).toBe('100%');
      expect(screen.getByRole('button', { name: /Second/i }).style.width).toBe('100%');
    });

    it('splits a three-way cluster into thirds', () => {
      const layout = layoutDayEvents([
        timed('a', 'A', '10:00', '12:00'),
        timed('b', 'B', '10:30', '11:00'),
        timed('c', 'C', '10:45', '11:30'),
      ]);

      expect(layout).toHaveLength(3);
      layout.forEach(item => expect(item.widthPct).toBeCloseTo(100 / 3));
      expect(layout.map(i => i.leftPct)).toEqual([0, 100 / 3, (100 / 3) * 2]);
    });

    it('treats back-to-back events as separate clusters', () => {
      // 10:00-11:00 and 11:00-12:00 touch but do not overlap.
      const layout = layoutDayEvents([
        timed('a', 'A', '10:00', '11:00'),
        timed('b', 'B', '11:00', '12:00'),
      ]);
      expect(layout.every(i => i.widthPct === 100)).toBe(true);
    });
  });

  describe('all-day row', () => {
    const allDay = {
      id: 'ad1',
      status: 'published',
      eventTitle: 'Office Closed',
      categories: ['Worship'],
      isAllDayEvent: true,
      startDate: '2026-07-16',
      endDate: '2026-07-16',
      startDateTime: '2026-07-16T00:00:00',
      endDateTime: '2026-07-17T00:00:00',
    };

    it('is absent when no day in the window has an all-day event', () => {
      const { container } = renderGrid({
        '2026-07-15': [timed('e1', 'Board Meeting', '10:00', '11:00')],
      });
      expect(container.querySelector('.mobile-three-day-allday')).toBeNull();
    });

    it('renders a tappable chip in the right day slot', () => {
      const onEventTap = vi.fn();
      const { container } = renderGrid({ '2026-07-16': [allDay] }, { onEventTap });

      const cells = container.querySelectorAll('.mobile-three-day-allday-cell');
      expect(cells).toHaveLength(3);
      expect(cells[0].textContent).toBe('');
      expect(cells[1].textContent).toContain('Office Closed');

      fireEvent.click(screen.getByRole('button', { name: 'Office Closed' }));
      expect(onEventTap).toHaveBeenCalledWith(allDay);
    });

    it('keeps all-day events out of the timed grid', () => {
      const { container } = renderGrid({ '2026-07-16': [allDay] });
      expect(container.querySelectorAll('.mobile-three-day-block')).toHaveLength(0);
    });
  });

  describe('current-time indicator', () => {
    it('renders only in today column, at the current time', () => {
      renderGrid();

      const indicators = screen.getAllByTestId('three-day-now-indicator');
      expect(indicators).toHaveLength(1);
      // 10:30 -> 10.5 hours.
      expect(px(indicators[0], 'top')).toBe(GRID_TOP_INSET + 10.5 * HOUR_HEIGHT);

      const column = indicators[0].closest('[data-testid^="three-day-column-"]');
      expect(column.getAttribute('data-testid')).toBe('three-day-column-2026-07-15');
    });

    it('does not render when the window excludes today', () => {
      renderGrid({}, { selectedDate: new Date(2026, 7, 10) });
      expect(screen.queryByTestId('three-day-now-indicator')).toBeNull();
    });

    it('clears its interval on unmount', () => {
      const clearSpy = vi.spyOn(globalThis, 'clearInterval');
      const { unmount } = renderGrid();
      unmount();
      expect(clearSpy).toHaveBeenCalled();
    });
  });

  describe('loading and error states', () => {
    it('shows a skeleton while loading', () => {
      const { container } = renderGrid({}, { loading: true });
      expect(container.querySelector('.mobile-three-day-skeleton')).toBeTruthy();
      expect(screen.queryByTestId('three-day-scroll')).toBeNull();
    });

    it('shows the error with a retry that calls back', () => {
      const onRetry = vi.fn();
      renderGrid({}, { error: 'Unable to load events. Pull down to retry.', onRetry });

      expect(screen.getByText(/Unable to load events/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(onRetry).toHaveBeenCalled();
    });
  });
});
