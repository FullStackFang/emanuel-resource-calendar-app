import { describe, it, expect } from 'vitest';
import { buildEditRequestPayload } from '../../../utils/eventPayloadBuilder';

describe('Edit-request payload -- recurrence wiring', () => {
  it('sends recurrence on the wire when form data includes it', () => {
    const formData = {
      eventTitle: 'Title',
      startDate: '2026-04-20', startTime: '09:00',
      endDate: '2026-04-20', endTime: '10:00',
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        range: { type: 'noEnd', startDate: '2026-04-20' },
      },
    };
    const payload = buildEditRequestPayload(formData, { eventVersion: 7 });

    // Ensure recurrence travels through serialization
    const serialized = JSON.parse(JSON.stringify(payload));
    expect(serialized.recurrence).toEqual(formData.recurrence);
  });

  it('does NOT send recurrence key when form data omits it', () => {
    const formData = {
      eventTitle: 'Title',
      startDate: '2026-04-20', startTime: '09:00',
      endDate: '2026-04-20', endTime: '10:00',
    };
    const payload = buildEditRequestPayload(formData, { eventVersion: 7 });
    const serialized = JSON.parse(JSON.stringify(payload));
    expect('recurrence' in serialized).toBe(false);
  });
});
