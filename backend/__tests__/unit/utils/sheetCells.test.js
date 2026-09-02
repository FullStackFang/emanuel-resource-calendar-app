/**
 * sheetCells.test.js — SC-1..SC-14
 *
 * Pure-unit coverage for the Scheduling Sheet cell helpers. The
 * client-supplied-taggedEmails-ignored guarantee is asserted here at the util
 * level (extractTaggedEmails takes only stored cells) and again at the
 * endpoint level in schedulingSheets.test.js.
 */

const {
  validateCell,
  extractTaggedEmails,
  cellKey,
  MAX_SEGMENTS_PER_CELL
} = require('../../../utils/sheetCells');

describe('sheetCells', () => {
  describe('validateCell', () => {
    test('SC-1 accepts a mixed cell and preserves segment order', () => {
      const res = validateCell({
        segments: [
          { type: 'text', text: 'Lead:' },
          { type: 'person', userId: 'u1', name: 'Sarah Levine', email: 'Sarah@EmanuelNYC.org', placeholder: false },
          { type: 'location', locationId: 'l1', name: 'Wise Hall' }
        ]
      });
      expect(res.valid).toBe(true);
      expect(res.cell.segments.map(s => s.type)).toEqual(['text', 'person', 'location']);
    });

    test('SC-2 lowercases person emails on normalize', () => {
      const res = validateCell({
        segments: [{ type: 'person', name: 'Sarah', email: 'Sarah@EmanuelNYC.org' }]
      });
      expect(res.valid).toBe(true);
      expect(res.cell.segments[0].email).toBe('sarah@emanuelnyc.org');
    });

    test('SC-3 rejects unknown segment types', () => {
      const res = validateCell({ segments: [{ type: 'formula', text: '=SUM(A1)' }] });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/unknown segment type/);
    });

    test('SC-4 rejects a non-object cell and a non-array segments', () => {
      expect(validateCell(null).valid).toBe(false);
      expect(validateCell({ segments: 'nope' }).valid).toBe(false);
    });

    test('SC-5 caps segment count', () => {
      const segments = Array.from({ length: MAX_SEGMENTS_PER_CELL + 1 }, () => ({ type: 'text', text: 'x' }));
      expect(validateCell({ segments }).valid).toBe(false);
    });

    test('SC-6 placeholder person stores no email even if one is supplied', () => {
      const res = validateCell({
        segments: [{ type: 'person', name: '@usher_team_lead', placeholder: true, email: 'sneaky@x.org' }]
      });
      expect(res.valid).toBe(true);
      expect(res.cell.segments[0].placeholder).toBe(true);
      expect(res.cell.segments[0].email).toBeNull();
    });

    test('SC-7 validates callTimeOverride as HH:MM', () => {
      expect(validateCell({
        segments: [{ type: 'person', name: 'A', email: 'a@x.org', callTimeOverride: '16:00' }]
      }).valid).toBe(true);
      expect(validateCell({
        segments: [{ type: 'person', name: 'A', email: 'a@x.org', callTimeOverride: '4pm' }]
      }).valid).toBe(false);
      expect(validateCell({
        segments: [{ type: 'person', name: 'A', email: 'a@x.org', callTimeOverride: '25:00' }]
      }).valid).toBe(false);
    });

    test('SC-8 drops unknown fields from segments (no passthrough persistence)', () => {
      const res = validateCell({
        segments: [{ type: 'person', name: 'A', email: 'a@x.org', isAdmin: true, extra: 'x' }]
      });
      expect(res.valid).toBe(true);
      expect(res.cell.segments[0]).not.toHaveProperty('isAdmin');
      expect(res.cell.segments[0]).not.toHaveProperty('extra');
    });

    test('SC-9 empty-segment cell is valid (clearing a cell)', () => {
      const res = validateCell({ segments: [] });
      expect(res.valid).toBe(true);
      expect(res.cell.segments).toEqual([]);
      expect(res.cell.note).toBeNull();
    });

    test('SC-10 note round-trips and an invalid note rejects', () => {
      const ok = validateCell({ segments: [], note: { text: 'Bring keys', authorName: 'M. Gold', at: '2026-08-29T12:00:00Z' } });
      expect(ok.valid).toBe(true);
      expect(ok.cell.note.text).toBe('Bring keys');
      expect(validateCell({ segments: [], note: { text: '' } }).valid).toBe(false);
      expect(validateCell({ segments: [], note: 'plain string' }).valid).toBe(false);
    });
  });

  describe('extractTaggedEmails', () => {
    test('SC-11 collects distinct lowercased emails across cells, sorted', () => {
      const cells = {
        'r1:c1': { segments: [
          { type: 'person', name: 'B', email: 'b@x.org' },
          { type: 'person', name: 'A', email: 'A@X.org' }
        ] },
        'r2:c1': { segments: [{ type: 'person', name: 'B again', email: 'b@x.org' }] }
      };
      expect(extractTaggedEmails(cells)).toEqual(['a@x.org', 'b@x.org']);
    });

    test('SC-12 placeholders and text/location segments contribute nothing', () => {
      const cells = {
        'r1:c1': { segments: [
          { type: 'person', name: '@ghost', placeholder: true, email: null },
          { type: 'text', text: 'note' },
          { type: 'location', name: 'Wise Hall' }
        ] }
      };
      expect(extractTaggedEmails(cells)).toEqual([]);
    });

    test('SC-13 derives ONLY from cell content — there is no taggedEmails input to honor', () => {
      // The signature itself is the guarantee: the util reads cells, so a
      // client-supplied taggedEmails array can never reach storage.
      expect(extractTaggedEmails({})).toEqual([]);
      expect(extractTaggedEmails(undefined)).toEqual([]);
    });
  });

  test('SC-14 cellKey is rowId:colId', () => {
    expect(cellKey('r1', 'c2')).toBe('r1:c2');
  });
});
