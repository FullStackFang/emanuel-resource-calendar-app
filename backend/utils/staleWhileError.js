// backend/utils/staleWhileError.js
//
// Time-based memo cache that SERVES THE LAST GOOD VALUE if a refresh throws.
//
// For rarely-changing reference data (calendar markers, categories) read on a
// hot path but stored behind a datastore that can transiently throttle (Azure
// Cosmos DB error 16500 / 429), a failed refresh should NOT propagate as an
// error or a false-empty. Instead, as long as we have ever loaded successfully,
// keep serving the stale value until the datastore recovers. Only the very
// first load (no prior value) can fail.
//
// This is the backend half of the same "never let a slow/failed refresh
// degrade what we can already serve" policy the frontend applies via TanStack
// Query staleTime + keepPreviousData.

/**
 * @template T
 * @param {object} opts
 * @param {number} opts.ttlMs - How long a successful load stays fresh.
 * @param {() => Promise<T>} opts.load - Loader; may reject (e.g. Cosmos throttle).
 * @param {() => number} [opts.now] - Clock injection for tests; defaults to Date.now.
 * @returns {{ get: () => Promise<T>, invalidate: () => void, peek: () => T | undefined }}
 */
function createStaleWhileErrorCache({ ttlMs, load, now = Date.now }) {
  let value;
  let hasValue = false;
  let expiry = 0;

  async function get() {
    const t = now();
    if (hasValue && t < expiry) return value;
    try {
      value = await load();
      hasValue = true;
      expiry = t + ttlMs;
      return value;
    } catch (err) {
      // Serve stale rather than fail, provided we have a prior good value.
      if (hasValue) return value;
      throw err;
    }
  }

  function invalidate() {
    hasValue = false;
    expiry = 0;
    value = undefined;
  }

  function peek() {
    return hasValue ? value : undefined;
  }

  return { get, invalidate, peek };
}

module.exports = { createStaleWhileErrorCache };
