// assignmentSubject.test.js
//
// The schedule email's subject line. Every recipient of one send gets the same
// subject, and until now it was always the WORKBOOK name — so a Friday-only
// send and a whole-workbook send arrived looking identical in an inbox, which
// is what made a second send indistinguishable from the first.
//
// These rules live on the client because the panel prefills an editable field
// and then sends the resolved string explicitly. The server keeps its own
// simpler rule purely as the fallback for a client that sends no subject, so
// nothing here is duplicated backend-side.
//
// Test IDs: ASJ-1 to ASJ-9

import { describe, it, expect } from 'vitest';
import { buildScopeLabel, buildAssignmentSubject } from '../../../../components/scheduling/assignmentSubject';

const SHEET_NAME = '2027 High Holy Days';
// Deliberately out of date order, so an implementation that trusts input order
// instead of sorting cannot pass.
const ALL_DAYS = [
  { _id: 'd3', date: '2027-09-20' },
  { _id: 'd1', date: '2027-09-11' },
  { _id: 'd5', date: '2027-09-25' },
  { _id: 'd2', date: '2027-09-13' },
  { _id: 'd4', date: '2027-09-21' },
];

const label = (selectedDayIds) => buildScopeLabel({ sheetName: SHEET_NAME, allDays: ALL_DAYS, selectedDayIds });

describe('buildScopeLabel (ASJ-1 to ASJ-6, ASJ-8)', () => {
  it('ASJ-1: one day is named by its own full date', () => {
    // Matches what a legacy single-day send has always used, so the common case
    // reads exactly as it does today.
    expect(label(['d1'])).toBe('Saturday, September 11, 2027');
  });

  it('ASJ-2: selecting every day is the workbook name alone', () => {
    expect(label(['d1', 'd2', 'd3', 'd4', 'd5'])).toBe(SHEET_NAME);
  });

  it('ASJ-3: a two-day subset names both dates', () => {
    expect(label(['d1', 'd3'])).toBe(`${SHEET_NAME} — Sep 11 & Sep 20`);
  });

  it('ASJ-4: a three-day subset lists all three', () => {
    expect(label(['d1', 'd2', 'd3'])).toBe(`${SHEET_NAME} — Sep 11, Sep 13 & Sep 20`);
  });

  it('ASJ-5: four or more days collapse to a count and a span', () => {
    // Listing every date would push the subject past what an inbox shows, and a
    // truncated subject is worse than a summarized one.
    expect(label(['d1', 'd2', 'd3', 'd4'])).toBe(`${SHEET_NAME} — 4 days, Sep 11-Sep 21`);
  });

  it('ASJ-6: dates read chronologically whatever order they were selected in', () => {
    expect(label(['d3', 'd1'])).toBe(`${SHEET_NAME} — Sep 11 & Sep 20`);
    expect(label(['d4', 'd2', 'd1'])).toBe(`${SHEET_NAME} — Sep 11, Sep 13 & Sep 21`);
  });

  it('ASJ-8: an empty selection falls back to the workbook name', () => {
    // Sending is disabled with nothing selected, but the field is still on
    // screen and must never render 'undefined'.
    expect(label([])).toBe(SHEET_NAME);
  });
});

describe('buildAssignmentSubject (ASJ-7, ASJ-9)', () => {
  const subject = (template, selectedDayIds) =>
    buildAssignmentSubject({
      subjectTemplate: template,
      sheetName: SHEET_NAME,
      allDays: ALL_DAYS,
      selectedDayIds,
    });

  it('ASJ-7: the scope label is substituted into the template, leaving its other text alone', () => {
    expect(subject('Your assignments for {{scopeLabel}}', ['d1', 'd3']))
      .toBe(`Your assignments for ${SHEET_NAME} — Sep 11 & Sep 20`);
  });

  it('ASJ-9: a template without the placeholder is returned as written', () => {
    // An admin may have replaced the subject with fixed wording in Email
    // Management; that choice is theirs to keep.
    expect(subject('Please check your High Holy Day post', ['d1'])).toBe('Please check your High Holy Day post');
    // A missing or blank template still yields something sendable.
    expect(subject('', ['d1'])).toBe('Saturday, September 11, 2027');
    expect(subject(undefined, ['d1'])).toBe('Saturday, September 11, 2027');
  });
});
