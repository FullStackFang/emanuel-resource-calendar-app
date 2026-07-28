// src/utils/syncHealthGrouping.js
//
// Turns the endpoint's INSTANCE-level findings into EVENT-level problems.
//
// The backend reports one row per dated instance, which is correct as a data
// contract but wrong as a unit of attention: a broken weekly series produced
// one row per occurrence, so a single defect read as 30 problems and the page
// ran to ~178 rows. A person fixes the series once. Grouping here is what turns
// that back into one row with 30 dates behind it.
//
// Pure functions, no React, so the grouping and the reconciliation arithmetic
// are unit-testable without rendering (same rationale as listLoadingState.js).

/**
 * Field accessors for app-side findings (missingFromOutlook, untethered).
 * Keyed on mongoId: that is the event document, which is the thing a user fixes.
 */
export const APP_FINDING = {
  keyOf: (r) => r.mongoId,
  titleOf: (r) => r.eventTitle || '(no title)',
  kindOf: (r) => r.eventType || null,
};

/**
 * Field accessors for Outlook-side findings (shouldNotBeInOutlook, untracked).
 * These have no mongoId, and each dated instance carries its own graphId, so
 * the subject is the only handle that collapses a repeating Outlook event
 * (e.g. '[Hold] WISE HALL CLOSED' across 37 days) into one row.
 */
export const OUTLOOK_FINDING = {
  keyOf: (r) => r.subject || r.graphId,
  titleOf: (r) => r.subject || '(no subject)',
  kindOf: (r) => r.reason || null,
};

/**
 * Collapse instance rows into one entry per event.
 *
 * @param {Array<object>} rows - findings from one section of one calendar
 * @param {{keyOf: Function, titleOf: Function, kindOf: Function}} accessors
 * @returns {Array<{key: string, title: string, kind: string|null,
 *                  dates: string[], count: number, rows: object[]}>}
 *   Sorted by date count descending, then title, so the biggest breakage is
 *   read first and the order is stable across runs. `rows` keeps the original
 *   instance findings: grouping is a reading aid, but a fix acts on ONE Outlook
 *   entry, whose graphId only exists on the instance row.
 */
export function groupFindingsByEvent(rows, { keyOf, titleOf, kindOf }) {
  const byKey = new Map();

  for (const row of rows || []) {
    const key = String(keyOf(row) ?? '');
    if (!byKey.has(key)) {
      byKey.set(key, { key, title: titleOf(row), kind: kindOf(row), dates: [], rows: [] });
    }
    byKey.get(key).rows.push(row);
    // Undated findings (an untethered series has no single date) still count as
    // one occurrence of the problem, so only real dates enter the list.
    if (row.date) byKey.get(key).dates.push(row.date);
  }

  const groups = [...byKey.values()].map((g) => ({
    ...g,
    dates: [...new Set(g.dates)].sort(),
    count: new Set(g.dates).size || 1,
  }));

  groups.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  return groups;
}

/**
 * The counts are one reconciliation, not separate facts:
 *
 *   appExpected  = matched + (things Outlook does not have)
 *
 * Returning the two differences lets the UI render the agreement and the
 * disagreement as one object instead of asking the reader to subtract.
 *
 * `outlookOnly` is deliberately the LENGTH OF THE `untracked` ARRAY, not the
 * arithmetic `outlookFound - matched`. The unmatched side of Outlook splits two
 * ways: entries the app never managed (`untracked`) and entries the app tried
 * to remove but Outlook kept (`shouldNotBeInOutlook`). The subtraction lumps
 * both into "sit on the Outlook calendar that this app does not manage", which
 * summarizes real failed deletions as normal. Deriving from the same array the
 * section renders makes bar and section incapable of disagreeing.
 *
 * Takes the whole calendar entry rather than its `counts` so the two inputs
 * cannot drift apart at a call site.
 *
 * @param {{counts?: {appExpected: number, outlookFound: number, matched: number},
 *          untracked?: Array<object>}} calendar - one entry from `calendars`
 * @returns {{appOnly: number, matched: number, outlookOnly: number, total: number}}
 */
export function reconcile(calendar = {}) {
  const counts = calendar.counts || {};
  const appExpected = counts.appExpected || 0;
  const matched = counts.matched || 0;

  const appOnly = Math.max(0, appExpected - matched);
  const outlookOnly = (calendar.untracked || []).length;

  return { appOnly, matched, outlookOnly, total: appOnly + matched + outlookOnly };
}

/**
 * How many distinct events in this calendar need a human to look at them.
 * Deliberately excludes `untracked`: an event that exists only in Outlook is
 * informational, not a defect, and counting it would make every healthy
 * calendar look broken.
 *
 * @param {object} calendar - one entry from the report's `calendars` array
 * @returns {number}
 */
export function countEventsNeedingAttention(calendar = {}) {
  const sections = [
    [calendar.untethered, APP_FINDING],
    [calendar.missingFromOutlook, APP_FINDING],
    [calendar.shouldNotBeInOutlook, OUTLOOK_FINDING],
  ];
  return sections.reduce(
    (sum, [rows, accessors]) => sum + groupFindingsByEvent(rows, accessors).length,
    0
  );
}
