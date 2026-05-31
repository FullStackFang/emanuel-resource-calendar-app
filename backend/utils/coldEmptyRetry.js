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
 * @param {() => Promise<Array>} runFind  - executes the find().toArray()
 * @param {() => Promise<number>} runCount - executes countDocuments() for the same query
 * @param {Object} [options]
 * @param {number} [options.maxRetries=3]  - bounded retry count (no infinite loop)
 * @param {number} [options.delayMs=250]   - base delay; attempt N waits delayMs * N
 * @param {(ms:number)=>Promise} [options.sleep] - injectable for tests
 * @param {(info:{attempt:number,count:number,maxRetries:number})=>void} [options.onColdEmpty]
 *        - observability hook, called once per cold-empty retry attempt
 * @returns {Promise<Array>} the find results (recovered data, or [] if genuinely
 *          empty or if the cold window outlasts the bounded retries)
 */
async function findWithColdEmptyRetry(runFind, runCount, options = {}) {
  const {
    maxRetries = 3,
    delayMs = 250,
    sleep = defaultSleep,
    onColdEmpty = null,
  } = options;

  let results = await runFind();
  if (results.length > 0) return results;

  // Empty find — distinguish a genuinely-empty range from a cold false-empty.
  const count = await runCount();
  if (count === 0) return results; // authoritative empty: nothing to recover

  for (let attempt = 1; attempt <= maxRetries && results.length === 0; attempt++) {
    if (onColdEmpty) onColdEmpty({ attempt, count, maxRetries });
    await sleep(delayMs * attempt);
    results = await runFind();
  }
  return results;
}

module.exports = { findWithColdEmptyRetry };
