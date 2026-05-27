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
});
