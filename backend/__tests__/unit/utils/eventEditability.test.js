const cases = require('@fixtures/eventEditabilityCases.json');
const {
  canRequestEditEvent,
  canDirectEditEvent,
} = require('../../../utils/eventEditability');

describe('eventEditability shared contract (backend)', () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(canRequestEditEvent(c.event, c.user)).toBe(c.expect.canRequestEditEvent);
      expect(canDirectEditEvent(c.event, c.user)).toBe(c.expect.canDirectEditEvent);
    });
  }

  it('exports the expected 13-function surface', () => {
    const mod = require('../../../utils/eventEditability');
    expect(Object.keys(mod).sort()).toEqual([
      'canDirectEditEvent', 'canRequestEditEvent', 'hasPendingEditRequest',
      'isAdminEditor', 'isCommunityEditable', 'isEventOwner', 'isEventOwnerless',
      'isRschedImported', 'isSameDepartment', 'isSeriesChild', 'normalizeDepartment',
      'resolveEventDepartment', 'resolveOwnerEmail',
    ]);
  });
});
