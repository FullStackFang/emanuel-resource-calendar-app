// src/__tests__/unit/components/mobile/timeScale.test.js
//
// The elastic time axis, tested without a render.
//
// `buildTimeScale` / `minutesToY` / `yToMinutes` are the arithmetic the whole
// grid is drawn from, and a grid drawn an hour off still looks like a valid
// calendar. Keeping them pure is what lets these assertions be exact pixel
// values rather than tolerances — the same property that made the old fixed-52px
// block tests trustworthy, carried over to a scale that is no longer uniform.
//
// Run heights are distributed as integers precisely so every offset stays an
// integer and every assertion here can be `toBe`, not `toBeCloseTo`.

import { describe, it, expect } from 'vitest';

import {
  buildTimeScale,
  minutesToY,
  yToMinutes,
  HOUR_HEIGHT,
  HOUR_HEIGHT_BUSY,
  HOUR_HEIGHT_CROWDED,
  EMPTY_HOUR_HEIGHT,
  GAP_RUN_HEIGHT,
  EXPANDED_HOUR_HEIGHT,
  GRID_TOP_INSET,
  MINUTES_PER_DAY,
} from '../../../../components/mobile/MobileThreeDay';

/** A timed event on a fixed day — only the times matter to the scale. */
function ev(startTime, endTime, extra = {}) {
  return {
    id: `${startTime}-${endTime}-${Math.random()}`,
    startDate: '2026-07-15',
    endDate: '2026-07-15',
    startDateTime: `2026-07-15T${startTime}:00`,
    endDateTime: `2026-07-15T${endTime}:00`,
    ...extra,
  };
}

describe('buildTimeScale', () => {
  describe('concurrency tiers', () => {
    it('gives a single-booking hour the established height, unchanged', () => {
      const scale = buildTimeScale([[ev('10:00', '11:00')], [], []]);
      expect(scale.hourHeights[10]).toBe(HOUR_HEIGHT);
      expect(HOUR_HEIGHT).toBe(52);
    });

    it('grows an hour with two concurrent events', () => {
      const scale = buildTimeScale([[ev('10:00', '11:00'), ev('10:30', '11:30')], [], []]);
      expect(scale.hourHeights[10]).toBe(HOUR_HEIGHT_BUSY);
      expect(HOUR_HEIGHT_BUSY).toBeGreaterThan(HOUR_HEIGHT);
    });

    it('grows an hour with three or more concurrent events', () => {
      const scale = buildTimeScale([
        [ev('10:00', '11:00'), ev('10:30', '11:30'), ev('10:45', '11:15')],
        [],
        [],
      ]);
      expect(scale.hourHeights[10]).toBe(HOUR_HEIGHT_CROWDED);
      expect(HOUR_HEIGHT_CROWDED).toBeGreaterThan(HOUR_HEIGHT_BUSY);
    });

    it('caps the tier at three — a fourth concurrent event does not grow it further', () => {
      const scale = buildTimeScale([
        [
          ev('10:00', '11:00'),
          ev('10:00', '11:00'),
          ev('10:00', '11:00'),
          ev('10:00', '11:00'),
        ],
        [],
        [],
      ]);
      expect(scale.hourHeights[10]).toBe(HOUR_HEIGHT_CROWDED);
    });

    it('counts concurrency per column and maxes, rather than pooling the columns', () => {
      // One event per day at the same clock time is three single-booking hours,
      // not a three-way overlap. Pooling would read this as contention and
      // inflate an hour nobody is fighting over.
      const scale = buildTimeScale([
        [ev('10:00', '11:00')],
        [ev('10:00', '11:00')],
        [ev('10:00', '11:00')],
      ]);
      expect(scale.concurrency[10]).toBe(1);
      expect(scale.hourHeights[10]).toBe(HOUR_HEIGHT);
    });

    it('takes the busiest column for the shared scale', () => {
      const scale = buildTimeScale([
        [ev('10:00', '11:00')],
        [ev('10:00', '11:00'), ev('10:15', '10:45'), ev('10:30', '11:30')],
        [ev('10:00', '11:00')],
      ]);
      expect(scale.concurrency[10]).toBe(3);
      expect(scale.hourHeights[10]).toBe(HOUR_HEIGHT_CROWDED);
    });

    it('does not treat back-to-back events within an hour as concurrent', () => {
      // Both sit inside hour 10 but never coexist.
      const scale = buildTimeScale([[ev('10:00', '10:30'), ev('10:30', '11:00')], [], []]);
      expect(scale.concurrency[10]).toBe(1);
      expect(scale.hourHeights[10]).toBe(HOUR_HEIGHT);
    });

    it('counts an event that runs through an hour it neither starts nor ends in', () => {
      const scale = buildTimeScale([[ev('09:00', '12:00'), ev('10:15', '10:45')], [], []]);
      expect(scale.concurrency[10]).toBe(2);
      expect(scale.hourHeights[10]).toBe(HOUR_HEIGHT_BUSY);
    });

    it('excludes all-day events from the scale', () => {
      const scale = buildTimeScale([
        [ev('00:00', '23:59', { isAllDayEvent: true })],
        [],
        [],
      ]);
      expect(scale.concurrency.every(c => c === 0)).toBe(true);
    });
  });

  describe('empty hours', () => {
    it('gives an isolated empty hour a reduced height and no band', () => {
      // 9 and 11 populated, 10 empty.
      const scale = buildTimeScale([[ev('09:00', '10:00'), ev('11:00', '12:00')], [], []]);
      expect(scale.hourHeights[10]).toBe(EMPTY_HOUR_HEIGHT);
      expect(EMPTY_HOUR_HEIGHT).toBeLessThan(HOUR_HEIGHT);
      expect(scale.gapRuns.some(r => r.fromHour <= 10 && r.toHour >= 10)).toBe(false);
      expect(scale.collapsed[10]).toBe(false);
    });

    it('collapses a run of two or more empty hours into one band', () => {
      // 9 and 13 populated; 10, 11, 12 empty.
      const scale = buildTimeScale([[ev('09:00', '10:00'), ev('13:00', '14:00')], [], []]);
      const run = scale.gapRuns.find(r => r.fromHour === 10);
      expect(run).toBeTruthy();
      expect(run.toHour).toBe(12);
      expect(run.height).toBe(GAP_RUN_HEIGHT);
      expect(scale.collapsed[10]).toBe(true);
      expect(scale.collapsed[11]).toBe(true);
      expect(scale.collapsed[12]).toBe(true);
    });

    it('holds a run to the same total no matter how many hours it spans', () => {
      const three = buildTimeScale([[ev('09:00', '10:00'), ev('13:00', '14:00')], [], []]);
      const eight = buildTimeScale([[ev('09:00', '10:00'), ev('18:00', '19:00')], [], []]);

      const runOf = (scale) => scale.gapRuns.find(r => r.fromHour === 10);
      expect(runOf(three).toHour).toBe(12);
      expect(runOf(eight).toHour).toBe(17);
      expect(runOf(three).height).toBe(GAP_RUN_HEIGHT);
      expect(runOf(eight).height).toBe(GAP_RUN_HEIGHT);
    });

    it('distributes a run as integers that sum to exactly the run height', () => {
      // Integer distribution is what keeps every offset — and therefore every
      // block position — an exact pixel rather than a float that drifts.
      const scale = buildTimeScale([[ev('09:00', '10:00'), ev('17:00', '18:00')], [], []]);
      const hours = [10, 11, 12, 13, 14, 15, 16];
      const heights = hours.map(h => scale.hourHeights[h]);

      heights.forEach(h => expect(Number.isInteger(h)).toBe(true));
      expect(heights.reduce((a, b) => a + b, 0)).toBe(GAP_RUN_HEIGHT);
      // "Split evenly" within integer rounding — no hour is more than 1px off
      // any other.
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
    });

    it('labels a band with the range it covers', () => {
      const scale = buildTimeScale([[ev('09:00', '10:00')], [], []]);
      const dawn = scale.gapRuns.find(r => r.fromHour === 0);
      expect(dawn.toHour).toBe(8);
      expect(dawn.label).toBe('12a – 9a');
    });

    it('labels a band that runs to the end of the day', () => {
      const scale = buildTimeScale([[ev('20:00', '21:00')], [], []]);
      const night = scale.gapRuns.find(r => r.fromHour === 21);
      expect(night.toHour).toBe(23);
      expect(night.label).toBe('9p – 12a');
    });

    it('keeps a collapsed run ordered between the hours around it', () => {
      const scale = buildTimeScale([[ev('09:00', '10:00'), ev('13:00', '14:00')], [], []]);
      const before = minutesToY(scale, 9 * 60);
      const run = scale.gapRuns.find(r => r.fromHour === 10);
      const after = minutesToY(scale, 13 * 60);

      expect(run.top).toBeGreaterThan(before);
      expect(after).toBeGreaterThan(run.top + run.height - 1);
    });

    it('collapses a fully empty window into a single band', () => {
      const scale = buildTimeScale([[], [], []]);
      expect(scale.gapRuns).toHaveLength(1);
      expect(scale.gapRuns[0]).toMatchObject({ fromHour: 0, toHour: 23, height: GAP_RUN_HEIGHT });
      expect(scale.totalHeight).toBe(GAP_RUN_HEIGHT);
    });
  });

  describe('offsets', () => {
    const scale = buildTimeScale([
      [ev('09:00', '10:00'), ev('19:00', '20:30'), ev('19:30', '21:00')],
      [ev('19:00', '20:00')],
      [],
    ]);

    it('starts at zero and increases monotonically', () => {
      expect(scale.offsets).toHaveLength(25);
      expect(scale.offsets[0]).toBe(0);
      for (let h = 0; h < 24; h += 1) {
        expect(scale.offsets[h + 1]).toBeGreaterThan(scale.offsets[h]);
      }
    });

    it('accumulates the hour heights exactly', () => {
      for (let h = 0; h < 24; h += 1) {
        expect(scale.offsets[h + 1] - scale.offsets[h]).toBe(scale.hourHeights[h]);
      }
    });

    it('ends at the total height', () => {
      expect(scale.totalHeight).toBe(scale.offsets[24]);
      expect(scale.totalHeight).toBe(scale.hourHeights.reduce((a, b) => a + b, 0));
    });
  });

  describe('firstEventHour', () => {
    it('reports the earliest populated hour across all three columns', () => {
      const scale = buildTimeScale([
        [ev('14:00', '15:00')],
        [ev('07:00', '08:00')],
        [ev('09:00', '10:00')],
      ]);
      expect(scale.firstEventHour).toBe(7);
    });

    it('is null on an empty window', () => {
      expect(buildTimeScale([[], [], []]).firstEventHour).toBeNull();
    });
  });

  describe('expanded range', () => {
    it('gives a populated hour inside the range the expanded height', () => {
      const columns = [[ev('19:00', '20:00'), ev('19:15', '20:15'), ev('19:30', '20:30')], [], []];
      const collapsed = buildTimeScale(columns);
      const expanded = buildTimeScale(columns, { fromHour: 19, toHour: 20 });

      expect(collapsed.hourHeights[19]).toBe(HOUR_HEIGHT_CROWDED);
      expect(expanded.hourHeights[19]).toBe(EXPANDED_HOUR_HEIGHT);
      expect(expanded.hourHeights[20]).toBe(EXPANDED_HOUR_HEIGHT);
      expect(expanded.totalHeight).toBeGreaterThan(collapsed.totalHeight);
    });

    it('uncollapses an empty run to its natural height rather than the expanded one', () => {
      // The spec is explicit that a tapped empty band expands "to their
      // uncollapsed height". Applying the 168px populated-hour height to six
      // empty hours would be ~1000px of void, which is not what "bookable
      // looking" means.
      const columns = [[ev('09:00', '10:00')], [], []];
      const expanded = buildTimeScale(columns, { fromHour: 0, toHour: 8 });

      expect(expanded.hourHeights[0]).toBe(EMPTY_HOUR_HEIGHT);
      expect(expanded.hourHeights[8]).toBe(EMPTY_HOUR_HEIGHT);
      expect(expanded.gapRuns.some(r => r.fromHour === 0)).toBe(false);
      expect(expanded.collapsed[0]).toBe(false);
    });

    it('leaves hours outside the range at their natural height', () => {
      const columns = [[ev('09:00', '10:00'), ev('19:00', '20:00')], [], []];
      const expanded = buildTimeScale(columns, { fromHour: 19, toHour: 19 });
      expect(expanded.hourHeights[9]).toBe(HOUR_HEIGHT);
    });

    it('ignores a null range', () => {
      const columns = [[ev('19:00', '20:00')], [], []];
      expect(buildTimeScale(columns, null).hourHeights[19]).toBe(HOUR_HEIGHT);
    });
  });

  describe('representative three-day window', () => {
    // A plausible Wed/Thu/Fri at Temple Emanuel: a daily minyan, a scattered
    // daytime, and an evening where the rooms actually collide.
    const wed = [
      ev('07:00', '08:00'), // Minyan
      ev('09:00', '10:30'), // Staff meeting
      ev('16:00', '17:30'), // Hebrew School
      ev('17:00', '18:00'), // Youth group
      ev('19:00', '20:30'), // Board meeting
      ev('19:00', '20:00'), // Rosh Chodesh
      ev('19:30', '21:00'), // Choir
    ];
    const thu = [
      ev('07:00', '08:00'),
      ev('12:00', '13:00'),
      ev('18:00', '19:00'),
      ev('18:30', '20:00'),
      ev('19:00', '20:00'),
    ];
    const fri = [
      ev('07:00', '08:00'),
      ev('10:00', '11:00'),
      ev('18:00', '19:30'), // Kabbalat Shabbat
      ev('19:30', '21:00'), // Dinner
    ];
    const scale = buildTimeScale([wed, thu, fri]);

    it('is shorter overall than the uniform 24-hour grid it replaces', () => {
      const uniformTotal = GRID_TOP_INSET + 24 * HOUR_HEIGHT;
      expect(uniformTotal).toBe(1256);
      expect(GRID_TOP_INSET + scale.totalHeight).toBe(704);
      expect(GRID_TOP_INSET + scale.totalHeight).toBeLessThan(uniformTotal);
    });

    it('roughly doubles the hour where the collisions actually are', () => {
      expect(scale.concurrency[19]).toBe(3);
      expect(scale.hourHeights[19]).toBe(HOUR_HEIGHT_CROWDED);
      expect(scale.hourHeights[19] / HOUR_HEIGHT).toBeGreaterThan(1.8);
    });

    it('spends almost nothing on the pre-dawn hours', () => {
      const preDawn = [0, 1, 2, 3, 4, 5, 6].reduce((sum, h) => sum + scale.hourHeights[h], 0);
      expect(preDawn).toBe(GAP_RUN_HEIGHT);
      // The same stretch costs 364px on the uniform grid.
      expect(preDawn).toBeLessThan(7 * HOUR_HEIGHT);
    });

    it('gives the 4-9 PM window a far larger share of the grid than before', () => {
      const eveningHours = [16, 17, 18, 19, 20];
      const evening = eveningHours.reduce((sum, h) => sum + scale.hourHeights[h], 0);
      const uniformShare = (eveningHours.length * HOUR_HEIGHT) / (24 * HOUR_HEIGHT);
      const elasticShare = evening / scale.totalHeight;

      expect(uniformShare).toBeCloseTo(0.208, 3);
      expect(elasticShare).toBeGreaterThan(0.45);
    });
  });
});

describe('minutesToY / yToMinutes', () => {
  const columns = [
    [ev('09:00', '10:00'), ev('19:00', '20:30'), ev('19:30', '21:00')],
    [ev('12:00', '13:00')],
    [],
  ];
  const scale = buildTimeScale(columns);

  it('places midnight at the grid inset', () => {
    expect(minutesToY(scale, 0)).toBe(GRID_TOP_INSET);
  });

  it('places every hour boundary exactly on its offset', () => {
    for (let h = 0; h < 24; h += 1) {
      expect(minutesToY(scale, h * 60)).toBe(GRID_TOP_INSET + scale.offsets[h]);
    }
  });

  it('places the end of the day at the full height', () => {
    expect(minutesToY(scale, MINUTES_PER_DAY)).toBe(GRID_TOP_INSET + scale.totalHeight);
  });

  it('interpolates linearly within an hour', () => {
    const top = minutesToY(scale, 19 * 60);
    const half = minutesToY(scale, 19 * 60 + 30);
    expect(half - top).toBe(scale.hourHeights[19] / 2);
  });

  it('round-trips an arbitrary time', () => {
    [0, 7 * 60 + 15, 9 * 60, 12 * 60 + 45, 19 * 60 + 30, 23 * 60 + 59].forEach(m => {
      expect(yToMinutes(scale, minutesToY(scale, m))).toBeCloseTo(m, 6);
    });
  });

  it('round-trips a time inside a collapsed run', () => {
    // 03:30 sits in the collapsed midnight band; the mapping still resolves it
    // to a real position rather than snapping to the band edge.
    expect(scale.collapsed[3]).toBe(true);
    const y = minutesToY(scale, 3 * 60 + 30);
    expect(y).toBeGreaterThan(minutesToY(scale, 3 * 60));
    expect(y).toBeLessThan(minutesToY(scale, 4 * 60));
    expect(yToMinutes(scale, y)).toBeCloseTo(3 * 60 + 30, 6);
  });

  it('round-trips every hour boundary exactly', () => {
    for (let h = 0; h < 24; h += 1) {
      expect(yToMinutes(scale, minutesToY(scale, h * 60))).toBe(h * 60);
    }
  });

  it('clamps above and below the grid', () => {
    expect(yToMinutes(scale, -500)).toBe(0);
    expect(yToMinutes(scale, GRID_TOP_INSET + scale.totalHeight + 500)).toBe(MINUTES_PER_DAY);
  });

  it('is monotonic', () => {
    let previous = -Infinity;
    for (let m = 0; m <= MINUTES_PER_DAY; m += 7) {
      const y = minutesToY(scale, m);
      expect(y).toBeGreaterThan(previous);
      previous = y;
    }
  });
});
