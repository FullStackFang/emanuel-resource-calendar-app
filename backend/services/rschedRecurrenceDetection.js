'use strict';

/**
 * Resource Scheduler Recurrence Detection
 *
 * Pure-functions module — no DB, no Express. Takes a list of staging rows
 * (already parsed + location-resolved by rschedImportService) and detects
 * implicit recurring series.
 *
 * Output: an array of CandidateSeries objects ready to be persisted in
 * `templeEvents__RschedRecurrenceCandidates` for admin review.
 *
 * Algorithm overview (see plan: detect-recurrence section):
 *   1. Group rows by (normalizedTitle, primaryLocation, startTime, duration).
 *   2. Fuzzy-merge title variants within same location/time/duration.
 *   3. For each group, fit a recurrence pattern (daily / weekly / biweekly /
 *      monthly / monthly-by-day-of-week).
 *   4. Classify each member as master / occurrence_clean / occurrence_override
 *      / outlier.
 *   5. Score confidence and emit a CandidateSeries.
 */

const RECURRENCE_CANDIDATES_COLLECTION = 'templeEvents__RschedRecurrenceCandidates';

const MIN_GROUP_SIZE = 3;
const MAX_GROUP_SIZE = 1000; // bounded fitter cost
const LEVENSHTEIN_MAX = 3;
const LEVENSHTEIN_MIN_LEN = 6;
const JACCARD_THRESHOLD = 0.85;
const IGNORABLE_TRAILING_TOKENS = new Set(['meeting', 'class', 'group', 'session']);

const DAYS_OF_WEEK = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

// Material fields used for occurrence_override classification — mirrors
// rschedImportService.MATERIAL_FIELDS but applied at staging-row level.
const OVERRIDE_FIELDS = ['eventTitle', 'eventDescription', 'startTime', 'endTime', 'isAllDay', 'locationKey', 'categories'];

// =============================================================================
// String similarity helpers (no external deps)
// =============================================================================

function normalizeTitle(t) {
  return (t || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Two-row DP for memory efficiency.
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function tokenize(s) {
  return new Set(
    (s || '').toLowerCase().split(/\s+/).filter(Boolean),
  );
}

function jaccardSimilarity(a, b) {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersect = 0;
  for (const t of setA) {
    if (setB.has(t)) intersect++;
  }
  const union = setA.size + setB.size - intersect;
  return intersect / union;
}

/**
 * True when one normalized title is the strict prefix or suffix of the other
 * AND the difference is one of IGNORABLE_TRAILING_TOKENS.
 *
 * Examples:
 *   'al-anon' vs 'al-anon meeting'  -> true (diff is 'meeting')
 *   'hebrew class' vs 'hebrew class beginners' -> false ('beginners' not ignorable)
 */
function isIgnorableSuffixMatch(a, b) {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (!longer.startsWith(shorter)) return false;
  const remainder = longer.slice(shorter.length).trim();
  if (remainder.length === 0) return false; // identical strings, handled by lev
  return IGNORABLE_TRAILING_TOKENS.has(remainder);
}

function shouldMergeTitles(a, b) {
  if (a === b) return true;
  // Levenshtein with min-length guard.
  if (Math.min(a.length, b.length) >= LEVENSHTEIN_MIN_LEN && levenshtein(a, b) <= LEVENSHTEIN_MAX) {
    return true;
  }
  if (isIgnorableSuffixMatch(a, b)) return true;
  if (jaccardSimilarity(a, b) >= JACCARD_THRESHOLD) return true;
  return false;
}

// =============================================================================
// Date helpers (pure)
// =============================================================================

/**
 * Parse a YYYY-MM-DD string to a Date at local midnight. Avoids the timezone
 * shift that `new Date('YYYY-MM-DD')` produces (UTC interpretation).
 */
function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

function formatDateYmd(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function daysBetween(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function dayOfWeekName(date) {
  return DAYS_OF_WEEK[date.getDay()];
}

function computeDurationMinutes(startDateTime, endDateTime) {
  if (!startDateTime || !endDateTime) return 0;
  const s = new Date(startDateTime).getTime();
  const e = new Date(endDateTime).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return 0;
  return Math.round((e - s) / 60000);
}

// =============================================================================
// Phase 1: grouping
// =============================================================================

function candidateKey(row) {
  const titleNorm = normalizeTitle(row.eventTitle);
  // Primary location: first locationId if present, else the first rsKey,
  // else empty (rows with no location-key all share one bucket).
  const locationKey =
    (row.locationIds && row.locationIds.length > 0 && String(row.locationIds[0])) ||
    (Array.isArray(row.rsKeys) && row.rsKeys[0]) ||
    row.rsKey ||
    '';
  const startTime = row.startTime || '00:00';
  const duration = computeDurationMinutes(row.startDateTime, row.endDateTime);
  return `${titleNorm}|${locationKey}|${startTime}|${duration}`;
}

function groupRowsByKey(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = candidateKey(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

// =============================================================================
// Phase 2: fuzzy title merge (within same location/time/duration triple)
// =============================================================================

function fuzzyMergeTitles(initialGroups) {
  // Re-key by (startTime, duration) — NOT location — so that mid-series
  // location-change groups can merge into the same bucket. Different titles
  // at the same time are still kept separate by the title-similarity check.
  const trippleMap = new Map();
  for (const [key, rows] of initialGroups.entries()) {
    const sample = rows[0];
    const startTime = sample.startTime || '00:00';
    const duration = computeDurationMinutes(sample.startDateTime, sample.endDateTime);
    const triple = `${startTime}|${duration}`;
    if (!trippleMap.has(triple)) trippleMap.set(triple, []);
    trippleMap.get(triple).push({ key, rows, normalizedTitle: normalizeTitle(sample.eventTitle) });
  }

  const merged = [];
  for (const triple of trippleMap.values()) {
    // Greedy merge: walk through groups in this triple, merge into existing
    // bucket if any title matches; otherwise start a new bucket.
    const buckets = []; // each is { rows, titleVariants:Set, canonicalTitle }
    for (const grp of triple) {
      let placed = false;
      for (const bucket of buckets) {
        if (shouldMergeTitles(grp.normalizedTitle, bucket.canonicalTitle)) {
          bucket.rows.push(...grp.rows);
          bucket.titleVariants.add(grp.normalizedTitle);
          // canonicalTitle stays as-is until we recompute "most frequent" below
          placed = true;
          break;
        }
      }
      if (!placed) {
        buckets.push({
          rows: [...grp.rows],
          titleVariants: new Set([grp.normalizedTitle]),
          canonicalTitle: grp.normalizedTitle,
        });
      }
    }
    // Recompute canonicalTitle as the most-frequent raw title variant in each bucket.
    for (const bucket of buckets) {
      const counts = new Map();
      for (const r of bucket.rows) {
        const norm = normalizeTitle(r.eventTitle);
        counts.set(norm, (counts.get(norm) || 0) + 1);
      }
      let best = bucket.canonicalTitle;
      let bestN = 0;
      for (const [t, n] of counts.entries()) {
        if (n > bestN) {
          bestN = n;
          best = t;
        }
      }
      bucket.canonicalTitle = best;
      bucket.titleVariants = [...bucket.titleVariants];
      merged.push(bucket);
    }
  }
  return merged;
}

// =============================================================================
// Phase 3: pattern fitting
// =============================================================================

/**
 * fitDaily: every day at the same time. Intervals all 1 day (with possible gaps).
 * Returns null if the dominant interval isn't 1 day.
 */
function fitDaily(dates) {
  if (dates.length < MIN_GROUP_SIZE) return null;
  // Quick reject: if median interval isn't 1 day, this isn't daily.
  const intervals = [];
  for (let i = 1; i < dates.length; i++) intervals.push(daysBetween(dates[i - 1], dates[i]));
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  if (median !== 1) return null;
  // Generate all daily dates in range and match.
  const range = { startDate: formatDateYmd(dates[0]), endDate: formatDateYmd(dates[dates.length - 1]) };
  const fitDates = [];
  for (let d = new Date(dates[0]); d <= dates[dates.length - 1]; d.setDate(d.getDate() + 1)) {
    fitDates.push(formatDateYmd(d));
  }
  return {
    pattern: { type: 'daily', interval: 1 },
    range: { type: 'endDate', startDate: range.startDate, endDate: range.endDate },
    fitDates,
  };
}

function dowHistogram(dates) {
  const hist = Array(7).fill(0);
  for (const d of dates) hist[d.getDay()]++;
  return hist;
}

/**
 * fitWeeklySingleDay: all dates fall on the same day-of-week, intervals are
 * multiples of 7. Returns null otherwise.
 */
function fitWeeklySingleDay(dates) {
  if (dates.length < MIN_GROUP_SIZE) return null;
  const hist = dowHistogram(dates);
  const total = dates.length;
  // Single dominant dow: that dow has >70% AND all others are <10%.
  let dominantDow = -1;
  let dominantCount = 0;
  for (let i = 0; i < 7; i++) {
    if (hist[i] > dominantCount) {
      dominantCount = hist[i];
      dominantDow = i;
    }
  }
  if (dominantCount / total <= 0.7) return null;
  // Allow up to ~15% non-dominant-dow rows (outliers); reject if any single
  // other dow exceeds that.
  for (let i = 0; i < 7; i++) {
    if (i !== dominantDow && hist[i] / total > 0.15) return null;
  }
  // Build pattern.
  const masterDates = dates.filter((d) => d.getDay() === dominantDow);
  if (masterDates.length < MIN_GROUP_SIZE) return null;
  // Verify cadence is 7 days (not 14 — that would be biweekly). If median
  // interval among same-dow dates is exactly 14, defer to fitBiweekly.
  const intervals = [];
  for (let i = 1; i < masterDates.length; i++) intervals.push(daysBetween(masterDates[i - 1], masterDates[i]));
  if (intervals.length > 0) {
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    if (median >= 14) return null; // biweekly or sparser; let other fitters handle
  }
  const startDate = masterDates[0];
  const endDate = masterDates[masterDates.length - 1];
  // Generate all dates in [startDate, endDate] with that dow.
  const fitDates = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 7)) {
    fitDates.push(formatDateYmd(d));
  }
  return {
    pattern: { type: 'weekly', interval: 1, daysOfWeek: [DAYS_OF_WEEK[dominantDow]] },
    range: { type: 'endDate', startDate: formatDateYmd(startDate), endDate: formatDateYmd(endDate) },
    fitDates,
  };
}

/**
 * fitWeeklyMultiDay: dates fall on 2-3 days of the week (M/W/F, T/Th, etc.).
 * Each dominant dow has >=20% of dates and others are <5%.
 */
function fitWeeklyMultiDay(dates) {
  if (dates.length < MIN_GROUP_SIZE) return null;
  const hist = dowHistogram(dates);
  const total = dates.length;
  const dominantDows = [];
  for (let i = 0; i < 7; i++) {
    if (hist[i] / total >= 0.2) dominantDows.push(i);
  }
  if (dominantDows.length < 2 || dominantDows.length > 3) return null;
  // Verify other dows are <5%.
  for (let i = 0; i < 7; i++) {
    if (!dominantDows.includes(i) && hist[i] / total >= 0.05) return null;
  }
  const dominantSet = new Set(dominantDows);
  const masterDates = dates.filter((d) => dominantSet.has(d.getDay()));
  if (masterDates.length < MIN_GROUP_SIZE) return null;
  const startDate = masterDates[0];
  const endDate = masterDates[masterDates.length - 1];
  const fitDates = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    if (dominantSet.has(d.getDay())) fitDates.push(formatDateYmd(d));
  }
  return {
    pattern: {
      type: 'weekly',
      interval: 1,
      daysOfWeek: dominantDows.map((i) => DAYS_OF_WEEK[i]),
    },
    range: { type: 'endDate', startDate: formatDateYmd(startDate), endDate: formatDateYmd(endDate) },
    fitDates,
  };
}

/**
 * fitBiweekly: dominant dow with intervals of 14 (sometimes 28) — like
 * fitWeeklySingleDay but interval=2. Conservative: only fires when the median
 * interval among same-dow dates is exactly 14.
 */
function fitBiweekly(dates) {
  if (dates.length < MIN_GROUP_SIZE) return null;
  const hist = dowHistogram(dates);
  const total = dates.length;
  let dominantDow = -1;
  let dominantCount = 0;
  for (let i = 0; i < 7; i++) {
    if (hist[i] > dominantCount) {
      dominantCount = hist[i];
      dominantDow = i;
    }
  }
  if (dominantCount / total <= 0.7) return null;
  const masterDates = dates.filter((d) => d.getDay() === dominantDow);
  if (masterDates.length < MIN_GROUP_SIZE) return null;
  const intervals = [];
  for (let i = 1; i < masterDates.length; i++) intervals.push(daysBetween(masterDates[i - 1], masterDates[i]));
  if (intervals.length === 0) return null;
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  if (median !== 14) return null;
  // Verify majority of intervals are 14 (allow some 28 for skipped weeks).
  const fourteens = intervals.filter((x) => x === 14).length;
  if (fourteens / intervals.length < 0.7) return null;
  const startDate = masterDates[0];
  const endDate = masterDates[masterDates.length - 1];
  const fitDates = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 14)) {
    fitDates.push(formatDateYmd(d));
  }
  return {
    pattern: { type: 'weekly', interval: 2, daysOfWeek: [DAYS_OF_WEEK[dominantDow]] },
    range: { type: 'endDate', startDate: formatDateYmd(startDate), endDate: formatDateYmd(endDate) },
    fitDates,
  };
}

/**
 * fitMonthlyByDate: e.g., 15th of every month. All dates have the same
 * day-of-month and intervals are roughly 28-31 days.
 */
function fitMonthlyByDate(dates) {
  if (dates.length < MIN_GROUP_SIZE) return null;
  const domHist = new Map();
  for (const d of dates) {
    const dom = d.getDate();
    domHist.set(dom, (domHist.get(dom) || 0) + 1);
  }
  let dominantDom = -1;
  let dominantCount = 0;
  for (const [dom, n] of domHist.entries()) {
    if (n > dominantCount) {
      dominantCount = n;
      dominantDom = dom;
    }
  }
  if (dominantCount / dates.length < 0.7) return null;
  const masterDates = dates.filter((d) => d.getDate() === dominantDom);
  if (masterDates.length < MIN_GROUP_SIZE) return null;
  const intervals = [];
  for (let i = 1; i < masterDates.length; i++) intervals.push(daysBetween(masterDates[i - 1], masterDates[i]));
  // Median should be 28-31 (one month).
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  if (median < 28 || median > 31) return null;
  const startDate = masterDates[0];
  const endDate = masterDates[masterDates.length - 1];
  const fitDates = [];
  let cur = new Date(startDate);
  while (cur <= endDate) {
    fitDates.push(formatDateYmd(cur));
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, dominantDom);
  }
  return {
    pattern: { type: 'absoluteMonthly', interval: 1, dayOfMonth: dominantDom },
    range: { type: 'endDate', startDate: formatDateYmd(startDate), endDate: formatDateYmd(endDate) },
    fitDates,
  };
}

/**
 * fitMonthlyByDayOfWeek: e.g., 3rd Tuesday of every month. All dates fall on
 * the same dow + same week-of-month index.
 */
function fitMonthlyByDayOfWeek(dates) {
  if (dates.length < MIN_GROUP_SIZE) return null;
  // For each date, compute which occurrence of its dow within the month it is
  // (1st, 2nd, 3rd, 4th, last). Dominant tuple = (dow, index).
  function nthDow(d) {
    return Math.floor((d.getDate() - 1) / 7) + 1; // 1..5
  }
  const tupleHist = new Map();
  for (const d of dates) {
    const key = `${d.getDay()}-${nthDow(d)}`;
    tupleHist.set(key, (tupleHist.get(key) || 0) + 1);
  }
  let dominantKey = null;
  let dominantCount = 0;
  for (const [k, n] of tupleHist.entries()) {
    if (n > dominantCount) {
      dominantCount = n;
      dominantKey = k;
    }
  }
  if (!dominantKey) return null;
  if (dominantCount / dates.length < 0.7) return null;
  const [domDowStr, domIdxStr] = dominantKey.split('-');
  const domDow = parseInt(domDowStr, 10);
  const domIdx = parseInt(domIdxStr, 10);
  const indexNames = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'last' };
  const masterDates = dates.filter((d) => d.getDay() === domDow && nthDow(d) === domIdx);
  if (masterDates.length < MIN_GROUP_SIZE) return null;
  const intervals = [];
  for (let i = 1; i < masterDates.length; i++) intervals.push(daysBetween(masterDates[i - 1], masterDates[i]));
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  if (median < 28 || median > 35) return null;
  const startDate = masterDates[0];
  const endDate = masterDates[masterDates.length - 1];
  // Generate fit dates by walking month-by-month.
  const fitDates = [];
  let y = startDate.getFullYear();
  let m = startDate.getMonth();
  while (true) {
    // Find the domIdx-th occurrence of domDow in month (y, m).
    const first = new Date(y, m, 1);
    const offset = (domDow - first.getDay() + 7) % 7;
    const dom = 1 + offset + 7 * (domIdx - 1);
    const d = new Date(y, m, dom);
    if (d.getMonth() === m && d <= endDate) {
      fitDates.push(formatDateYmd(d));
    }
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
    if (new Date(y, m, 1) > endDate) break;
  }
  return {
    pattern: {
      type: 'relativeMonthly',
      interval: 1,
      daysOfWeek: [DAYS_OF_WEEK[domDow]],
      index: indexNames[domIdx] || 'first',
    },
    range: { type: 'endDate', startDate: formatDateYmd(startDate), endDate: formatDateYmd(endDate) },
    fitDates,
  };
}

function fitPattern(sortedRows) {
  if (sortedRows.length < MIN_GROUP_SIZE) return null;
  const dates = sortedRows.map((r) => parseLocalDate(r.startDate)).filter(Boolean);
  if (dates.length < MIN_GROUP_SIZE) return null;
  return (
    fitDaily(dates) ||
    fitWeeklyMultiDay(dates) ||
    fitWeeklySingleDay(dates) ||
    fitBiweekly(dates) ||
    fitMonthlyByDate(dates) ||
    fitMonthlyByDayOfWeek(dates) ||
    null
  );
}

// =============================================================================
// Phase 4: member classification
// =============================================================================

/**
 * Pick the master row by mode-of-fields. Tie-break on earliest date.
 */
function pickMasterRow(rows) {
  if (rows.length === 0) return null;
  // Simple approach: pick the most common (eventTitle, locationKey) tuple,
  // tie-break on earliest date.
  const counts = new Map();
  for (const r of rows) {
    const locKey =
      (r.locationIds && r.locationIds.length > 0 && String(r.locationIds[0])) ||
      (Array.isArray(r.rsKeys) && r.rsKeys[0]) ||
      r.rsKey ||
      '';
    const key = `${normalizeTitle(r.eventTitle)}|${locKey}`;
    if (!counts.has(key)) counts.set(key, []);
    counts.get(key).push(r);
  }
  let bestRows = null;
  let bestSize = 0;
  for (const list of counts.values()) {
    if (list.length > bestSize) {
      bestSize = list.length;
      bestRows = list;
    }
  }
  bestRows.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
  return bestRows[0];
}

/**
 * Compute the per-member overrides — fields where the member differs from
 * the master. Returns an object keyed by override field name (matching the
 * INHERITABLE_FIELDS convention used by exceptionDocumentService).
 */
function computeOverrides(member, master) {
  const overrides = {};
  // eventTitle override
  if (normalizeTitle(member.eventTitle) !== normalizeTitle(master.eventTitle)) {
    overrides.eventTitle = member.eventTitle;
  }
  // eventDescription
  if ((member.eventDescription || '') !== (master.eventDescription || '')) {
    overrides.eventDescription = member.eventDescription || '';
  }
  // startTime / endTime
  if ((member.startTime || '') !== (master.startTime || '')) overrides.startTime = member.startTime;
  if ((member.endTime || '') !== (master.endTime || '')) overrides.endTime = member.endTime;
  // locations
  const mLocs = (master.locationIds || []).map(String).sort().join(',');
  const eLocs = (member.locationIds || []).map(String).sort().join(',');
  if (mLocs !== eLocs) {
    overrides.locations = (member.locationIds || []).slice();
    overrides.locationDisplayNames = member.locationDisplayNames || '';
  }
  // categories (string array compare)
  const mCats = (master.categories || []).slice().sort().join(',');
  const eCats = (member.categories || []).slice().sort().join(',');
  if (mCats !== eCats) {
    overrides.categories = (member.categories || []).slice();
  }
  return overrides;
}

function classifyMembers(rows, fit, master) {
  const fitDateSet = new Set(fit.fitDates);
  const classified = [];
  for (const row of rows) {
    const isMaster = row === master || row._id === master._id || row.rsId === master.rsId;
    const inPattern = fitDateSet.has(row.startDate);
    if (isMaster) {
      classified.push({ row, role: 'master', overrides: null, diffsFromMaster: [] });
      continue;
    }
    if (!inPattern) {
      classified.push({ row, role: 'outlier', overrides: null, diffsFromMaster: [] });
      continue;
    }
    const overrides = computeOverrides(row, master);
    const diffsFromMaster = Object.keys(overrides).map((field) => ({
      field,
      master: master[field],
      occurrence: row[field],
    }));
    if (Object.keys(overrides).length === 0) {
      classified.push({ row, role: 'occurrence_clean', overrides: null, diffsFromMaster: [] });
    } else {
      classified.push({ row, role: 'occurrence_override', overrides, diffsFromMaster });
    }
  }
  return classified;
}

// =============================================================================
// Phase 5: confidence scoring + candidate building
// =============================================================================

function scoreCandidate(rows, fit, classification, titleVariantCount) {
  const memberCount = rows.length;
  const outlierCount = classification.filter((m) => m.role === 'outlier').length;
  const overrideCount = classification.filter((m) => m.role === 'occurrence_override').length;

  let score = 1.0;
  score -= 0.3 * (outlierCount / memberCount);
  score -= 0.1 * Math.min(overrideCount / memberCount, 0.5);
  if (titleVariantCount > 1) score -= 0.2;
  if (memberCount < 5) score -= 0.2;
  return Math.max(0, Math.min(1, score));
}

function buildCandidate({ rows, titleVariants, canonicalTitle }, fit, classification, score) {
  const sample = rows[0];
  const locationKey =
    (sample.locationIds && sample.locationIds.length > 0 && String(sample.locationIds[0])) ||
    (Array.isArray(sample.rsKeys) && sample.rsKeys[0]) ||
    sample.rsKey ||
    '';
  const startTime = sample.startTime || '00:00';
  const durationMinutes = computeDurationMinutes(sample.startDateTime, sample.endDateTime);

  const fitDateSet = new Set(fit.fitDates);
  // outlierDatesInRange: dates that the master's fit pattern WOULD expand
  // (i.e., they ARE in fitDates) but no row matched at the master's fields,
  // OR rows that are in fitDates but classified as outlier (role='outlier' and
  // their date IS in fitDates — though by classifyMembers definition, outlier
  // means NOT in fitDates).
  //
  // The actually-relevant case: outlier rows whose date IS within the
  // [startDate, endDate] range AND falls on the pattern's expected dow set.
  // For weekly Wed pattern, an outlier on a Tuesday is OUT of range; an outlier
  // on a different-time Wednesday would have been classified as override
  // (same date, in pattern). We only get here for true date outliers.
  //
  // To be safe and match the plan's outlier-in-range semantics, compute:
  // any outlier whose date falls between fit.range.startDate and fit.range.endDate
  // AND whose dow is in pattern.daysOfWeek (for weekly) OR matches pattern dom
  // (for monthly). For now, conservatively: if an outlier date is NOT in fitDates
  // it doesn't need to go in exclusions (master doesn't expand it). So
  // outlierDatesInRange stays empty unless we explicitly construct it later.
  const outlierDatesInRange = [];

  // candidateId: deterministic short hash so re-detect produces stable IDs.
  const hashSrc = `${canonicalTitle}|${locationKey}|${startTime}|${durationMinutes}`;
  const candidateId = 'cand-' + simpleHash(hashSrc);

  return {
    candidateId,
    canonicalTitle,
    titleVariants,
    locationKey,
    locationDisplayName: sample.locationDisplayNames || '',
    startTime,
    durationMinutes,
    detectedPattern: fit.pattern,
    detectedRange: fit.range,
    memberCount: rows.length,
    outlierCount: classification.filter((m) => m.role === 'outlier').length,
    overrideCount: classification.filter((m) => m.role === 'occurrence_override').length,
    confidence: score,
    members: classification.map((c) => ({
      stagingRowId: c.row._id || null,
      rsId: c.row.rsId,
      eventTitle: c.row.eventTitle,
      startDate: c.row.startDate,
      role: c.role,
      overrides: c.overrides,
      diffsFromMaster: c.diffsFromMaster,
    })),
    outlierDatesInRange,
    status: 'detected',
  };
}

function simpleHash(s) {
  // Small djb2 variant; collisions are fine since we also include sessionId
  // when persisting and it's just for human-readable IDs.
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(36).slice(0, 10);
}

// =============================================================================
// Top-level entrypoint
// =============================================================================

/**
 * Run the full detection pipeline on a list of staging rows.
 * Pure function; safe to call without any DB context.
 *
 * @param {Array<Object>} stagingRows
 * @returns {Array<CandidateSeries>}
 */
function detectRecurrenceCandidates(stagingRows) {
  if (!Array.isArray(stagingRows) || stagingRows.length === 0) return [];

  const initialGroups = groupRowsByKey(stagingRows);
  const mergedBuckets = fuzzyMergeTitles(initialGroups);

  const candidates = [];
  for (const bucket of mergedBuckets) {
    if (bucket.rows.length < MIN_GROUP_SIZE) continue;
    if (bucket.rows.length > MAX_GROUP_SIZE) continue; // bounded fitter cost

    // Sort rows by startDate.
    const sortedRows = bucket.rows.slice().sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
    const fit = fitPattern(sortedRows);
    if (!fit) continue;

    const master = pickMasterRow(sortedRows);
    if (!master) continue;

    const classification = classifyMembers(sortedRows, fit, master);
    const score = scoreCandidate(sortedRows, fit, classification, bucket.titleVariants.length);
    candidates.push(buildCandidate(bucket, fit, classification, score));
  }

  // Sort by confidence desc.
  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates;
}

module.exports = {
  // Constants
  RECURRENCE_CANDIDATES_COLLECTION,
  MIN_GROUP_SIZE,
  MAX_GROUP_SIZE,
  IGNORABLE_TRAILING_TOKENS,
  DAYS_OF_WEEK,

  // String helpers
  normalizeTitle,
  levenshtein,
  jaccardSimilarity,
  shouldMergeTitles,
  isIgnorableSuffixMatch,

  // Date helpers
  parseLocalDate,
  formatDateYmd,
  daysBetween,
  dayOfWeekName,
  computeDurationMinutes,

  // Algorithm pieces
  candidateKey,
  groupRowsByKey,
  fuzzyMergeTitles,
  fitDaily,
  fitWeeklySingleDay,
  fitWeeklyMultiDay,
  fitBiweekly,
  fitMonthlyByDate,
  fitMonthlyByDayOfWeek,
  fitPattern,
  pickMasterRow,
  computeOverrides,
  classifyMembers,
  scoreCandidate,
  buildCandidate,
  simpleHash,

  // Top-level
  detectRecurrenceCandidates,
};
