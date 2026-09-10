/**
 * settleWithConcurrency (SWC-1 to SWC-5)
 *
 * Promise.allSettled semantics — every item runs, one rejection never stops
 * the rest, results come back in INPUT order — but with a ceiling on how many
 * run at once. Exists because Microsoft Graph allows 4 concurrent requests per
 * mailbox and a 40-recipient fan-out was firing all 40 at once.
 */

const { settleWithConcurrency } = require('../../../utils/settleWithConcurrency');

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe('settleWithConcurrency', () => {
  test('SWC-1 never runs more than `limit` tasks at once', async () => {
    let inFlight = 0;
    let highWater = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await settleWithConcurrency(items, 4, async () => {
      inFlight++;
      highWater = Math.max(highWater, inFlight);
      await tick();
      inFlight--;
    });

    expect(highWater).toBe(4);
  });

  test('SWC-2 results come back in input order regardless of completion order', async () => {
    const items = [30, 5, 15];
    const settled = await settleWithConcurrency(items, 3, async (ms) => {
      await tick(ms);
      return `done-${ms}`;
    });
    expect(settled.map((s) => s.value)).toEqual(['done-30', 'done-5', 'done-15']);
  });

  test('SWC-3 a rejection is reported in place and every other item still runs', async () => {
    const ran = [];
    const settled = await settleWithConcurrency(['a', 'b', 'c'], 1, async (x) => {
      ran.push(x);
      if (x === 'b') throw new Error('boom');
      return x.toUpperCase();
    });

    expect(ran).toEqual(['a', 'b', 'c']);
    expect(settled[0]).toEqual({ status: 'fulfilled', value: 'A' });
    expect(settled[1].status).toBe('rejected');
    expect(settled[1].reason.message).toBe('boom');
    expect(settled[2]).toEqual({ status: 'fulfilled', value: 'C' });
  });

  test('SWC-4 a limit larger than the list runs everything at once', async () => {
    let inFlight = 0;
    let highWater = 0;
    await settleWithConcurrency([1, 2, 3], 10, async () => {
      inFlight++;
      highWater = Math.max(highWater, inFlight);
      await tick();
      inFlight--;
    });
    expect(highWater).toBe(3);
  });

  test('SWC-5 an empty list resolves to an empty array without calling fn', async () => {
    const fn = jest.fn();
    await expect(settleWithConcurrency([], 4, fn)).resolves.toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});
