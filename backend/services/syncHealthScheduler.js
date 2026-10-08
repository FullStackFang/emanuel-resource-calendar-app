'use strict';

/**
 * Scheduled sync health run (edit-request-approval-graph-sync D6).
 *
 * The sync health report already classifies drift like "excluded date still
 * present"; it only ran when someone opened the page, so a real incident sat
 * undetected for months. This runs the same check on a clock and persists the
 * latest summary for the nav badge.
 *
 * LEASE, not just a timer. Every instance polls, but a tick runs the check only
 * if it wins a findOneAndUpdate on the shared settings document whose
 * `nextRunAt` has passed (or is absent). That one write prevents duplicate runs
 * across app instances AND survives deploys that restart the app more often
 * than the interval (a plain setInterval would never reach its first tick).
 *
 * A failed run records the error but KEEPS the last good counts and ranAt, so
 * the badge does not vanish during an outage. A throwing tick never stops
 * later ticks.
 */

const LATEST_DOC_ID = 'sync-health-latest';
const BOOT_DELAY_MS = 60 * 1000;
const MAX_POLL_MS = 15 * 60 * 1000;
const FAILED_DELETION_REASON = 'deleted in app but still in Outlook';

/** Per-category counts across all calendars of one report. */
function summarizeReport(report) {
  const counts = { missingFromOutlook: 0, shouldNotBeInOutlook: 0, untracked: 0, untethered: 0, failedDeletion: 0 };
  let degraded = false;
  for (const cal of report?.calendars || []) {
    counts.missingFromOutlook += (cal.missingFromOutlook || []).length;
    counts.untracked += (cal.untracked || []).length;
    counts.untethered += (cal.untethered || []).length;
    // Failed deletions are a reason WITHIN shouldNotBeInOutlook; split them out
    // so the two counts never overlap.
    for (const f of cal.shouldNotBeInOutlook || []) {
      if (f.reason === FAILED_DELETION_REASON) counts.failedDeletion += 1;
      else counts.shouldNotBeInOutlook += 1;
    }
    if (cal.degraded || cal.error) degraded = true;
  }
  return { counts, degraded };
}

/** Store adapter over templeEvents__SystemSettings (keyed by _id). */
function createSettingsStore(collection, docId = LATEST_DOC_ID) {
  return {
    async tryAcquire({ now, nextRunAt, instanceId }) {
      try {
        const res = await collection.findOneAndUpdate(
          { _id: docId, $or: [{ nextRunAt: { $lte: now } }, { nextRunAt: { $exists: false } }] },
          { $set: { nextRunAt, leasedBy: instanceId, leasedAt: now } },
          { upsert: true, returnDocument: 'after' }
        );
        return !!(res && (res.value !== undefined ? res.value : res));
      } catch (err) {
        // Upsert collided with an existing document whose lease is still held.
        if (err && err.code === 11000) return false;
        throw err;
      }
    },
    async recordSuccess(fields) {
      await collection.updateOne({ _id: docId }, { $set: { ...fields, error: false } });
    },
    async recordFailure({ errorAt, errorMessage }) {
      await collection.updateOne({ _id: docId }, { $set: { error: true, errorAt, errorMessage } });
    },
    async read() {
      return collection.findOne({ _id: docId });
    },
  };
}

/**
 * @param {Object} args
 * @param {Function} args.runCheck - async ({ startDate, endDate, calendarOwner }) => report
 * @param {Function} args.resolveWindow - () => { startDate, endDate }
 * @param {Object} args.store - see createSettingsStore
 * @param {number} args.intervalMs - 0 disables
 * @param {string} args.instanceId
 * @param {Object} args.logger
 * @param {Function} [args.now]
 * @returns {{ stop: Function, tick: Function }|null} null when disabled
 */
function start({ runCheck, resolveWindow, store, intervalMs, instanceId, logger, now = () => new Date() }) {
  if (!intervalMs || intervalMs <= 0) return null;

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    const startedAt = now();
    try {
      const acquired = await store.tryAcquire({
        now: startedAt,
        nextRunAt: new Date(startedAt.getTime() + intervalMs),
        instanceId,
      });
      if (!acquired) return;
      try {
        const window = resolveWindow();
        const report = await runCheck({ startDate: window.startDate, endDate: window.endDate, calendarOwner: null });
        const { counts, degraded } = summarizeReport(report);
        await store.recordSuccess({
          ranAt: startedAt,
          window,
          counts,
          degraded,
          durationMs: now().getTime() - startedAt.getTime(),
        });
      } catch (err) {
        logger.warn('[syncHealthScheduler] scheduled run failed:', err.message);
        await store.recordFailure({ errorAt: now(), errorMessage: err.message || String(err) });
      }
    } catch (err) {
      logger.warn('[syncHealthScheduler] tick failed:', err.message);
    } finally {
      running = false;
    }
  };

  const bootTimer = setTimeout(tick, BOOT_DELAY_MS);
  // Poll more often than the interval: the lease decides when a run is due,
  // so a restart mid-interval neither skips nor duplicates a run.
  const pollTimer = setInterval(tick, Math.min(intervalMs, MAX_POLL_MS));
  bootTimer.unref?.();
  pollTimer.unref?.();

  return {
    tick,
    stop() {
      clearTimeout(bootTimer);
      clearInterval(pollTimer);
    },
  };
}

module.exports = { start, summarizeReport, createSettingsStore, LATEST_DOC_ID, BOOT_DELAY_MS };
