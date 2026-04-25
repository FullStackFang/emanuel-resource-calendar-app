/**
 * Email Template Tests (EU-1 to EU-2, TZ-1 to TZ-5)
 *
 * EU-*: Verifies admin alert emails render without review links.
 * TZ-*: Verifies timezone handling for naive Eastern Time datetime strings.
 */

const {
  generateAdminNewRequestAlert,
  generateAdminEditRequestAlert,
  formatDateTime,
  formatDate,
  formatTime,
  summarizeRecurrenceFromJson,
  formatChangeRow,
  buildChangesTableHtml,
} = require('../../../services/emailTemplates');

describe('Email Template Content Tests', () => {
  const mockReservation = {
    _id: '507f1f77bcf86cd799439011',
    eventTitle: 'Board Meeting',
    requesterName: 'Jane Doe',
    requesterEmail: 'jane@example.com',
    startTime: '2026-03-24T07:00:00Z',
    endTime: '2026-03-24T08:00:00Z',
    locationDisplayNames: '4th Floor Conference Room',
    attendeeCount: 10,
  };

  const mockEditRequest = {
    _id: '507f1f77bcf86cd799439022',
    eventTitle: 'Updated Board Meeting',
    requesterName: 'Jane Doe',
    requesterEmail: 'jane@example.com',
    startTime: '2026-03-24T09:00:00Z',
    endTime: '2026-03-24T10:00:00Z',
    locationDisplayNames: '4th Floor Conference Room',
    proposedChanges: [],
  };

  it('EU-1: new request alert renders event details without review link', async () => {
    const { html } = await generateAdminNewRequestAlert(mockReservation);

    expect(html).toContain('Board Meeting');
    expect(html).toContain('Jane Doe');
    expect(html).not.toContain('Review Request');
    expect(html).not.toContain('adminPanelUrl');
  });

  it('EU-2: edit request alert renders event details without review link', async () => {
    const { html } = await generateAdminEditRequestAlert(mockEditRequest);

    expect(html).toContain('Updated Board Meeting');
    expect(html).toContain('Jane Doe');
    expect(html).not.toContain('Review Edit Request');
    expect(html).not.toContain('adminPanelUrl');
  });
});

describe('Email Timezone Formatting Tests', () => {
  // These tests verify that naive Eastern Time strings are formatted correctly
  // regardless of the server's timezone (critical for Azure which runs in UTC).

  it('TZ-1: formatDateTime with naive string preserves wall-clock time', () => {
    const result = formatDateTime('2026-03-25T16:30:00');

    // Should show 4:30 PM, not 12:30 PM (UTC→Eastern shift)
    expect(result).toContain('4:30 PM');
    expect(result).toContain('March 25, 2026');
  });

  it('TZ-2: formatTime with naive string preserves wall-clock time', () => {
    const result = formatTime('2026-03-25T16:30:00');

    expect(result).toContain('4:30 PM');
  });

  it('TZ-3: formatDate with naive string preserves correct date', () => {
    const result = formatDate('2026-03-25T16:30:00');

    expect(result).toContain('March 25, 2026');
    expect(result).toContain('Wednesday');
  });

  it('TZ-4: formatDateTime with Date object formats to Eastern Time', () => {
    // Date objects (like createdAt) are UTC timestamps — should convert to Eastern
    const date = new Date('2026-03-25T20:30:00Z'); // 8:30 PM UTC = 4:30 PM EDT
    const result = formatDateTime(date);

    expect(result).toContain('4:30 PM');
    expect(result).toContain('EDT');
  });

  it('TZ-5: formatDateTime with Z-suffixed string converts to Eastern', () => {
    const result = formatDateTime('2026-03-25T20:30:00Z'); // 8:30 PM UTC = 4:30 PM EDT

    expect(result).toContain('4:30 PM');
    expect(result).toContain('EDT');
  });
});

describe('Recurrence Summary Formatting Tests', () => {
  // RC-1: summarizeRecurrenceFromJson with JSON string input
  it('RC-1: summarizes weekly recurrence JSON string as readable text', () => {
    const json = JSON.stringify({
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] },
      range: { startDate: '2026-04-20', endDate: '2026-06-30' }
    });
    const result = summarizeRecurrenceFromJson(json);
    expect(result).toBe('weekly every 1 on monday,wednesday from 2026-04-20 until 2026-06-30');
  });

  // RC-2: summarizeRecurrenceFromJson with already-parsed object
  it('RC-2: summarizes already-parsed recurrence object', () => {
    const obj = {
      pattern: { type: 'daily', interval: 2 },
      range: { startDate: '2026-05-01' }
    };
    const result = summarizeRecurrenceFromJson(obj);
    expect(result).toBe('daily every 2 from 2026-05-01');
  });

  // RC-3: summarizeRecurrenceFromJson with invalid JSON returns '(invalid)'
  it('RC-3: returns (invalid) for malformed JSON string', () => {
    expect(summarizeRecurrenceFromJson('{not valid json')).toBe('(invalid)');
  });

  // RC-4: summarizeRecurrenceFromJson with null/no-pattern input returns '(none)'
  it('RC-4: returns (none) for null or object without pattern', () => {
    expect(summarizeRecurrenceFromJson(null)).toBe('(none)');
    expect(summarizeRecurrenceFromJson({})).toBe('(none)');
    expect(summarizeRecurrenceFromJson({ range: {} })).toBe('(none)');
  });

  // RC-5: formatChangeRow intercepts recurrence field and humanizes values
  it('RC-5: formatChangeRow replaces JSON in recurrence row with readable summary', () => {
    const raw = {
      field: 'recurrence',
      oldValue: JSON.stringify({ pattern: { type: 'weekly', interval: 1, daysOfWeek: ['friday'] }, range: { startDate: '2026-01-01' } }),
      newValue: JSON.stringify({ pattern: { type: 'weekly', interval: 2, daysOfWeek: ['monday'] }, range: { startDate: '2026-01-01' } })
    };
    const row = formatChangeRow(raw);
    expect(row.displayName).toBe('Recurrence');
    expect(row.oldValue).toBe('weekly every 1 on friday from 2026-01-01');
    expect(row.newValue).toBe('weekly every 2 on monday from 2026-01-01');
  });

  // RC-6: formatChangeRow passes non-recurrence rows through unchanged
  it('RC-6: formatChangeRow passes non-recurrence rows through with displayName normalised', () => {
    const raw = { field: 'eventTitle', displayName: 'Event Title', oldValue: 'Old Title', newValue: 'New Title' };
    const row = formatChangeRow(raw);
    expect(row.displayName).toBe('Event Title');
    expect(row.oldValue).toBe('Old Title');
    expect(row.newValue).toBe('New Title');
  });

  // RC-7: buildChangesTableHtml renders recurrence row as human-readable text (not JSON)
  it('RC-7: buildChangesTableHtml renders recurrence summary, not raw JSON', () => {
    const recurrenceJson = JSON.stringify({
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
      range: { startDate: '2026-03-01' }
    });
    const changes = [
      { field: 'recurrence', oldValue: '(none)', newValue: recurrenceJson }
    ];
    const html = buildChangesTableHtml(changes);
    expect(html).toContain('Recurrence');
    expect(html).toContain('weekly every 1 on tuesday from 2026-03-01');
    expect(html).not.toContain('"pattern"');
    expect(html).not.toContain('"daysOfWeek"');
  });
});
