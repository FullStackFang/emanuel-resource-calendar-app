/**
 * Email Template Tests (EU-1 to EU-14, TZ-1 to TZ-5, RC-*)
 *
 * EU-1, EU-2: Admin alert emails render event details AND a deep-link CTA button.
 * EU-3: Requester-facing emails render a "View Reservation" CTA button.
 * EU-4: When _id is missing, the {{#eventUrl}} guard suppresses the CTA cleanly.
 * EU-5: Cancellation alert (third email shape) renders the CTA.
 * EU-6, EU-7: Existing template literals do not leak when variables are absent.
 * EU-10: DB override body without {{#eventUrl}} still renders the centralized CTA.
 * EU-11: DB override body with legacy {{#eventUrl}} block renders the CTA exactly once.
 * EU-12: ERROR_NOTIFICATION renders no CTA button.
 * EU-13: previewTemplate path renders CTA for an overridden body (parity with send path).
 * EU-14: Every TEMPLATE_ID is classified (has CTA config OR is in NO_CTA set).
 * TZ-*: Verifies timezone handling for naive Eastern Time datetime strings.
 */

const {
  generateSubmissionConfirmation,
  generateAdminNewRequestAlert,
  generateAdminEditRequestAlert,
  generateAdminCancellationRequestAlert,
  generateErrorNotification,
  previewTemplate,
  setDbConnection,
  TEMPLATE_IDS,
  CTA_CONFIG,
  NO_CTA_TEMPLATES,
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

  const mockCancellationEvent = {
    _id: '507f1f77bcf86cd799439033',
    eventTitle: 'Cancelled Workshop',
    roomReservationData: {
      requestedBy: { name: 'John Smith', email: 'john@example.com' },
    },
    calendarData: {
      startDateTime: '2026-03-26T18:00:00',
      endDateTime: '2026-03-26T20:00:00',
      locationDisplayNames: 'Auditorium',
    },
  };

  it('EU-1: new request alert renders event details AND review-request deep link', async () => {
    const { html } = await generateAdminNewRequestAlert(mockReservation);

    expect(html).toContain('Board Meeting');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('Review Request');
    expect(html).toContain('?eventId=507f1f77bcf86cd799439011');
    expect(html).toContain('<a href="');
  });

  it('EU-2: edit request alert renders event details AND review-request deep link', async () => {
    const { html } = await generateAdminEditRequestAlert(mockEditRequest);

    expect(html).toContain('Updated Board Meeting');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('Review Request');
    expect(html).toContain('?eventId=507f1f77bcf86cd799439022');
  });

  it('EU-3: requester-facing submission confirmation renders "View Reservation" deep link', async () => {
    const { html } = await generateSubmissionConfirmation(mockReservation);

    expect(html).toContain('Board Meeting');
    expect(html).toContain('View Reservation');
    expect(html).toContain('?eventId=507f1f77bcf86cd799439011');
    // Should NOT use the approver label
    expect(html).not.toContain('Review Request');
  });

  it('EU-4: missing _id suppresses CTA button via {{#eventUrl}} guard', async () => {
    const reservationWithoutId = { ...mockReservation };
    delete reservationWithoutId._id;
    const { html } = await generateAdminNewRequestAlert(reservationWithoutId);

    // No CTA anchor block should render
    expect(html).not.toContain('Review Request');
    expect(html).not.toContain('?eventId=');
    // No template literal should leak through
    expect(html).not.toContain('{{eventUrl}}');
    expect(html).not.toContain('{{#eventUrl}}');
    // Event content still renders normally
    expect(html).toContain('Board Meeting');
  });

  it('EU-5: cancellation alert renders review-request deep link', async () => {
    const { html } = await generateAdminCancellationRequestAlert(
      mockCancellationEvent,
      'Conflict with another booking'
    );

    expect(html).toContain('Cancelled Workshop');
    expect(html).toContain('Review Request');
    expect(html).toContain('?eventId=507f1f77bcf86cd799439033');
    expect(html).toContain('Conflict with another booking');
  });

  it('EU-6: rendered output never contains unresolved {{...}} template markers', async () => {
    const { html } = await generateAdminNewRequestAlert(mockReservation);

    // No raw {{variable}} or {{#variable}} blocks should leak
    expect(html).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it('EU-7: deep link URL falls back to canonical production URL when FRONTEND_URL env unset', async () => {
    const originalEnv = process.env.FRONTEND_URL;
    delete process.env.FRONTEND_URL;
    try {
      const { html } = await generateAdminNewRequestAlert(mockReservation);
      // Default URL is the canonical custom domain + /scheduler sub-path
      expect(html).toContain('https://emanuelnyc.org/scheduler');
      expect(html).toContain('eventId=507f1f77bcf86cd799439011');
    } finally {
      if (originalEnv !== undefined) process.env.FRONTEND_URL = originalEnv;
    }
  });

  it('EU-8: deep link respects FRONTEND_URL env override (e.g. for local dev)', async () => {
    const originalEnv = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://localhost:5173';
    try {
      const { html } = await generateAdminNewRequestAlert(mockReservation);
      expect(html).toContain('https://localhost:5173/?eventId=507f1f77bcf86cd799439011');
    } finally {
      if (originalEnv !== undefined) {
        process.env.FRONTEND_URL = originalEnv;
      } else {
        delete process.env.FRONTEND_URL;
      }
    }
  });

  it('EU-9: malformed FRONTEND_URL falls back gracefully (no crash, uses default)', async () => {
    const originalEnv = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'not a valid url';
    try {
      const { html } = await generateAdminNewRequestAlert(mockReservation);
      // Falls back to the canonical default
      expect(html).toContain('https://emanuelnyc.org/scheduler');
      expect(html).toContain('eventId=507f1f77bcf86cd799439011');
    } finally {
      if (originalEnv !== undefined) {
        process.env.FRONTEND_URL = originalEnv;
      } else {
        delete process.env.FRONTEND_URL;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // EU-10 to EU-14: Centralized CTA rendering (override-resilient).
  //
  // The CTA button used to live inline in every template body via a
  // {{#eventUrl}}...{{/eventUrl}} block. When admins customized a template
  // through the admin UI, the override (stored in templeEvents__SystemSettings)
  // replaced the default body — and if the override predated the CTA feature,
  // the button silently disappeared. The fix hoists the CTA into a centralized
  // append step inside generateFromTemplate() (and previewTemplate()), so every
  // template — default or override — gets the button automatically.
  // ---------------------------------------------------------------------------

  describe('Centralized CTA rendering', () => {
    // Build a fake dbConnection that returns whatever override we configure.
    // setDbConnection(null) restores the default-only path.
    function makeFakeDb(overrideDoc) {
      return {
        collection: () => ({
          findOne: async () => overrideDoc
        })
      };
    }

    afterEach(() => {
      setDbConnection(null);
    });

    it('EU-10: DB override body without {{#eventUrl}} block still renders the CTA button', async () => {
      // Regression test for the production bug. An admin saved a customized
      // body BEFORE the CTA feature shipped; the override has no eventUrl block.
      // The centralized append must still attach the button.
      setDbConnection(makeFakeDb({
        _id: 'email-template-admin-new-request',
        subject: 'Action Required: New Reservation Request',
        body: '<p>Hello {{requesterName}} — new request for {{eventTitle}}.</p>'
      }));

      const { subject, html } = await generateAdminNewRequestAlert(mockReservation);

      expect(subject).toBe('Action Required: New Reservation Request');
      expect(html).toContain('Hello Jane Doe');
      expect(html).toContain('new request for Board Meeting');
      // The CTA must be present even though the override body lacks it.
      expect(html).toContain('Review Request');
      expect(html).toContain('?eventId=507f1f77bcf86cd799439011');
    });

    it('EU-11: DB override body with legacy {{#eventUrl}} block renders the CTA exactly once', async () => {
      // Some overrides may have been saved AFTER the CTA shipped and carry the
      // legacy inline block. The strip-then-append logic must neutralize it so
      // we never render two buttons.
      setDbConnection(makeFakeDb({
        _id: 'email-template-admin-new-request',
        subject: 'Action Required: New Reservation Request',
        body: `<p>Hello {{requesterName}}.</p>
{{#eventUrl}}<p><a href="{{eventUrl}}">Review Request</a></p>{{/eventUrl}}`
      }));

      const { html } = await generateAdminNewRequestAlert(mockReservation);

      const matches = html.match(/Review Request/g) || [];
      expect(matches.length).toBe(1);
      // And no leaked Mustache markers.
      expect(html).not.toContain('{{#eventUrl}}');
      expect(html).not.toContain('{{/eventUrl}}');
    });

    it('EU-12: ERROR_NOTIFICATION renders no CTA button', async () => {
      // Error notifications are system alerts to admins about backend errors;
      // they have no event scope and must not surface a "View Reservation" link.
      const { html } = await generateErrorNotification({
        correlationId: 'corr-123',
        userMessage: 'Something went wrong',
        errorMessage: 'TypeError: foo is not a function',
        stack: 'at thing.js:42',
        timestamp: new Date()
      });

      // No CTA anchor pointing at the scheduler should appear.
      expect(html).not.toMatch(/href="[^"]*scheduler/);
      expect(html).not.toContain('View Reservation');
      expect(html).not.toContain('Review Request');
    });

    it('EU-13: previewTemplate renders CTA for an overridden body (parity with send path)', async () => {
      // The admin UI preview path must agree with the send path. Otherwise
      // admins editing a template will see the preview without the CTA and
      // conclude the fix did not land.
      setDbConnection(makeFakeDb({
        _id: 'email-template-admin-new-request',
        subject: 'Action Required: New Reservation Request',
        body: '<p>Custom override body.</p>'
      }));

      const { html } = await previewTemplate('admin-new-request');

      expect(html).toContain('Custom override body.');
      expect(html).toContain('Review Request');
      // Preview should use a sample eventUrl so the button has a real-looking href.
      expect(html).toMatch(/href="[^"]*scheduler[^"]*\?eventId=/);
    });

    it('EU-14: Every TEMPLATE_ID is classified as either CTA-bearing or CTA-omitted', () => {
      // Classification lock — adding a new TEMPLATE_ID without deciding its CTA
      // policy will fail this test. Prevents silent reintroduction of the bug.
      expect(CTA_CONFIG).toBeDefined();
      expect(NO_CTA_TEMPLATES).toBeDefined();
      expect(NO_CTA_TEMPLATES instanceof Set).toBe(true);

      const allIds = Object.values(TEMPLATE_IDS);
      const unclassified = allIds.filter(
        id => !Object.prototype.hasOwnProperty.call(CTA_CONFIG, id) && !NO_CTA_TEMPLATES.has(id)
      );
      expect(unclassified).toEqual([]);

      // Sanity: admin alerts use "Review Request" label and red color.
      expect(CTA_CONFIG[TEMPLATE_IDS.ADMIN_NEW_REQUEST].label).toBe('Review Request');
      expect(CTA_CONFIG[TEMPLATE_IDS.ADMIN_NEW_REQUEST].color).toBe('#c53030');
      // Sanity: requester-facing uses "View Reservation" label and blue color.
      expect(CTA_CONFIG[TEMPLATE_IDS.SUBMISSION_CONFIRMATION].label).toBe('View Reservation');
      expect(CTA_CONFIG[TEMPLATE_IDS.SUBMISSION_CONFIRMATION].color).toBe('#2b6cb0');
      // Sanity: error/user-report templates are NOT CTA-bearing.
      expect(NO_CTA_TEMPLATES.has(TEMPLATE_IDS.ERROR_NOTIFICATION)).toBe(true);
      expect(NO_CTA_TEMPLATES.has(TEMPLATE_IDS.USER_REPORT_ACKNOWLEDGMENT)).toBe(true);
    });
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
