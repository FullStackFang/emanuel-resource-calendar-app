/**
 * Email Template URL Tests (EU-1 to EU-4)
 *
 * Verifies that email templates render the correct admin panel URLs,
 * including deep-link eventId query parameters.
 */

const {
  generateAdminNewRequestAlert,
  generateAdminEditRequestAlert,
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
