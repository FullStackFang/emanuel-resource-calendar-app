// useMentionPicker.test.jsx
//
// The ONE definition of what '@', '#' and plain text mean in a scheduling
// sheet cell, now that two surfaces consume it: the modal SheetCellEditor and
// the in-cell InlineCellEditor. These tests are the contract that keeps the
// two from drifting — a suggestion kind added to one surface only shows up
// here first.
//
// Test IDs: UMP-*

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';

import useMentionPicker, {
  MATCH_CAP,
  personSegment,
  locationSegment,
  timeSegment,
  placeholderSegment,
  externalPersonSegment,
  textSegment,
} from '../../../../components/scheduling/useMentionPicker';

const PEOPLE = [
  { userId: 'u1', name: 'Sarah Levine', email: 'sarah@x.org' },
  { userId: 'u2', name: 'Sam Alto', email: 'sam@x.org' },
  { userId: 'u3', name: 'Sandy Boone', email: 'sandy@x.org' },
  { userId: 'u4', name: 'Saul Chan', email: 'saul@x.org' },
  { userId: 'u5', name: 'Sasha Diaz', email: 'sasha@x.org' },
  { userId: 'u6', name: 'Salim Evans', email: 'salim@x.org' },
  { userId: 'u7', name: 'Sable Fox', email: 'sable@x.org' },
  { userId: 'u8', name: 'Sage Gil', email: 'sage@x.org' },
];

const LOCATIONS = [
  { _id: 'l1', displayName: 'Wise Hall' },
  { _id: 'l2', displayName: 'Leventritt' },
  { _id: 'l3', displayName: 'Wise Annex' },
];

const pick = (input, { people = PEOPLE, locations = LOCATIONS } = {}) =>
  renderHook(({ value }) => useMentionPicker({ input: value, people, locations }), {
    initialProps: { value: input },
  }).result;

describe('useMentionPicker — mode detection', () => {
  it('UMP-1: a bare string is plain text mode with no matches offered', () => {
    const r = pick('Ch. 4 backup');
    expect(r.current.mode).toBe('text');
    expect(r.current.term).toBe('Ch. 4 backup');
    expect(r.current.personMatches).toEqual([]);
    expect(r.current.locationMatches).toEqual([]);
  });

  it('UMP-2: @ is the universal tag — people AND a locations group', () => {
    const r = pick('@wise');
    expect(r.current.mode).toBe('mention');
    expect(r.current.term).toBe('wise');
    expect(r.current.locationMatches.map((l) => l.displayName)).toEqual(['Wise Hall', 'Wise Annex']);
  });

  it('UMP-3: # narrows to locations only', () => {
    const r = pick('#wise');
    expect(r.current.mode).toBe('location');
    expect(r.current.personMatches).toEqual([]);
    expect(r.current.locationMatches.map((l) => l.displayName)).toEqual(['Wise Hall', 'Wise Annex']);
  });

  it('UMP-4: an empty @ offers the whole directory rather than nothing', () => {
    const r = pick('@');
    expect(r.current.personMatches).toHaveLength(MATCH_CAP);
    expect(r.current.personOverflow).toBe(PEOPLE.length - MATCH_CAP);
  });
});

describe('useMentionPicker — the five-match cap', () => {
  it('UMP-5: person matches cap at five with an honest overflow count', () => {
    const r = pick('@sa');
    // All 8 people match 'sa'; only five are offered.
    expect(r.current.personMatches).toHaveLength(MATCH_CAP);
    expect(r.current.personOverflow).toBe(3);
  });

  it('UMP-6: a term inside the cap reports no overflow', () => {
    const r = pick('@levine');
    expect(r.current.personMatches).toHaveLength(1);
    expect(r.current.personOverflow).toBe(0);
  });

  it('UMP-7: matching is case-insensitive across name and email', () => {
    expect(pick('@LEVINE').current.personMatches[0].userId).toBe('u1');
    expect(pick('@sandy@x').current.personMatches[0].userId).toBe('u3');
  });

  it('UMP-8: location matches cap and report overflow the same way', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ _id: `x${i}`, displayName: `Room ${i}` }));
    const r = pick('#room', { locations: many });
    expect(r.current.locationMatches).toHaveLength(MATCH_CAP);
    expect(r.current.locationOverflow).toBe(4);
  });
});

describe('useMentionPicker — times', () => {
  it('UMP-9: a time typed as plain text previews its normalized form', () => {
    expect(pick('6p').current.timePreview).toEqual({ value: '18:00', display: '6:00 PM' });
  });

  it('UMP-10: @ followed by a time offers that time as a selectable entry', () => {
    const r = pick('@6pm');
    expect(r.current.mentionTime).toEqual({ value: '18:00', display: '6:00 PM' });
  });

  it('UMP-11: text that is not a time offers no time entry', () => {
    const r = pick('after kiddush');
    expect(r.current.timePreview).toBeNull();
    expect(r.current.mentionTime).toBeNull();
  });
});

describe('useMentionPicker — the pending input segment', () => {
  it('UMP-12: an empty input represents no segment', () => {
    expect(pick('').current.pendingSegment()).toBeNull();
    expect(pick('   ').current.pendingSegment()).toBeNull();
  });

  it('UMP-13: a time-shaped input normalizes on commit', () => {
    expect(pick('630pm').current.pendingSegment()).toEqual({ type: 'text', text: '6:30 PM' });
  });

  it('UMP-14: non-time text commits exactly as typed', () => {
    expect(pick('after kiddush').current.pendingSegment()).toEqual({ type: 'text', text: 'after kiddush' });
  });

  it('UMP-15: an unpicked @term is kept as text, never silently dropped', () => {
    expect(pick('@Marcus').current.pendingSegment()).toEqual({ type: 'text', text: '@Marcus' });
  });
});

describe('useMentionPicker — segment builders', () => {
  it('UMP-16: every suggestion kind builds the stored segment shape', () => {
    expect(personSegment(PEOPLE[0])).toEqual({
      type: 'person', userId: 'u1', name: 'Sarah Levine', email: 'sarah@x.org', placeholder: false, callTimeOverride: null,
    });
    expect(locationSegment(LOCATIONS[0])).toEqual({ type: 'location', locationId: 'l1', name: 'Wise Hall' });
    expect(timeSegment({ value: '18:00', display: '6:00 PM' })).toEqual({ type: 'text', text: '6:00 PM' });
    expect(placeholderSegment('usher_team')).toEqual({
      type: 'person', userId: null, name: '@usher_team', email: null, placeholder: true, callTimeOverride: null,
    });
    expect(externalPersonSegment('Marcus Webb', 'marcus@abc.com')).toEqual({
      type: 'person', userId: null, name: 'Marcus Webb', email: 'marcus@abc.com', placeholder: false, callTimeOverride: null,
    });
    expect(textSegment('Ch. 4')).toEqual({ type: 'text', text: 'Ch. 4' });
  });

  it('UMP-17: an external person with no email stores null, not an empty string', () => {
    expect(externalPersonSegment('Marcus Webb', '   ').email).toBeNull();
  });
});
