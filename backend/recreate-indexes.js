/**
 * DISARMED — formerly a DESTRUCTIVE index reset for templeEvents__Events.
 *
 * This script used to DROP ALL non-_id indexes and recreate a hardcoded subset.
 * That subset had drifted out of sync with the source of truth and running it in
 * production would REINTRODUCE outages:
 *
 *   - It would DROP `calData_startDateTime` — the single-field index that fixes the
 *     public Search view (without it, search full-scans templeEvents__Events and
 *     Cosmos throttles to empty results). That index is NOT in this script's list.
 *   - It would DROP the exception indexes (`exception_master_date`, `exception_type_dates`)
 *     that recurring-event lookups depend on.
 *   - Its `userId_sourceCalendars` definition disagreed with startup
 *     (`sourceCalendars` vs `sourceCalendars.calendarId`), and it created the obsolete
 *     `pendingEditRequest_status` (a field that no longer exists on event docs).
 *
 * Index creation is now owned by createUnifiedEventIndexes() in api-server.js. It runs
 * on startup, creates each index independently (one rejection no longer aborts the rest),
 * and SURFACES failures in the logs. It is the single source of truth.
 *
 * To INSPECT the live indexes (read-only), run:
 *     node diagnose-event-indexes.js
 *
 * If you ever need to DROP a specific index, do it deliberately and explicitly against
 * the target index by name (Mongo `dropIndex`, or the Azure ARM control plane for
 * Cosmos) — never via a blunt drop-all. This script intentionally performs no writes.
 */

console.error([
  '',
  'recreate-indexes.js is DISARMED and performs no changes.',
  '',
  'Index creation is owned by createUnifiedEventIndexes() in api-server.js (runs on',
  'startup, resilient, surfaces failures). A blanket drop+recreate here would DROP the',
  'live search-fix index (calData_startDateTime) and the exception indexes.',
  '',
  'To inspect the live indexes:   node diagnose-event-indexes.js',
  '',
].join('\n'));

process.exit(1);
