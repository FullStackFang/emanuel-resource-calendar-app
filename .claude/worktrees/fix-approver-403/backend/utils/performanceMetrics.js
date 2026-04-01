/**
 * Performance Metrics Utility
 * Lightweight performance tracking for event loading operations
 * Enable via environment variable PERF_METRICS_ENABLED=true
 */

const isEnabled = process.env.PERF_METRICS_ENABLED === 'true';

/**
 * Start a timer for an operation
 * @param {string} operationName - Name of the operation being timed
 * @returns {Object} Timer handle with operation name and start time
 */
function startTimer(operationName) {
  return {
    operation: operationName,
    startTime: process.hrtime.bigint(),
    startTimestamp: Date.now()
  };
}

/**
 * End a timer and return duration
 * @param {Object} timerHandle - Timer handle from startTimer
 * @returns {Object} Duration in milliseconds and operation name
 */
function endTimer(timerHandle) {
  if (!timerHandle || !timerHandle.startTime) {
    return { duration: 0, operation: 'unknown' };
  }

  const endTime = process.hrtime.bigint();
  const durationNs = endTime - timerHandle.startTime;
  const durationMs = Number(durationNs) / 1_000_000;

  return {
    operation: timerHandle.operation,
    duration: Math.round(durationMs * 100) / 100, // Round to 2 decimal places
    startTimestamp: timerHandle.startTimestamp,
    endTimestamp: Date.now()
  };
}

/**
 * Log phase metrics with consistent formatting
 * @param {string} phase - Phase name (e.g., 'cache', 'graph', 'persist')
 * @param {Object} metrics - Metrics object with duration and additional data
 * @param {Object} logger - Logger instance to use
 */
function logPhaseMetrics(phase, metrics, logger) {
  if (!isEnabled) return;

  const logData = {
    phase,
    durationMs: metrics.duration,
    ...metrics
  };

  if (logger && typeof logger.log === 'function') {
    logger.log(`[PERF] ${phase}: ${metrics.duration}ms`, logData);
  } else {
    console.log(`[PERF] ${phase}: ${metrics.duration}ms`, JSON.stringify(logData));
  }
}

/**
 * Aggregate multiple metrics into summary statistics
 * @param {Array} metricsArray - Array of metric objects with duration property
 * @returns {Object} Aggregated statistics
 */
function aggregateMetrics(metricsArray) {
  if (!metricsArray || metricsArray.length === 0) {
    return { total: 0, average: 0, min: 0, max: 0, count: 0 };
  }

  const durations = metricsArray.map(m => m.duration || 0);
  const total = durations.reduce((sum, d) => sum + d, 0);

  return {
    total: Math.round(total * 100) / 100,
    average: Math.round((total / durations.length) * 100) / 100,
    min: Math.min(...durations),
    max: Math.max(...durations),
    count: durations.length
  };
}

/**
 * Create a performance tracker for a complete event load operation
 * @returns {Object} Tracker with methods to record phase timings
 */
function createLoadTracker() {
  const phases = {};
  const overallStart = process.hrtime.bigint();
  const startTimestamp = Date.now();

  return {
    /**
     * Start timing a phase
     * @param {string} phaseName - Name of the phase
     */
    startPhase(phaseName) {
      phases[phaseName] = {
        startTime: process.hrtime.bigint(),
        startTimestamp: Date.now()
      };
    },

    /**
     * End timing a phase
     * @param {string} phaseName - Name of the phase
     * @param {Object} metadata - Additional metadata to include
     */
    endPhase(phaseName, metadata = {}) {
      if (phases[phaseName] && phases[phaseName].startTime) {
        const endTime = process.hrtime.bigint();
        const durationNs = endTime - phases[phaseName].startTime;
        phases[phaseName].duration = Math.round(Number(durationNs) / 1_000_000 * 100) / 100;
        phases[phaseName].endTimestamp = Date.now();
        phases[phaseName].metadata = metadata;
      }
    },

    /**
     * Get summary of all phases
     * @returns {Object} Summary with phase timings and overall duration
     */
    getSummary() {
      const overallEnd = process.hrtime.bigint();
      const overallDurationNs = overallEnd - overallStart;
      const overallDuration = Math.round(Number(overallDurationNs) / 1_000_000 * 100) / 100;

      const phaseSummary = {};
      for (const [name, data] of Object.entries(phases)) {
        phaseSummary[name] = {
          duration: data.duration || 0,
          metadata: data.metadata || {}
        };
      }

      return {
        overallDuration,
        startTimestamp,
        endTimestamp: Date.now(),
        phases: phaseSummary,
        isEnabled
      };
    },

    /**
     * Log the complete summary
     * @param {Object} logger - Logger instance
     */
    logSummary(logger) {
      const summary = this.getSummary();

      if (!isEnabled) {
        // Even when disabled, log a minimal summary
        if (logger && typeof logger.debug === 'function') {
          logger.debug(`Event load completed in ${summary.overallDuration}ms`);
        }
        return summary;
      }

      const phaseDetails = Object.entries(summary.phases)
        .map(([name, data]) => `${name}: ${data.duration}ms`)
        .join(', ');

      if (logger && typeof logger.log === 'function') {
        logger.log(`[PERF] Event Load Summary - Total: ${summary.overallDuration}ms | ${phaseDetails}`);
      } else {
        console.log(`[PERF] Event Load Summary - Total: ${summary.overallDuration}ms | ${phaseDetails}`);
      }

      return summary;
    }
  };
}

/**
 * Wrap an async function to automatically measure its execution time
 * @param {Function} fn - Async function to wrap
 * @param {string} operationName - Name for the operation
 * @param {Object} logger - Optional logger
 * @returns {Function} Wrapped function that logs timing
 */
function measureAsync(fn, operationName, logger) {
  return async function(...args) {
    const timer = startTimer(operationName);
    try {
      const result = await fn.apply(this, args);
      const metrics = endTimer(timer);
      logPhaseMetrics(operationName, metrics, logger);
      return result;
    } catch (error) {
      const metrics = endTimer(timer);
      metrics.error = error.message;
      logPhaseMetrics(`${operationName} (ERROR)`, metrics, logger);
      throw error;
    }
  };
}

module.exports = {
  startTimer,
  endTimer,
  logPhaseMetrics,
  aggregateMetrics,
  createLoadTracker,
  measureAsync,
  isEnabled
};
