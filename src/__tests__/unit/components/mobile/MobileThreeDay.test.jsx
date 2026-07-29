// src/__tests__/unit/components/mobile/MobileThreeDay.test.jsx
//
// Pins the 3-day grid's geometry to fixture times. The grid is the one place in
// the mobile shell where a timezone mistake is silent-but-visible — a block
// drawn an hour off still looks like a valid calendar — so the block-position
// assertions here are exact pixel values, not tolerances.
//
// Since the axis became elastic those pixels are no longer `hour * 52`. They are
// read back out of `buildTimeScale`, which is itself pinned exactly in
// timeScale.test.js. Each geometry test therefore asserts twice: against the
// scale (so it survives a retune of the tier heights) and against one literal
// number (so a change to the tiers has to be deliberate rather than absorbed).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import MobileThreeDay, {
  HOUR_HEIGHT,
  HOUR_HEIGHT_BUSY,
  HOUR_HEIGHT_CROWDED,
  GRID_TOP_INSET,
  MIN_BLOCK_HEIGHT,
  INITIAL_SCROLL_HOUR,
  TIER_MED_MIN_HEIGHT,
  TIER_TALL_MIN_HEIGHT,
  STACK_MIN_HEIGHT,
  STACK_HEADER_HEIGHT,
  STACK_ROW_HEIGHT,
  densityTier,
  layoutDayEvents,
  buildTimeScale,
  minutesToY,
} from '../../../../components/mobile/MobileThreeDay';

const resolveCategoryColor = (name) => (name === 'Worship' ? '#1ba1e2' : '#cccccc');

function timed(id, title, startTime, endTime, extra = {}) {
  const day = extra.startDate || '2026-07-15';
  return {
    id,
    status: 'published',
    eventTitle: title,
    categories: ['Worship'],
    locationDisplayNames: 'Greenwald Hall',
    startDate: day,
    endDate: day,
    startDateTime: `${day}T${startTime}:00`,
    endDateTime: `${day}T${endTime}:00`,
    ...extra,
  };
}

/** The scale the component will build for a given grouped-events map. */
function scaleFor(groupedEvents, keys = ['2026-07-15', '2026-07-16', '2026-07-17'], expandedRange = null) {
  return buildTimeScale(
    keys.map(key => (groupedEvents?.[key] || []).filter(e => !e.isAllDayEvent)),
    expandedRange
  );
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

    it('sizes the grid to the elastic total, not to 24 uniform hours', () => {
      const events = { '2026-07-15': [timed('e1', 'Board Meeting', '10:00', '11:30')] };
      const { container } = renderGrid(events);
      const scale = scaleFor(events);

      const grid = container.querySelector('.mobile-three-day-grid');
      expect(px(grid, 'height')).toBe(GRID_TOP_INSET + scale.totalHeight);
      expect(px(grid, 'height')).toBeLessThan(GRID_TOP_INSET + 24 * HOUR_HEIGHT);
    });
  });

  describe('initial scroll', () => {
    it('opens at the earliest hour carrying an event', () => {
      const events = { '2026-07-16': [timed('e1', 'Minyan', '07:00', '08:00', { startDate: '2026-07-16' })] };
      renderGrid(events);

      const scale = scaleFor(events);
      expect(scale.firstEventHour).toBe(7);
      expect(screen.getByTestId('three-day-scroll').scrollTop).toBe(minutesToY(scale, 7 * 60));
      // 7 pre-dawn hours collapse to a 26px band, so 7 AM sits at 8 + 26.
      expect(screen.getByTestId('three-day-scroll').scrollTop).toBe(34);
    });

    it('takes the earliest hour across all three columns, not just the first', () => {
      const events = {
        '2026-07-15': [timed('a', 'Afternoon', '14:00', '15:00')],
        '2026-07-17': [timed('b', 'Early', '06:00', '07:00', { startDate: '2026-07-17' })],
      };
      renderGrid(events);

      const scale = scaleFor(events);
      expect(scale.firstEventHour).toBe(6);
      expect(screen.getByTestId('three-day-scroll').scrollTop).toBe(minutesToY(scale, 6 * 60));
    });

    it('falls back to the working day on an empty window', () => {
      renderGrid();

      const scale = scaleFor({});
      expect(scale.firstEventHour).toBeNull();
      expect(INITIAL_SCROLL_HOUR).toBe(9);
      expect(screen.getByTestId('three-day-scroll').scrollTop)
        .toBe(minutesToY(scale, INITIAL_SCROLL_HOUR * 60));
    });
  });

  describe('timed blocks', () => {
    it('positions a 10:00-11:30 event at the 10:00 line spanning 1.5 hours of scale', () => {
      const events = { '2026-07-15': [timed('e1', 'Board Meeting', '10:00', '11:30')] };
      renderGrid(events);
      const scale = scaleFor(events);

      const block = screen.getByRole('button', { name: /Board Meeting/i });
      expect(px(block, 'top')).toBe(minutesToY(scale, 10 * 60));
      expect(px(block, 'height')).toBe(minutesToY(scale, 11 * 60 + 30) - minutesToY(scale, 10 * 60));
      // Both hours are single-booking, so the extent is still 1.5 * 52; only the
      // top moved, because the empty small hours ahead of it collapsed.
      expect(px(block, 'top')).toBe(34);
      expect(px(block, 'height')).toBe(78);
    });

    it('positions a half-past start correctly', () => {
      const events = { '2026-07-15': [timed('e1', 'Minyan', '07:30', '08:00')] };
      renderGrid(events);
      const scale = scaleFor(events);

      const block = screen.getByRole('button', { name: /Minyan/i });
      expect(px(block, 'top')).toBe(minutesToY(scale, 7 * 60 + 30));
      expect(px(block, 'height')).toBe(0.5 * HOUR_HEIGHT);
    });

    it('puts the same clock time at the same height in every column', () => {
      const events = {
        '2026-07-15': [timed('a', 'Day One', '10:00', '11:00')],
        '2026-07-17': [timed('b', 'Day Three', '10:00', '11:00', { startDate: '2026-07-17' })],
      };
      renderGrid(events);

      const first = screen.getByRole('button', { name: /Day One/i });
      const third = screen.getByRole('button', { name: /Day Three/i });
      expect(px(first, 'top')).toBe(px(third, 'top'));
    });

    it('gives a block in a contended hour more height than the same duration in a quiet one', () => {
      // The 9 AM event is alone; the 7 PM one shares its hour with two others.
      const events = {
        '2026-07-15': [
          timed('quiet', 'Quiet Hour', '09:00', '10:00'),
          timed('x', 'Busy A', '19:00', '20:00'),
          timed('y', 'Busy B', '19:10', '20:10'),
          timed('z', 'Busy C', '19:20', '20:20'),
        ],
      };
      const scale = scaleFor(events);

      expect(scale.hourHeights[9]).toBe(HOUR_HEIGHT);
      expect(scale.hourHeights[19]).toBe(HOUR_HEIGHT_CROWDED);
      expect(scale.hourHeights[19]).toBeGreaterThan(scale.hourHeights[9]);
    });

    it('enforces a minimum block height for very short events', () => {
      renderGrid({ '2026-07-15': [timed('e1', 'Quick Sync', '09:00', '09:10')] });

      // 10 minutes would be ~8.7px — too small to tap.
      const block = screen.getByRole('button', { name: /Quick Sync/i });
      expect(px(block, 'height')).toBe(MIN_BLOCK_HEIGHT);
    });

    it('clamps an event that ends on a later day to midnight', () => {
      const events = {
        '2026-07-15': [timed('e1', 'Overnight', '22:00', '02:00', { endDate: '2026-07-16' })],
      };
      renderGrid(events);
      const scale = scaleFor(events);

      const block = screen.getByRole('button', { name: /Overnight/i });
      expect(px(block, 'top')).toBe(minutesToY(scale, 22 * 60));
      expect(px(block, 'height')).toBe(2 * HOUR_HEIGHT);
    });

    it('colors a block with a full 1px category border over a 12% wash', () => {
      renderGrid({ '2026-07-15': [timed('e1', 'Board Meeting', '10:00', '11:00')] });

      const block = screen.getByRole('button', { name: /Board Meeting/i });
      // jsdom normalizes both to rgb()/rgba(), which turns the hex alpha suffix
      // into a readable fraction to assert against.
      expect(block.style.border).toBe('1px solid rgba(27, 161, 226, 0.7)');
      expect(block.style.background).toBe('rgba(27, 161, 226, 0.12)');
      // The full border replaces the rail — no side stripe.
      expect(block.style.borderLeft).toBe('1px solid rgba(27, 161, 226, 0.7)');
      expect(block.style.borderLeftWidth).toBe('1px');
    });

    it('falls back to gray for an unknown or missing category', () => {
      renderGrid({
        '2026-07-15': [timed('e1', 'Mystery', '10:00', '11:00', { categories: [] })],
      });

      const block = screen.getByRole('button', { name: /Mystery/i });
      expect(block.style.border).toBe('1px solid rgba(204, 204, 204, 0.7)');
      expect(block.style.background).toBe('rgba(204, 204, 204, 0.12)');
    });

    it('dims a pending event', () => {
      renderGrid({
        '2026-07-15': [timed('e1', 'Requested Room', '10:00', '11:00', { status: 'pending' })],
      });

      const block = screen.getByRole('button', { name: /Requested Room/i });
      expect(block.className).toContain('pending');
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
        '2026-07-17': [timed('e2', 'Day Three', '10:00', '11:00', { startDate: '2026-07-17' })],
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

    it('maps real durations in a quiet hour onto the tiers', () => {
      // 30 min -> 26px, 45 min -> 39px, 60 min -> 52px, 90 min -> 78px.
      const tierOf = (start, end) => {
        const events = [timed('x', 'X', start, end)];
        return layoutDayEvents(events, buildTimeScale([events]))[0].tier;
      };

      expect(tierOf('10:00', '10:30')).toBe('short');
      expect(tierOf('10:00', '10:45')).toBe('med');
      expect(tierOf('10:00', '11:00')).toBe('tall');
      expect(tierOf('10:00', '11:30')).toBe('tall');
    });

    it('lifts a short event into a higher tier when its hour is contended', () => {
      // The elastic axis makes the tier a function of density-adjusted geometry:
      // the same 30 minutes buys more pixels where the pixels went.
      const pair = [
        timed('a', 'A', '10:00', '10:30'),
        timed('b', 'B', '10:00', '11:00'),
      ];
      const layout = layoutDayEvents(pair, buildTimeScale([pair]));
      const half = layout.find(i => i.event.id === 'a');

      expect(half.height).toBe(HOUR_HEIGHT_BUSY / 2); // 37, not 26
      expect(half.tier).toBe('med');
    });

    it('gives a minimum-height block the short tier', () => {
      const events = [timed('x', 'X', '10:00', '10:05')];
      const [block] = layoutDayEvents(events, buildTimeScale([events]));
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

    it('renders the time range on a tall block', () => {
      // A non-linear axis makes vertical position a weaker statement of
      // duration, and a tall block has the line to spare.
      renderGrid({ '2026-07-15': [timed('c', 'Full Hour', '19:00', '20:30')] });

      const block = screen.getByRole('button', { name: /Full Hour/i });
      expect(block.textContent).toContain('7:00 PM – 8:30 PM');
    });

    it('does not render the time on short or med blocks, but keeps it in the accessible name', () => {
      // On a 26px block the time line consumes the only line the title had —
      // and with no visible time, the aria-label is the ONLY source of it for a
      // screen reader.
      renderGrid({
        '2026-07-15': [
          timed('a', 'Half Hour', '08:00', '08:30'),
          timed('b', 'Three Quarters', '09:00', '09:45'),
        ],
      });

      expect(screen.getByRole('button', { name: /Half Hour/i }).textContent).toBe('Half Hour');
      expect(screen.getByRole('button', { name: /Three Quarters/i }).textContent).toBe('Three Quarters');
      expect(screen.getByRole('button', { name: 'Half Hour, 8:00 AM' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Three Quarters, 9:00 AM' })).toBeTruthy();
    });

    it('keeps the accessible name identical across every tier', () => {
      renderGrid({
        '2026-07-15': [
          timed('a', 'Half Hour', '08:00', '08:30'),
          timed('b', 'Three Quarters', '09:00', '09:45'),
          timed('c', 'Full Hour', '10:00', '11:30'),
        ],
      });

      expect(screen.getByRole('button', { name: 'Half Hour, 8:00 AM' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Three Quarters, 9:00 AM' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Full Hour, 10:00 AM' })).toBeTruthy();
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

    it('gives a split block enough height to be worth wrapping into', () => {
      const events = {
        '2026-07-15': [
          timed('e1', 'First', '10:00', '11:00'),
          timed('e2', 'Second', '10:30', '11:30'),
        ],
      };
      renderGrid(events);
      const scale = scaleFor(events);

      expect(scale.hourHeights[10]).toBe(HOUR_HEIGHT_BUSY);
      const first = screen.getByRole('button', { name: /First/i });
      expect(px(first, 'height')).toBe(HOUR_HEIGHT_BUSY);
      expect(first.className).toContain('tall');
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

    it('treats back-to-back events as separate clusters', () => {
      // 10:00-11:00 and 11:00-12:00 touch but do not overlap.
      const events = [
        timed('a', 'A', '10:00', '11:00'),
        timed('b', 'B', '11:00', '12:00'),
      ];
      const layout = layoutDayEvents(events, buildTimeScale([events]));
      expect(layout.every(i => i.kind === 'block' && i.widthPct === 100)).toBe(true);
    });
  });

  describe('stacks', () => {
    const threeWay = [
      timed('a', 'Board Meeting', '10:00', '12:00'),
      timed('b', 'Choir', '10:30', '11:00'),
      timed('c', 'Youth Group', '10:45', '11:30'),
    ];

    // Four events inside 45 minutes — the envelope cannot fit a row each.
    const fourWayTight = [
      timed('a', 'Alpha', '10:00', '10:30'),
      timed('b', 'Bravo', '10:05', '10:35'),
      timed('c', 'Charlie', '10:10', '10:40'),
      timed('d', 'Delta', '10:15', '10:45'),
    ];

    it('returns one stack descriptor for a cluster of three, not three slivers', () => {
      const layout = layoutDayEvents(threeWay, buildTimeScale([threeWay]));

      expect(layout).toHaveLength(1);
      expect(layout[0].kind).toBe('stack');
      expect(layout[0].widthPct).toBe(100);
      expect(layout[0].leftPct).toBe(0);
    });

    it('spans the cluster envelope from the earliest start to the latest end', () => {
      const scale = buildTimeScale([threeWay]);
      const [stack] = layoutDayEvents(threeWay, scale);

      expect(stack.startMinutes).toBe(10 * 60);
      expect(stack.endMinutes).toBe(12 * 60);
      expect(stack.top).toBe(minutesToY(scale, 10 * 60));
      expect(stack.height).toBe(minutesToY(scale, 12 * 60) - minutesToY(scale, 10 * 60));
      expect(stack.rangeLabel).toBe('10:00 AM – 12:00 PM');
    });

    it('covers the hours the envelope touches, and no more', () => {
      const [stack] = layoutDayEvents(threeWay, buildTimeScale([threeWay]));
      // 10:00-12:00 touches hours 10 and 11; hour 12 is not in the cluster.
      expect(stack.fromHour).toBe(10);
      expect(stack.toHour).toBe(11);
    });

    it('orders its rows by start time', () => {
      const shuffled = [threeWay[2], threeWay[0], threeWay[1]];
      const [stack] = layoutDayEvents(shuffled, buildTimeScale([shuffled]));

      expect(stack.rows.map(r => r.event.eventTitle))
        .toEqual(['Board Meeting', 'Choir', 'Youth Group']);
    });

    it('shows every row when the envelope is tall enough', () => {
      const [stack] = layoutDayEvents(threeWay, buildTimeScale([threeWay]));
      expect(stack.visibleCount).toBe(3);
      expect(stack.hiddenCount).toBe(0);
    });

    it('truncates with a count when the envelope is too short for every row', () => {
      const [stack] = layoutDayEvents(fourWayTight, buildTimeScale([fourWayTight]));

      expect(stack.height).toBe(STACK_MIN_HEIGHT);
      expect(stack.visibleCount).toBe(1);
      expect(stack.hiddenCount).toBe(3);
      expect(stack.visibleCount + stack.hiddenCount).toBe(stack.rows.length);
    });

    it('never renders a stack shorter than a header, one row, and the count', () => {
      const [stack] = layoutDayEvents(fourWayTight, buildTimeScale([fourWayTight]));
      expect(stack.height).toBeGreaterThanOrEqual(STACK_MIN_HEIGHT);
      expect(stack.height).toBeGreaterThanOrEqual(STACK_HEADER_HEIGHT + STACK_ROW_HEIGHT);
    });

    it('renders the container, a header stating the cluster, and a row per event', () => {
      const { container } = renderGrid({ '2026-07-15': threeWay });

      expect(container.querySelectorAll('.mobile-three-day-stack')).toHaveLength(1);
      expect(screen.getByRole('button', { name: '3 overlapping events, 10:00 AM – 12:00 PM' })).toBeTruthy();
      expect(container.querySelectorAll('.mobile-three-day-stack-row')).toHaveLength(3);
      // Not split into unreadable slivers.
      expect(container.querySelectorAll('.mobile-three-day-block')).toHaveLength(0);
    });

    it('states each row title, time, and location', () => {
      const { container } = renderGrid({ '2026-07-15': threeWay });

      const rows = [...container.querySelectorAll('.mobile-three-day-stack-row')];
      expect(rows[0].textContent).toContain('Board Meeting');
      expect(rows[0].textContent).toContain('10:00 AM');
      expect(rows[0].textContent).toContain('Greenwald Hall');
      expect(rows[1].textContent).toContain('Choir');
      expect(rows[1].textContent).toContain('10:30 AM');
    });

    it('opens the detail sheet for the row that was tapped', () => {
      const onEventTap = vi.fn();
      renderGrid({ '2026-07-15': threeWay }, { onEventTap });

      fireEvent.click(screen.getByRole('button', { name: 'Choir, 10:30 AM' }));

      expect(onEventTap).toHaveBeenCalledWith(threeWay[1]);
    });

    it('renders a +N more row when rows are hidden', () => {
      renderGrid({ '2026-07-15': fourWayTight });

      expect(screen.getByText('+3 more')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Alpha, 10:00 AM' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Delta/ })).toBeNull();
    });

    it('does not render a +N more row when everything fits', () => {
      renderGrid({ '2026-07-15': threeWay });
      expect(screen.queryByText(/more$/)).toBeNull();
    });
  });

  describe('gap bands', () => {
    it('renders one band per collapsed run, labelled with its range', () => {
      const events = { '2026-07-15': [timed('e1', 'Board Meeting', '09:00', '10:00')] };
      const { container } = renderGrid(events);

      expect(container.querySelectorAll('.mobile-three-day-gap')).toHaveLength(2);
      const dawn = screen.getByTestId('three-day-gap-0');
      expect(dawn.textContent).toBe('12a – 9a');
      expect(screen.getByTestId('three-day-gap-10').textContent).toBe('10a – 12a');
    });

    it('positions a band at its run and sizes it to the fixed run height', () => {
      const events = { '2026-07-15': [timed('e1', 'Board Meeting', '09:00', '10:00')] };
      const { container } = renderGrid(events);
      const scale = scaleFor(events);
      const run = scale.gapRuns.find(r => r.fromHour === 0);

      const band = screen.getByTestId('three-day-gap-0');
      expect(px(band, 'top')).toBe(run.top);
      expect(px(band, 'height')).toBe(run.height);
      expect(container).toBeTruthy();
    });

    it('draws no hour line or label for a collapsed hour', () => {
      const events = { '2026-07-15': [timed('e1', 'Board Meeting', '09:00', '10:00')] };
      const { container } = renderGrid(events);

      const labels = [...container.querySelectorAll('.mobile-three-day-hour-label')]
        .map(el => el.textContent);
      // Hours 0-8 and 10-23 collapse; only 9 keeps a label.
      expect(labels).toEqual(['9a']);
      // One line per visible hour, per column.
      expect(container.querySelectorAll('.mobile-three-day-hourline')).toHaveLength(3);
    });

    it('keeps a line and a label for an isolated empty hour', () => {
      const events = {
        '2026-07-15': [
          timed('a', 'Before', '09:00', '10:00'),
          timed('b', 'After', '11:00', '12:00'),
        ],
      };
      const { container } = renderGrid(events);

      const labels = [...container.querySelectorAll('.mobile-three-day-hour-label')]
        .map(el => el.textContent);
      expect(labels).toEqual(['9a', '10a', '11a']);
      expect(screen.queryByTestId('three-day-gap-10')).toBeNull();
    });
  });

  describe('expand', () => {
    const fourWayTight = [
      timed('a', 'Alpha', '10:00', '10:30'),
      timed('b', 'Bravo', '10:05', '10:35'),
      timed('c', 'Charlie', '10:10', '10:40'),
      timed('d', 'Delta', '10:15', '10:45'),
    ];

    it('reveals every event when a truncated stack is tapped', () => {
      renderGrid({ '2026-07-15': fourWayTight });
      expect(screen.getByText('+3 more')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: /4 overlapping events/ }));

      expect(screen.queryByText(/more$/)).toBeNull();
      ['Alpha', 'Bravo', 'Charlie', 'Delta'].forEach(title => {
        expect(screen.getByRole('button', { name: new RegExp(`^${title},`) })).toBeTruthy();
      });
    });

    it('collapses again when the same stack is tapped twice', () => {
      renderGrid({ '2026-07-15': fourWayTight });
      const header = () => screen.getByRole('button', { name: /4 overlapping events/ });

      fireEvent.click(header());
      expect(screen.queryByText('+3 more')).toBeNull();
      fireEvent.click(header());
      expect(screen.getByText('+3 more')).toBeTruthy();
    });

    it('marks the expanded stack for assistive tech', () => {
      const { container } = renderGrid({ '2026-07-15': fourWayTight });
      const header = () => screen.getByRole('button', { name: /4 overlapping events/ });

      expect(header().getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(header());
      expect(header().getAttribute('aria-expanded')).toBe('true');
      expect(container.querySelector('.mobile-three-day-stack.expanded')).toBeTruthy();
    });

    it('grows the grid rather than compressing the neighbouring hours', () => {
      const events = {
        '2026-07-15': [timed('quiet', 'Morning', '08:00', '09:00'), ...fourWayTight],
      };
      const { container } = renderGrid(events);
      const gridHeight = () => px(container.querySelector('.mobile-three-day-grid'), 'height');
      const morningTop = () => px(screen.getByRole('button', { name: /Morning/i }), 'top');

      const beforeHeight = gridHeight();
      const beforeMorning = morningTop();

      fireEvent.click(screen.getByRole('button', { name: /4 overlapping events/ }));

      expect(gridHeight()).toBeGreaterThan(beforeHeight);
      expect(morningTop()).toBe(beforeMorning);
    });

    it('expands a collapsed empty band to its uncollapsed height', () => {
      const events = { '2026-07-15': [timed('e1', 'Board Meeting', '09:00', '10:00')] };
      const { container } = renderGrid(events);

      expect(screen.getByTestId('three-day-gap-0')).toBeTruthy();
      fireEvent.click(screen.getByTestId('three-day-gap-0'));

      expect(screen.queryByTestId('three-day-gap-0')).toBeNull();
      const labels = [...container.querySelectorAll('.mobile-three-day-hour-label')]
        .map(el => el.textContent);
      expect(labels).toContain('12a');
      expect(labels).toContain('6a');
      expect(labels).toContain('9a');
    });

    it('collapses an expanded band when it is tapped again', () => {
      const events = { '2026-07-15': [timed('e1', 'Board Meeting', '09:00', '10:00')] };
      renderGrid(events);

      fireEvent.click(screen.getByTestId('three-day-gap-0'));
      expect(screen.queryByTestId('three-day-gap-0')).toBeNull();

      // The band is gone; the 12a hour line now stands in for it. Re-tapping is
      // reached through the band that is still there.
      fireEvent.click(screen.getByTestId('three-day-gap-10'));
      expect(screen.getByTestId('three-day-gap-0')).toBeTruthy();
    });

    it('keeps only one range expanded at a time', () => {
      const events = {
        '2026-07-15': [timed('e1', 'Board Meeting', '09:00', '10:00'), ...fourWayTight],
      };
      renderGrid(events);

      fireEvent.click(screen.getByRole('button', { name: /4 overlapping events/ }));
      expect(screen.queryByText('+3 more')).toBeNull();

      fireEvent.click(screen.getByTestId('three-day-gap-0'));

      // The stack re-truncated; the band took the expansion.
      expect(screen.getByText('+3 more')).toBeTruthy();
      expect(screen.queryByTestId('three-day-gap-0')).toBeNull();
    });

    it('clears the expansion when the focused date moves', () => {
      const events = {
        '2026-07-15': [...fourWayTight],
        '2026-07-16': [...fourWayTight.map(e => ({
          ...e,
          id: `${e.id}-16`,
          startDate: '2026-07-16',
          endDate: '2026-07-16',
          startDateTime: e.startDateTime.replace('07-15', '07-16'),
          endDateTime: e.endDateTime.replace('07-15', '07-16'),
        }))],
      };
      const { rerender } = renderGrid(events);

      fireEvent.click(screen.getAllByRole('button', { name: /4 overlapping events/ })[0]);
      expect(screen.queryByText('+3 more')).toBeNull();

      rerender(
        <MobileThreeDay
          selectedDate={new Date(2026, 6, 16)}
          groupedEvents={events}
          resolveCategoryColor={resolveCategoryColor}
          loading={false}
          error={null}
          onEventTap={vi.fn()}
          onRetry={vi.fn()}
        />
      );

      // The hours the range named belong to a window that is no longer on screen.
      expect(screen.getByText('+3 more')).toBeTruthy();
    });

    it('uses a view transition when the API is available', () => {
      const startViewTransition = vi.fn((cb) => {
        cb();
        return { finished: Promise.resolve(), ready: Promise.resolve(), updateCallbackDone: Promise.resolve() };
      });
      document.startViewTransition = startViewTransition;

      try {
        renderGrid({ '2026-07-15': fourWayTight });
        fireEvent.click(screen.getByRole('button', { name: /4 overlapping events/ }));

        expect(startViewTransition).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('+3 more')).toBeNull();
      } finally {
        delete document.startViewTransition;
      }
    });

    it('applies immediately, with the same result, under reduced motion', () => {
      const startViewTransition = vi.fn();
      document.startViewTransition = startViewTransition;
      // Restored explicitly: this is a direct assignment, so `restoreAllMocks`
      // would leave the shared setup mock replaced for every later test.
      const realMatchMedia = window.matchMedia;
      window.matchMedia = vi.fn().mockImplementation(query => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      try {
        renderGrid({ '2026-07-15': fourWayTight });
        fireEvent.click(screen.getByRole('button', { name: /4 overlapping events/ }));

        expect(startViewTransition).not.toHaveBeenCalled();
        // Identical to the animated case.
        expect(screen.queryByText('+3 more')).toBeNull();
        ['Alpha', 'Bravo', 'Charlie', 'Delta'].forEach(title => {
          expect(screen.getByRole('button', { name: new RegExp(`^${title},`) })).toBeTruthy();
        });
      } finally {
        delete document.startViewTransition;
        window.matchMedia = realMatchMedia;
      }
    });

    it('works with no view transition API at all', () => {
      expect(document.startViewTransition).toBeUndefined();
      renderGrid({ '2026-07-15': fourWayTight });

      fireEvent.click(screen.getByRole('button', { name: /4 overlapping events/ }));
      expect(screen.queryByText('+3 more')).toBeNull();
    });
  });

  describe('scroll anchoring', () => {
    const windowEvents = {
      '2026-07-15': [
        timed('a1', 'Alpha', '19:00', '20:30'),
        timed('a2', 'Bravo', '19:00', '20:00'),
        timed('a3', 'Charlie', '19:30', '21:00'),
      ],
      '2026-07-16': [timed('b1', 'Delta', '10:00', '11:00', { startDate: '2026-07-16' })],
      '2026-07-17': [timed('c1', 'Echo', '16:00', '17:00', { startDate: '2026-07-17' })],
      '2026-07-18': [timed('d1', 'Foxtrot', '08:00', '09:00', { startDate: '2026-07-18' })],
    };

    function rerenderAt(rerender, date) {
      rerender(
        <MobileThreeDay
          selectedDate={date}
          groupedEvents={windowEvents}
          resolveCategoryColor={resolveCategoryColor}
          loading={false}
          error={null}
          onEventTap={vi.fn()}
          onRetry={vi.fn()}
        />
      );
    }

    it('keeps the time at the top of the viewport across a window change', () => {
      const { rerender } = renderGrid(windowEvents);
      const scroller = screen.getByTestId('three-day-scroll');

      const before = scaleFor(windowEvents, ['2026-07-15', '2026-07-16', '2026-07-17']);
      const after = scaleFor(windowEvents, ['2026-07-16', '2026-07-17', '2026-07-18']);

      // The two windows genuinely disagree about the shape of the day.
      expect(before.hourHeights[19]).toBe(HOUR_HEIGHT_CROWDED);
      expect(after.hourHeights[19]).not.toBe(HOUR_HEIGHT_CROWDED);

      scroller.scrollTop = minutesToY(before, 16 * 60);
      rerenderAt(rerender, new Date(2026, 6, 16));

      expect(scroller.scrollTop).toBeCloseTo(minutesToY(after, 16 * 60), 6);
    });

    it('does not simply keep the raw offset', () => {
      const { rerender } = renderGrid(windowEvents);
      const scroller = screen.getByTestId('three-day-scroll');
      const before = scaleFor(windowEvents, ['2026-07-15', '2026-07-16', '2026-07-17']);

      const raw = minutesToY(before, 20 * 60);
      scroller.scrollTop = raw;
      rerenderAt(rerender, new Date(2026, 6, 16));

      expect(scroller.scrollTop).not.toBe(raw);
    });

    it('resolves an anchor that lands inside a newly collapsed run', () => {
      const { rerender } = renderGrid(windowEvents);
      const scroller = screen.getByTestId('three-day-scroll');

      const before = scaleFor(windowEvents, ['2026-07-15', '2026-07-16', '2026-07-17']);
      const after = scaleFor(windowEvents, ['2026-07-16', '2026-07-17', '2026-07-18']);

      // 19:00 is a real hour in the first window and collapsed in the second.
      expect(before.collapsed[19]).toBe(false);
      expect(after.collapsed[19]).toBe(true);

      scroller.scrollTop = minutesToY(before, 19 * 60);
      rerenderAt(rerender, new Date(2026, 6, 16));

      expect(Number.isFinite(scroller.scrollTop)).toBe(true);
      expect(scroller.scrollTop).toBeCloseTo(minutesToY(after, 19 * 60), 6);
      const run = after.gapRuns.find(r => r.fromHour <= 19 && r.toHour >= 19);
      expect(scroller.scrollTop).toBeGreaterThanOrEqual(run.top - GRID_TOP_INSET);
    });

    it('holds the expanded range in place when it expands', () => {
      const fourWayTight = [
        timed('a', 'Alpha', '10:00', '10:30'),
        timed('b', 'Bravo', '10:05', '10:35'),
        timed('c', 'Charlie', '10:10', '10:40'),
        timed('d', 'Delta', '10:15', '10:45'),
      ];
      renderGrid({ '2026-07-15': [timed('early', 'Morning', '08:00', '09:00'), ...fourWayTight] });
      const scroller = screen.getByTestId('three-day-scroll');

      const stackTop = () =>
        px(screen.getByTestId('three-day-stack-10'), 'top') - scroller.scrollTop;
      const before = stackTop();

      fireEvent.click(screen.getByRole('button', { name: /4 overlapping events/ }));

      expect(stackTop()).toBeCloseTo(before, 6);
    });
  });

  describe('axis lock', () => {
    const threeWay = [
      timed('a', 'Board Meeting', '10:00', '12:00'),
      timed('b', 'Choir', '10:30', '11:00'),
      timed('c', 'Youth Group', '10:45', '11:30'),
    ];

    it('does not open a block when the gesture locked to the horizontal axis', () => {
      const onEventTap = vi.fn();
      renderGrid(
        { '2026-07-15': [timed('e1', 'Board Meeting', '10:00', '11:00')] },
        { onEventTap, axisRef: { current: 'x' } }
      );

      fireEvent.click(screen.getByRole('button', { name: /Board Meeting/i }));
      expect(onEventTap).not.toHaveBeenCalled();
    });

    it('does not open a stack row when the gesture locked to the horizontal axis', () => {
      const onEventTap = vi.fn();
      renderGrid({ '2026-07-15': threeWay }, { onEventTap, axisRef: { current: 'x' } });

      fireEvent.click(screen.getByRole('button', { name: 'Choir, 10:30 AM' }));
      expect(onEventTap).not.toHaveBeenCalled();
    });

    it('does not open an all-day chip when the gesture locked to the horizontal axis', () => {
      const onEventTap = vi.fn();
      renderGrid(
        {
          '2026-07-15': [{
            id: 'ad1',
            status: 'published',
            eventTitle: 'Office Closed',
            categories: ['Worship'],
            isAllDayEvent: true,
            startDate: '2026-07-15',
            endDate: '2026-07-15',
            startDateTime: '2026-07-15T00:00:00',
            endDateTime: '2026-07-16T00:00:00',
          }],
        },
        { onEventTap, axisRef: { current: 'x' } }
      );

      fireEvent.click(screen.getByRole('button', { name: 'Office Closed' }));
      expect(onEventTap).not.toHaveBeenCalled();
    });

    it('does not expand a range when the gesture locked to the horizontal axis', () => {
      renderGrid(
        { '2026-07-15': [timed('e1', 'Board Meeting', '09:00', '10:00')] },
        { axisRef: { current: 'x' } }
      );

      fireEvent.click(screen.getByTestId('three-day-gap-0'));
      expect(screen.getByTestId('three-day-gap-0')).toBeTruthy();
    });

    it('acts normally on a vertical or unlocked gesture', () => {
      const onEventTap = vi.fn();
      const event = timed('e1', 'Board Meeting', '10:00', '11:00');

      const { unmount } = renderGrid(
        { '2026-07-15': [event] },
        { onEventTap, axisRef: { current: 'y' } }
      );
      fireEvent.click(screen.getByRole('button', { name: /Board Meeting/i }));
      expect(onEventTap).toHaveBeenCalledTimes(1);
      unmount();

      renderGrid({ '2026-07-15': [event] }, { onEventTap, axisRef: { current: null } });
      fireEvent.click(screen.getByRole('button', { name: /Board Meeting/i }));
      expect(onEventTap).toHaveBeenCalledTimes(2);
    });

    it('still works with no axisRef at all', () => {
      const onEventTap = vi.fn();
      renderGrid({ '2026-07-15': [timed('e1', 'Board Meeting', '10:00', '11:00')] }, { onEventTap });

      fireEvent.click(screen.getByRole('button', { name: /Board Meeting/i }));
      expect(onEventTap).toHaveBeenCalledTimes(1);
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

    it('gives a chip the same border-and-wash treatment as a timed block', () => {
      renderGrid({ '2026-07-16': [allDay] });

      const chip = screen.getByRole('button', { name: 'Office Closed' });
      expect(chip.style.border).toBe('1px solid rgba(27, 161, 226, 0.7)');
      expect(chip.style.background).toBe('rgba(27, 161, 226, 0.12)');
    });

    it('keeps all-day events out of the timed grid', () => {
      const { container } = renderGrid({ '2026-07-16': [allDay] });
      expect(container.querySelectorAll('.mobile-three-day-block')).toHaveLength(0);
      expect(container.querySelectorAll('.mobile-three-day-stack')).toHaveLength(0);
    });
  });

  describe('current-time indicator', () => {
    it('renders only in today column, at the current time', () => {
      const events = { '2026-07-15': [timed('e1', 'Board Meeting', '10:00', '11:00')] };
      renderGrid(events);
      const scale = scaleFor(events);

      const indicators = screen.getAllByTestId('three-day-now-indicator');
      expect(indicators).toHaveLength(1);
      // 10:30 -> half way through a single-booking hour 10.
      expect(px(indicators[0], 'top')).toBe(minutesToY(scale, 10 * 60 + 30));

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
