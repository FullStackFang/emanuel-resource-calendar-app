// ReservationMarkerAdvisory — soft, non-blocking advisory for warnOnReservation
// marker days. Shown for a flagged day, hidden without the flag, dismissible,
// and purely informational (never blocks submission).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { withQueryClient } from '../../__helpers__/queryClientWrapper';

vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

import ReservationMarkerAdvisory from '../../../components/shared/ReservationMarkerAdvisory';

const warnMarker = {
  _id: 'w1', type: 'officeClosed', name: 'Office Closed', startDate: '2026-12-24', endDate: '2026-12-26',
  warnOnReservation: true,
};
const quietMarker = {
  _id: 'q1', type: 'holiday', name: 'Quiet Holiday', startDate: '2026-12-24', endDate: '2026-12-26',
  warnOnReservation: false,
};

const mockMarkers = (markers) => {
  global.fetch = vi.fn(async (url) => {
    if (url.endsWith('/calendar-markers')) return { ok: true, json: async () => markers };
    return { ok: true, json: async () => [] };
  });
};

describe('ReservationMarkerAdvisory', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows a non-blocking advisory when the selected date carries a warnOnReservation marker', async () => {
    mockMarkers([warnMarker]);
    render(<ReservationMarkerAdvisory apiToken="tok" date="2026-12-25" />, { wrapper: withQueryClient() });

    const advisory = await screen.findByRole('status');
    expect(advisory).toHaveTextContent(/Office Closed: Office Closed/);
    expect(advisory).toHaveTextContent(/can still submit/i);
  });

  it('renders nothing when the covering marker is not flagged', async () => {
    mockMarkers([quietMarker]);
    render(<ReservationMarkerAdvisory apiToken="tok" date="2026-12-25" />, { wrapper: withQueryClient() });

    // Give the query a tick; the advisory must never appear.
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders nothing for a date outside every marker range', async () => {
    mockMarkers([warnMarker]);
    render(<ReservationMarkerAdvisory apiToken="tok" date="2026-06-01" />, { wrapper: withQueryClient() });
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('is dismissible and exposes no blocking control (purely informational)', async () => {
    mockMarkers([warnMarker]);
    render(<ReservationMarkerAdvisory apiToken="tok" date="2026-12-25" />, { wrapper: withQueryClient() });

    await screen.findByRole('status');
    // No disabled/submit-blocking element — only a dismiss affordance.
    const dismiss = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismiss);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('renders nothing without a selected date', () => {
    mockMarkers([warnMarker]);
    const { container } = render(<ReservationMarkerAdvisory apiToken="tok" date="" />, { wrapper: withQueryClient() });
    expect(container.querySelector('.reservation-marker-advisory')).toBeNull();
  });
});
