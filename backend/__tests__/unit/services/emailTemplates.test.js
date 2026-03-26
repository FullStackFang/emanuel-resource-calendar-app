/**
 * Email Template Tests (EU-1 to EU-4, TZ-1 to TZ-5)
 *
 * EU-*: Verifies admin panel URLs with deep-link eventId query parameters.
 * TZ-*: Verifies timezone handling for naive Eastern Time datetime strings.
 */

const {
  generateAdminNewRequestAlert,
  generateAdminEditRequestAlert,
  formatDateTime,
  formatDate,
  formatTime,
} = require('../../../services/emailTemplates');

describe('Email Template URL Tests', () => {
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

  it('EU-1: new request alert renders Review Request button with eventId in URL', async () => {
    const adminPanelUrl = 'https://example.com/?eventId=507f1f77bcf86cd799439011';
    const { html } = await generateAdminNewRequestAlert(mockReservation, adminPanelUrl);

    expect(html).toContain('Review Request');
    expect(html).toContain('href="https://example.com/?eventId=507f1f77bcf86cd799439011"');
  });

  it('EU-2: edit request alert renders Review Edit Request button with eventId in URL', async () => {
    const adminPanelUrl = 'https://example.com/?eventId=507f1f77bcf86cd799439022';
    const { html } = await generateAdminEditRequestAlert(mockEditRequest, adminPanelUrl);

    expect(html).toContain('Review Edit Request');
    expect(html).toContain('href="https://example.com/?eventId=507f1f77bcf86cd799439022"');
  });

  it('EU-3: new request alert omits button when adminPanelUrl is empty', async () => {
    const { html } = await generateAdminNewRequestAlert(mockReservation, '');

    expect(html).not.toContain('Review Request');
    expect(html).not.toContain('href=');
  });

  it('EU-4: edit request alert omits button when adminPanelUrl is empty', async () => {
    const { html } = await generateAdminEditRequestAlert(mockEditRequest, '');

    expect(html).not.toContain('Review Edit Request');
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
