// src/__tests__/unit/utils/userFilterUtils.test.js
//
// Locks the pure filter/sort layer behind the /admin/users roster. These
// functions are the single definition of "what role is this account" and
// "does this account match the engaged filters" — the roster rows, the role
// tab counts, and the result count all read them, so a drift here shows up
// as a list and its own counts disagreeing.
//
// Every case is a plain array in / array out. No rendering.

import { describe, it, expect } from 'vitest';
import {
  deriveRole,
  computeActivityThresholds,
  matchesActivityBucket,
  filterUsers,
  sortUsers,
  splitOnMatch,
  ROLE_RANK,
} from '../../../utils/userFilterUtils';

const DAY = 24 * 60 * 60 * 1000;
// Fixed "now" so the activity buckets are deterministic. Every lastLogin below
// is expressed as an offset from it.
const NOW = Date.parse('2026-08-14T12:00:00.000Z');
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

const u = (over = {}) => ({
  _id: over._id || `id-${over.displayName || 'x'}`,
  displayName: 'Someone',
  email: 'someone@test.com',
  title: '',
  department: '',
  roleType: '',
  lastLogin: null,
  ...over,
});

// A directory covering every role, both department states, and all four
// activity positions (recent / mid-gap / dormant / never).
const DIRECTORY = [
  u({ _id: 'a1', displayName: 'Adam Admin', email: 'adam@test.com', effectiveRole: 'admin', department: 'it', roleType: 'staff', title: 'Systems Lead', lastLogin: daysAgo(2) }),
  u({ _id: 'p1', displayName: 'Andy Approver', email: 'andy@test.com', effectiveRole: 'approver', department: 'events', roleType: 'staff', title: 'Program Director', lastLogin: daysAgo(45) }),
  u({ _id: 'r1', displayName: 'Rita Requester', email: 'rita@test.com', effectiveRole: 'requester', department: 'clergy', roleType: 'rabbi', title: 'Senior Rabbi', lastLogin: daysAgo(120) }),
  u({ _id: 'v1', displayName: 'Vera Viewer', email: 'vera@example.org', effectiveRole: 'viewer', department: '', roleType: '', title: '', lastLogin: null }),
  u({ _id: 'r2', displayName: 'Bea Requester', email: 'bea@test.com', effectiveRole: 'requester', department: 'it', roleType: 'staff', title: 'Analyst', lastLogin: daysAgo(5) }),
];

describe('deriveRole', () => {
  // UFU-1..5 pin the fallback chain in order. The chain mirrors the backend
  // getEffectiveRole(); reordering it silently re-labels accounts.
  it('UFU-1: prefers the server-computed effectiveRole', () => {
    expect(deriveRole({ effectiveRole: 'approver', role: 'viewer', isAdmin: true })).toBe('approver');
  });

  it('UFU-2: falls back to role when effectiveRole is absent', () => {
    expect(deriveRole({ role: 'requester', isAdmin: true })).toBe('requester');
  });

  it('UFU-3: falls back to isAdmin', () => {
    expect(deriveRole({ isAdmin: true })).toBe('admin');
  });

  it('UFU-4: falls back to permissions.canViewAllReservations', () => {
    expect(deriveRole({ permissions: { canViewAllReservations: true } })).toBe('approver');
  });

  it('UFU-5: defaults to viewer', () => {
    expect(deriveRole({})).toBe('viewer');
    expect(deriveRole({ isAdmin: false, permissions: { canViewAllReservations: false } })).toBe('viewer');
  });
});

describe('activity buckets', () => {
  // UFU-6: the thresholds are derived once from a single `now` (D3) — the
  // filter pass must not read the clock per row.
  it('UFU-6: computeActivityThresholds derives both cutoffs from one now', () => {
    const t = computeActivityThresholds(NOW);
    expect(t.activeSince).toBe(NOW - 30 * DAY);
    expect(t.dormantBefore).toBe(NOW - 90 * DAY);
  });

  it('UFU-7: active matches a login inside 30 days and excludes one outside', () => {
    const t = computeActivityThresholds(NOW);
    expect(matchesActivityBucket(u({ lastLogin: daysAgo(2) }), 'active', t)).toBe(true);
    expect(matchesActivityBucket(u({ lastLogin: daysAgo(45) }), 'active', t)).toBe(false);
    expect(matchesActivityBucket(u({ lastLogin: null }), 'active', t)).toBe(false);
  });

  it('UFU-8: dormant matches 90 days or more and excludes the 45-day gap', () => {
    const t = computeActivityThresholds(NOW);
    expect(matchesActivityBucket(u({ lastLogin: daysAgo(120) }), 'dormant', t)).toBe(true);
    expect(matchesActivityBucket(u({ lastLogin: daysAgo(45) }), 'dormant', t)).toBe(false);
  });

  // UFU-9: never-signed-in is its own bucket, not folded into dormant (D3).
  // A provisioned-but-unused account is a different administrative problem
  // than a long-dormant one.
  it('UFU-9: never matches only accounts with no lastLogin, and dormant excludes them', () => {
    const t = computeActivityThresholds(NOW);
    expect(matchesActivityBucket(u({ lastLogin: null }), 'never', t)).toBe(true);
    expect(matchesActivityBucket(u({ lastLogin: daysAgo(400) }), 'never', t)).toBe(false);
    expect(matchesActivityBucket(u({ lastLogin: null }), 'dormant', t)).toBe(false);
  });

  it('UFU-10: an unrecognized bucket matches everything', () => {
    const t = computeActivityThresholds(NOW);
    expect(matchesActivityBucket(u({ lastLogin: null }), '', t)).toBe(true);
  });

  it('UFU-11: an unparseable lastLogin is treated as never signed in', () => {
    const t = computeActivityThresholds(NOW);
    expect(matchesActivityBucket(u({ lastLogin: 'not-a-date' }), 'never', t)).toBe(true);
    expect(matchesActivityBucket(u({ lastLogin: 'not-a-date' }), 'active', t)).toBe(false);
  });
});

describe('filterUsers — search', () => {
  it('UFU-12: matches a substring of the display name', () => {
    const out = filterUsers(DIRECTORY, { searchTerm: 'rita', now: NOW });
    expect(out.map((x) => x._id)).toEqual(['r1']);
  });

  it('UFU-13: matches a substring of the email', () => {
    const out = filterUsers(DIRECTORY, { searchTerm: 'example.org', now: NOW });
    expect(out.map((x) => x._id)).toEqual(['v1']);
  });

  // UFU-14 is the reason title is searched at all: an administrator looking
  // for "the rabbi" knows the title, not the account name.
  it('UFU-14: matches a substring of the title', () => {
    const out = filterUsers(DIRECTORY, { searchTerm: 'senior rabbi', now: NOW });
    expect(out.map((x) => x._id)).toEqual(['r1']);
  });

  it('UFU-15: search is case-insensitive in both directions', () => {
    expect(filterUsers(DIRECTORY, { searchTerm: 'ADAM', now: NOW }).map((x) => x._id)).toEqual(['a1']);
    expect(filterUsers(DIRECTORY, { searchTerm: 'systems lead', now: NOW }).map((x) => x._id)).toEqual(['a1']);
  });

  it('UFU-16: a blank or whitespace-only term filters nothing out', () => {
    expect(filterUsers(DIRECTORY, { searchTerm: '', now: NOW })).toHaveLength(5);
    expect(filterUsers(DIRECTORY, { searchTerm: '   ', now: NOW })).toHaveLength(5);
  });

  it('UFU-17: a term matching nothing returns an empty array, not the input', () => {
    expect(filterUsers(DIRECTORY, { searchTerm: 'zzzz', now: NOW })).toEqual([]);
  });
});

describe('filterUsers — role, department, org role', () => {
  it('UFU-18: role narrows to that effective role', () => {
    expect(filterUsers(DIRECTORY, { role: 'requester', now: NOW }).map((x) => x._id)).toEqual(['r1', 'r2']);
  });

  it('UFU-19: role "all" (or absent) does not narrow', () => {
    expect(filterUsers(DIRECTORY, { role: 'all', now: NOW })).toHaveLength(5);
    expect(filterUsers(DIRECTORY, {})).toHaveLength(5);
  });

  it('UFU-20: department narrows to that department key', () => {
    expect(filterUsers(DIRECTORY, { department: 'it', now: NOW }).map((x) => x._id)).toEqual(['a1', 'r2']);
  });

  // UFU-21: the department select's default value is '' (= all), so "has no
  // department" needs its own sentinel or it is unreachable.
  it('UFU-21: the NONE sentinel selects accounts with no department', () => {
    expect(filterUsers(DIRECTORY, { department: '__none__', now: NOW }).map((x) => x._id)).toEqual(['v1']);
  });

  it('UFU-22: roleType narrows, and its NONE sentinel works the same way', () => {
    expect(filterUsers(DIRECTORY, { roleType: 'rabbi', now: NOW }).map((x) => x._id)).toEqual(['r1']);
    expect(filterUsers(DIRECTORY, { roleType: '__none__', now: NOW }).map((x) => x._id)).toEqual(['v1']);
  });
});

describe('filterUsers — composition', () => {
  // UFU-23 is the spec's "filters compose" scenario: approvers, in a
  // department, active in 30 days.
  it('UFU-23: role + department + activity compose to an intersection', () => {
    expect(
      filterUsers(DIRECTORY, { role: 'requester', department: 'it', activity: 'active', now: NOW }).map((x) => x._id)
    ).toEqual(['r2']);
  });

  it('UFU-24: composing with search narrows further still', () => {
    expect(
      filterUsers(DIRECTORY, { role: 'requester', searchTerm: 'analyst', now: NOW }).map((x) => x._id)
    ).toEqual(['r2']);
  });

  it('UFU-25: a composition matching nothing returns empty', () => {
    expect(filterUsers(DIRECTORY, { role: 'admin', department: 'clergy', now: NOW })).toEqual([]);
  });

  it('UFU-26: filterUsers never mutates its input', () => {
    const snapshot = JSON.stringify(DIRECTORY);
    filterUsers(DIRECTORY, { role: 'admin', searchTerm: 'a', now: NOW });
    expect(JSON.stringify(DIRECTORY)).toBe(snapshot);
  });
});

describe('sortUsers', () => {
  it('UFU-27: ROLE_RANK orders admin, approver, requester, viewer', () => {
    expect(ROLE_RANK.admin).toBeLessThan(ROLE_RANK.approver);
    expect(ROLE_RANK.approver).toBeLessThan(ROLE_RANK.requester);
    expect(ROLE_RANK.requester).toBeLessThan(ROLE_RANK.viewer);
  });

  // UFU-28 pins the pre-existing default display order so the rewrite does
  // not silently reshuffle the roster administrators already know.
  it('UFU-28: role_name ranks by role, then alphabetically within a role', () => {
    expect(sortUsers(DIRECTORY, 'role_name').map((x) => x._id)).toEqual(['a1', 'p1', 'r2', 'r1', 'v1']);
  });

  it('UFU-29: role_name is the default for an unknown sort key', () => {
    expect(sortUsers(DIRECTORY, 'nonsense').map((x) => x._id)).toEqual(
      sortUsers(DIRECTORY, 'role_name').map((x) => x._id)
    );
  });

  it('UFU-30: name_asc and name_desc are pure reverses of each other', () => {
    const asc = sortUsers(DIRECTORY, 'name_asc').map((x) => x._id);
    expect(asc).toEqual(['a1', 'p1', 'r2', 'r1', 'v1']);
    expect(sortUsers(DIRECTORY, 'name_desc').map((x) => x._id)).toEqual([...asc].reverse());
  });

  it('UFU-31: an account with no displayName sorts on its email', () => {
    const list = [u({ _id: 'z', displayName: '', email: 'aaa@test.com' }), u({ _id: 'y', displayName: 'Bob' })];
    expect(sortUsers(list, 'name_asc').map((x) => x._id)).toEqual(['z', 'y']);
  });

  // UFU-32 is the spec's activity-sort scenario: never-signed-in accounts
  // sort last, not first (a null date must not read as the oldest date).
  it('UFU-32: activity sorts most-recent first and places never-signed-in last', () => {
    expect(sortUsers(DIRECTORY, 'activity').map((x) => x._id)).toEqual(['a1', 'r2', 'p1', 'r1', 'v1']);
  });

  it('UFU-33: sortUsers returns a new array and does not mutate its input', () => {
    const before = DIRECTORY.map((x) => x._id);
    const out = sortUsers(DIRECTORY, 'name_desc');
    expect(out).not.toBe(DIRECTORY);
    expect(DIRECTORY.map((x) => x._id)).toEqual(before);
  });
});

describe('splitOnMatch', () => {
  // Highlighting splits on indexOf rather than a regex, so a term full of
  // metacharacters (every email contains '.') needs no escaping to be safe.
  it('UFU-34: splits a string into before / match / after segments', () => {
    expect(splitOnMatch('Adam Admin', 'dam')).toEqual([
      { text: 'A', match: false },
      { text: 'dam', match: true },
      { text: ' Admin', match: false },
    ]);
  });

  it('UFU-35: preserves the original casing of the matched span', () => {
    expect(splitOnMatch('Adam Admin', 'ADAM')).toEqual([
      { text: 'Adam', match: true },
      { text: ' Admin', match: false },
    ]);
  });

  it('UFU-36: treats regex metacharacters literally', () => {
    expect(splitOnMatch('a.b@test.com', '.b@')).toEqual([
      { text: 'a', match: false },
      { text: '.b@', match: true },
      { text: 'test.com', match: false },
    ]);
    // '.' as a regex would match the first character; literally it does not.
    expect(splitOnMatch('xyz', '.')).toEqual([{ text: 'xyz', match: false }]);
  });

  it('UFU-37: an empty term or empty text yields one unmatched segment', () => {
    expect(splitOnMatch('Adam', '')).toEqual([{ text: 'Adam', match: false }]);
    expect(splitOnMatch('', 'a')).toEqual([{ text: '', match: false }]);
    expect(splitOnMatch(null, 'a')).toEqual([{ text: '', match: false }]);
  });

  it('UFU-38: highlights every occurrence, not just the first', () => {
    expect(splitOnMatch('aXaXa', 'x')).toEqual([
      { text: 'a', match: false },
      { text: 'X', match: true },
      { text: 'a', match: false },
      { text: 'X', match: true },
      { text: 'a', match: false },
    ]);
  });
});
