import { describe, it, expect } from 'vitest';
import cases from '../../../../backend/__tests__/__fixtures__/eventEditabilityCases.json';
import { canRequestEditEvent, canDirectEditEvent } from '../../../utils/eventEditability';

describe('eventEditability shared contract (frontend)', () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(canRequestEditEvent(c.event, c.user)).toBe(c.expect.canRequestEditEvent);
      expect(canDirectEditEvent(c.event, c.user)).toBe(c.expect.canDirectEditEvent);
    });
  }

  it('exports the expected 13-function surface', async () => {
    const mod = await import('../../../utils/eventEditability');
    expect(Object.keys(mod).sort()).toEqual([
      'canDirectEditEvent', 'canRequestEditEvent', 'hasPendingEditRequest',
      'isAdminEditor', 'isCommunityEditable', 'isEventOwner', 'isEventOwnerless',
      'isRschedImported', 'isSameDepartment', 'isSeriesChild', 'normalizeDepartment',
      'resolveEventDepartment', 'resolveOwnerEmail',
    ]);
  });
});
