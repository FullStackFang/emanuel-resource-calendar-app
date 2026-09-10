// backend/utils/settleWithConcurrency.js
//
// Promise.allSettled with a ceiling on how many tasks run at once.
//
// Same contract as allSettled — every item runs, one rejection never stops the
// others, results are returned in INPUT order as { status, value | reason } —
// but at most `limit` tasks are in flight at any moment. Pure, dependency-free.
//
// Why it exists: Microsoft Graph allows 4 concurrent requests per app per
// mailbox and REJECTS the rest with 429 rather than queueing them. A fan-out
// written as Promise.allSettled(recipients.map(send)) therefore fails most of
// a 40-person send by construction. Retry alone does not fix that — 36 retries
// against a 4-slot window is still a stampede — so the window itself has to be
// bounded.

/**
 * @template T, R
 * @param {T[]} items
 * @param {number} limit - maximum tasks in flight; values < 1 are treated as 1
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<Array<{status: 'fulfilled', value: R} | {status: 'rejected', reason: any}>>}
 */
async function settleWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from({ length: width }, worker));
  return results;
}

module.exports = { settleWithConcurrency };
