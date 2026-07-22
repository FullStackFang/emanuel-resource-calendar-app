// backend/utils/coldEmptyRetry.js
//
// Guards a Cosmos cross-partition find() against the documented "cold
// false-empty" behavior: a cold partition (index metadata warming) can return
// [] from find() even when documents match the query. withCosmosRetry only
// retries throttle ERRORS (code 16500), not a silently-empty result, so an
// unguarded primary find blanks the calendar grid on a fresh reload.
//
// See repo memory project_cosmos_cold_query_empty and the sibling guard in
// exceptionDocumentService.enrichSeriesMastersWithOverrides, which this
// generalizes into a tested, reusable helper.

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a find, and if it comes back empty, reconcile against an authoritative
 * count before accepting the empty result. A count > 0 means the empty find was
 * a cold false-empty, so re-run the find up to maxRetries with linear backoff.
 *
 * With no expectedFromCount (default), behaves as above: any non-empty first find
 * is returned immediately without a count round-trip; an empty first find is
 * reconciled and retried if count > 0.
 *
 * With expectedFromCount supplied, treats a PARTIAL result as suspect: if results.length
 * < expectedFromCount(count), retries up to maxRetries times with backoff, returning
 * the longest result seen (best-so-far, not last-seen).
 *
 * @param {() => Promise<Array>} runFind  - executes the find().toArray()
 * @param {() => Promise<number>} runCount - executes countDocuments() for the same query
 * @param {Object} [options]
 * @param {number} [options.maxRetries=3]  - bounded retry count (no infinite loop)
 * @param {number} [options.delayMs=250]   - base delay; attempt N waits delayMs * N
 * @param {(ms:number)=>Promise} [options.sleep] - injectable for tests
 * @param {(info:{attempt:number,count:number,maxRetries:number,got?:number,expected?:number})=>void} [options.onColdEmpty]
 *        - observability hook, called once per cold-empty retry attempt (got/expected fields added when expectedFromCount is used)
 * @param {(count:number)=>number} [options.expectedFromCount] - optional function that computes
 *        the expected minimum result count given the authoritative count; when provided,
 *        retries a partial find that falls short of the expectation
 * @returns {Promise<Array>} the find results (recovered data, or [] if genuinely
 *          empty or if the cold window outlasts the bounded retries)
 */
async function findWithColdEmptyRetry(runFind, runCount, options = {}) {
  const {
    maxRetries = 3,
    delayMs = 250,
    sleep = defaultSleep,
    onColdEmpty = null,
    // Expected minimum result length as a function of the authoritative count.
    // Default preserves the original contract: any non-empty find is accepted
    // without a count round-trip; an empty find is reconciled against count>0.
    expectedFromCount = null,
  } = options;

  let results = await runFind();

  // Original fast path: with no explicit expectation, a non-empty find is
  // accepted immediately (no count query issued).
  if (!expectedFromCount && results.length > 0) return results;

  const count = await runCount();
  const expected = expectedFromCount ? expectedFromCount(count) : (count > 0 ? 1 : 0);
  if (results.length >= expected) return results;

  let best = results;
  for (let attempt = 1; attempt <= maxRetries && best.length < expected; attempt++) {
    if (onColdEmpty) onColdEmpty({ attempt, count, maxRetries, got: best.length, expected });
    await sleep(delayMs * attempt);
    results = await runFind();
    if (results.length > best.length) best = results;
  }
  return best;
}

module.exports = { findWithColdEmptyRetry };
