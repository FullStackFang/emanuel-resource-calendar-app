import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Capture the options passed to the PDF generator so we can assert the wiring.
const generateCalendarPdf = vi.fn(() => ({ blobUrl: 'blob:x', fileName: 'x.pdf', eventCount: 0 }));
vi.mock('../../../utils/calendarPdfGenerator', () => ({
  generateCalendarPdf: (...args) => generateCalendarPdf(...args),
}));

// The shared markers hook returns a fixed active marker.
vi.mock('../../../hooks/useCalendarMarkersQuery', () => ({
  useCalendarMarkersQuery: () => ({
    data: [{ _id: 'h1', type: 'holiday', name: 'Shavuot', startDate: '2026-05-20', endDate: '2026-05-20' }],
  }),
}));

// NotificationContext is unrelated to this assertion; stub it.
vi.mock('../../../context/NotificationContext', () => ({
  useNotification: () => ({ showError: vi.fn(), showSuccess: vi.fn(), showWarning: vi.fn() }),
}));

import EventSearchExport from '../../../components/EventSearchExport';

beforeEach(() => {
  generateCalendarPdf.mockClear();
  // fetchAllMatchingEvents hits /events/list — return an empty result set.
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ events: [] }) }));
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
  globalThis.URL.revokeObjectURL = vi.fn();
  // The export triggers a download via an <a> click; stub it so jsdom doesn't
  // attempt (and warn about) navigation.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

describe('EventSearchExport — markers wiring', () => {
  it('ESX-MK-1: forwards active markers and the date range to generateCalendarPdf', async () => {
    render(
      <EventSearchExport
        searchResults={[{}]}
        apiToken="token"
        dateRange={{ start: '2026-05-20', end: '2026-05-22' }}
        timezone="America/New_York"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /pdf/i }));

    await waitFor(() => expect(generateCalendarPdf).toHaveBeenCalledTimes(1));
    const opts = generateCalendarPdf.mock.calls[0][0];
    expect(opts.markers).toHaveLength(1);
    expect(opts.markers[0].name).toBe('Shavuot');
    expect(opts.searchCriteria.dateRange).toEqual({ start: '2026-05-20', end: '2026-05-22' });
  });
});
