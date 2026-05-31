/**
 * Create a set of indexes resiliently: attempt EVERY spec independently so that
 * one rejected index cannot silently abort the rest, and SURFACE genuine failures
 * so missing coverage is visible instead of swallowed.
 *
 * Background: Azure Cosmos DB (Mongo API) rejects some index shapes this codebase
 * historically declared — notably COMPOUND indexes on nested paths
 * ("Unique and compound indexes do not support nested paths"). The old single
 * try/catch around sequential awaits meant the first such rejection skipped every
 * later index, leaving production coverage opaque. This helper isolates each
 * createIndex so a rejection is recorded and reported, not propagated.
 *
 * Benign outcomes (treated as `skipped`, not `failed`):
 *  - code 67 / 'CannotCreateIndex'      — Cosmos: cannot modify unique index on a
 *                                          non-empty collection (index already there)
 *  - code 85 / 'IndexOptionsConflict'   — same keys, different options/name
 *  - code 86 / 'IndexKeySpecsConflict'  — same name, different keys
 *  - /already exists/i message          — idempotent re-run
 *
 * @param {import('mongodb').Collection} collection
 * @param {Array<{key: object, options: object}>} specs - each options SHOULD include `name`.
 * @param {{logger?: {error?: Function, warn?: Function, log?: Function}}} [opts]
 * @returns {Promise<{created: string[], skipped: string[], failed: Array<{name:string, code:any, message:string}>}>}
 */
async function createIndexesResilient(collection, specs, { logger } = {}) {
  const created = [];
  const skipped = [];
  const failed = [];

  for (const spec of specs) {
    const { key, options = {} } = spec;
    const name = options.name || JSON.stringify(key);
    try {
      await collection.createIndex(key, options);
      created.push(name);
    } catch (error) {
      const code = error && error.code;
      const codeName = error && error.codeName;
      const message = String((error && error.message) || error);

      const benign =
        code === 67 || codeName === 'CannotCreateIndex' ||
        code === 85 || codeName === 'IndexOptionsConflict' ||
        code === 86 || codeName === 'IndexKeySpecsConflict' ||
        /already exists/i.test(message);

      if (benign) {
        skipped.push(name);
      } else {
        failed.push({ name, code, message });
        if (logger && logger.error) {
          logger.error(`[createIndexesResilient] FAILED to create index '${name}': ${message}`);
        }
      }
    }
  }

  if (failed.length && logger && logger.warn) {
    logger.warn(
      `[createIndexesResilient] ${created.length} created, ${skipped.length} skipped, ` +
      `${failed.length} FAILED: ${failed.map(f => f.name).join(', ')}`
    );
  }

  return { created, skipped, failed };
}

module.exports = { createIndexesResilient };
