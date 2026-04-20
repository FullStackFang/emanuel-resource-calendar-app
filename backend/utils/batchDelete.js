/**
 * Batch Delete Utility
 *
 * Extracts the "find batch → delete batch → report progress" loop from
 * inline route handlers into a testable, bounded function. Uses
 * retryWithBackoff for each deleteMany call so Cosmos 429s don't cause
 * infinite retries.
 *
 * Usage:
 *   const { batchDelete } = require('./batchDelete');
 *   const result = await batchDelete(collection, { userId, isCSVImport: true }, {
 *     batchSize: 100,
 *     onProgress: ({ totalDeleted, totalProcessed }) => { ... },
 *   });
 */

const { retryWithBackoff } = require('./retryWithBackoff');
const logger = require('./logger');

/**
 * Delete documents matching a query in batches, with bounded retries per batch.
 *
 * @param {Collection} collection - MongoDB collection
 * @param {Object} query - MongoDB query to find documents to delete
 * @param {Object} [options]
 * @param {number} [options.batchSize=100] - Documents per batch
 * @param {number} [options.batchDelayMs=50] - Pause between successful batches (Cosmos rate pacing)
 * @param {Function} [options.onProgress] - Called after each successful batch: ({ totalDeleted, totalProcessed, batchDeleted })
 * @param {Object} [options.retryOptions] - Options passed to retryWithBackoff
 * @returns {Promise<{ totalDeleted: number, totalProcessed: number, errors: Array }>}
 */
async function batchDelete(collection, query, options = {}) {
  const {
    batchSize = 100,
    batchDelayMs = 50,
    onProgress = null,
    retryOptions = {},
  } = options;

  let totalDeleted = 0;
  let totalProcessed = 0;
  const errors = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Find next batch of matching documents
    const batch = await collection
      .find(query, { projection: { _id: 1 } })
      .limit(batchSize)
      .toArray();

    if (batch.length === 0) break;

    const batchIds = batch.map(doc => doc._id);

    try {
      const result = await retryWithBackoff(
        () => collection.deleteMany({ _id: { $in: batchIds } }),
        retryOptions
      );
      totalDeleted += result.deletedCount;
      totalProcessed += batch.length;

      if (onProgress) {
        onProgress({ totalDeleted, totalProcessed, batchDeleted: result.deletedCount });
      }
    } catch (err) {
      // Persistent failure after retries exhausted — record error and stop.
      // Do NOT continue to the next iteration: the same batch would be
      // returned by find() again, creating the infinite loop this utility
      // was built to prevent.
      errors.push({ error: err.message, batchSize: batchIds.length });
      logger.error('[batchDelete] Batch failed after retries, aborting. Deleted %d so far.', totalDeleted);
      break;
    }

    // Rate pacing between batches
    if (batchDelayMs > 0) {
      await new Promise(r => setTimeout(r, batchDelayMs));
    }
  }

  return { totalDeleted, totalProcessed, errors };
}

module.exports = { batchDelete };
