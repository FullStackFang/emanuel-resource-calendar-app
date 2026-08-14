// src/utils/userFilterUtils.js
//
// Pure filter/sort layer for the /admin/users roster, mirroring the shape of
// reservationFilterUtils.js: plain functions over an in-memory array, unit
// tested without rendering.
//
// Why these live outside the component
// ────────────────────────────────────
// `GET /api/users` returns the whole collection with no query params, so every
// filter is client-side. More importantly, `deriveRole` is read by BOTH the
// role tab counts and the row badges — leaving it private to the component is
// how a list and its own counts drift apart. One definition, here.
//
// A hook was considered and rejected: there is no lifecycle, no async, and no
// subscription here, and a hook would hide the useMemo boundaries the
// component should own.

// Display rank for the default roster order: admin first, then approver,
// requester, viewer. Lower sorts earlier; unknown roles fall to the bottom.
export const ROLE_RANK = { admin: 0, approver: 1, requester: 2, viewer: 3 };

// Sentinel for "this optional field is unset". The department / org-role
// selects use '' for "all", which is also the key of the None department in
// templeEvents__Departments — so "has no department" needs its own value or
// it is unreachable from the filter bar.
export const FILTER_NONE = '__none__';

const DAY_MS = 24 * 60 * 60 * 1000;
export const ACTIVE_WITHIN_DAYS = 30;
export const DORMANT_AFTER_DAYS = 90;

/**
 * Classify an account's effective role. Prefers the server-computed
 * `effectiveRole` (sent by GET /api/users), falling back to the same legacy
 * chain the backend getEffectiveRole() uses.
 *
 * NOTE: the dead `preferences.*` legacy checks are deliberately absent —
 * preferences.isAdmin / preferences.createEvents are documented dead code and
 * were never honored server-side.
 */
export function deriveRole(user) {
  if (!user) return 'viewer';
  if (user.effectiveRole) return user.effectiveRole;
  if (user.role) return user.role;
  if (user.isAdmin === true) return 'admin';
  if (user.permissions?.canViewAllReservations === true) return 'approver';
  return 'viewer';
}

/**
 * Derive both activity cutoffs from a single clock read. Called once per
 * filter pass rather than once per row, so filtering an 84-account directory
 * does not allocate 168 Date objects.
 *
 * @param {number} [now=Date.now()] epoch millis
 * @returns {{ activeSince: number, dormantBefore: number }}
 */
export function computeActivityThresholds(now = Date.now()) {
  return {
    activeSince: now - ACTIVE_WITHIN_DAYS * DAY_MS,
    dormantBefore: now - DORMANT_AFTER_DAYS * DAY_MS,
  };
}

// Parse lastLogin to epoch millis, or null when absent/unparseable. An
// unparseable timestamp reads as "never signed in" rather than as 1970 —
// NaN comparisons would otherwise quietly exclude the row from every bucket.
function loginTime(user) {
  if (!user?.lastLogin) return null;
  const t = Date.parse(user.lastLogin);
  return Number.isNaN(t) ? null : t;
}

/**
 * Does this account fall in the named activity bucket?
 *
 * Buckets are deliberately NOT exhaustive: an account that signed in 45 days
 * ago is neither active nor dormant nor never, and matches none of them. The
 * question is "does it match the selected bucket", not "which bucket owns it".
 *
 * @param {object} user
 * @param {'active'|'dormant'|'never'|''} bucket
 * @param {{activeSince:number, dormantBefore:number}} thresholds
 */
export function matchesActivityBucket(user, bucket, thresholds) {
  const t = loginTime(user);
  switch (bucket) {
    case 'active':
      return t !== null && t >= thresholds.activeSince;
    case 'dormant':
      return t !== null && t <= thresholds.dormantBefore;
    case 'never':
      return t === null;
    default:
      return true;
  }
}

// Case-insensitive substring test over the three searched fields. Shared with
// splitOnMatch so highlighting can never disagree with what matched.
function matchesSearch(user, term) {
  return (
    (user.displayName || '').toLowerCase().includes(term) ||
    (user.email || '').toLowerCase().includes(term) ||
    (user.title || '').toLowerCase().includes(term)
  );
}

function matchesOptional(value, selected) {
  if (!selected) return true;
  if (selected === FILTER_NONE) return !value;
  return value === selected;
}

/**
 * Narrow the directory to accounts matching every engaged criterion.
 *
 * @param {Array} users
 * @param {object} criteria
 * @param {string} [criteria.searchTerm] free text over name / email / title
 * @param {string} [criteria.role]       effective role, or 'all'
 * @param {string} [criteria.department] department key, or FILTER_NONE
 * @param {string} [criteria.roleType]   org-role key, or FILTER_NONE
 * @param {string} [criteria.activity]   'active' | 'dormant' | 'never'
 * @param {number} [criteria.now]        clock override, for tests
 * @returns {Array} a new array; the input is never mutated
 */
export function filterUsers(users, criteria = {}) {
  const { searchTerm, role, department, roleType, activity, now } = criteria;
  const term = searchTerm?.trim().toLowerCase() || '';
  // One clock read for the whole pass (D3), even when no activity filter is
  // engaged — the object is two numbers and the branch would cost more.
  const thresholds = computeActivityThresholds(now ?? Date.now());

  return (users || []).filter((user) => {
    if (term && !matchesSearch(user, term)) return false;
    if (role && role !== 'all' && deriveRole(user) !== role) return false;
    if (!matchesOptional(user.department, department)) return false;
    if (!matchesOptional(user.roleType, roleType)) return false;
    if (activity && !matchesActivityBucket(user, activity, thresholds)) return false;
    return true;
  });
}

// Name used for alphabetical ordering, with email as the fallback for
// accounts provisioned without a display name.
const sortName = (user) => user.displayName || user.email || '';

const byName = (a, b) =>
  sortName(a).localeCompare(sortName(b), undefined, { sensitivity: 'base' });

/**
 * Order the roster.
 *
 * @param {Array} users
 * @param {'role_name'|'name_asc'|'name_desc'|'activity'} sortBy
 * @returns {Array} a new array; the input is never mutated
 */
export function sortUsers(users, sortBy) {
  const sorted = [...(users || [])];

  switch (sortBy) {
    case 'name_asc':
      sorted.sort(byName);
      break;
    case 'name_desc':
      sorted.sort((a, b) => byName(b, a));
      break;
    case 'activity':
      // Most recent first. Never-signed-in accounts sort AFTER every account
      // that has — a null date must not read as the oldest date.
      sorted.sort((a, b) => {
        const ta = loginTime(a);
        const tb = loginTime(b);
        if (ta === null && tb === null) return byName(a, b);
        if (ta === null) return 1;
        if (tb === null) return -1;
        if (ta !== tb) return tb - ta;
        return byName(a, b);
      });
      break;
    case 'role_name':
    default:
      sorted.sort((a, b) => {
        const rankA = ROLE_RANK[deriveRole(a)] ?? Number.MAX_SAFE_INTEGER;
        const rankB = ROLE_RANK[deriveRole(b)] ?? Number.MAX_SAFE_INTEGER;
        if (rankA !== rankB) return rankA - rankB;
        return byName(a, b);
      });
      break;
  }

  return sorted;
}

/**
 * Split `text` into alternating unmatched / matched segments for search
 * highlighting.
 *
 * Uses indexOf, not a regex, so a term full of metacharacters needs no
 * escaping to be safe — and every email in this directory contains a '.'.
 * The matched span keeps the ORIGINAL casing of the source text.
 *
 * @returns {Array<{text: string, match: boolean}>} always at least one segment
 */
export function splitOnMatch(text, term) {
  const source = text || '';
  const needle = term?.trim().toLowerCase() || '';
  if (!needle || !source) return [{ text: source, match: false }];

  const haystack = source.toLowerCase();
  const segments = [];
  let cursor = 0;

  for (;;) {
    const hit = haystack.indexOf(needle, cursor);
    if (hit === -1) break;
    if (hit > cursor) segments.push({ text: source.slice(cursor, hit), match: false });
    segments.push({ text: source.slice(hit, hit + needle.length), match: true });
    cursor = hit + needle.length;
  }

  if (segments.length === 0) return [{ text: source, match: false }];
  if (cursor < source.length) segments.push({ text: source.slice(cursor), match: false });
  return segments;
}
