// CalendarMarkersManagement — form validation surfacing + create/edit/delete
// happy paths, and the keys.calendarMarkers invalidation contract that refreshes
// the calendar ribbon after every mutation.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { createTestQueryClient, withQueryClient } from '../../__helpers__/queryClientWrapper';
import { keys } from '../../../queries/keys';

vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));
vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../../components/shared/LoadingSpinner', () => ({
  default: () => <div data-testid="loading-spinner" />,
}));

const showSuccess = vi.fn();
const showError = vi.fn();
vi.mock('../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess, showError, showWarning: vi.fn() }),
}));

import CalendarMarkersManagement from '../../../components/CalendarMarkersManagement';

const seedMarker = {
  _id: 'm1',
  type: 'holiday',
  name: 'Rosh Hashanah',
  note: '',
  startDate: '2026-09-12',
  endDate: '2026-09-13',
  warnOnReservation: false,
  pushToOutlook: false,
  active: true,
};

describe('CalendarMarkersManagement', () => {
  let client;
  let calls;

  beforeEach(() => {
    calls = { POST: [], PUT: [], DELETE: [] };
    let list = [seedMarker];

    global.fetch = vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      if (url.endsWith('/calendar-markers') && method === 'GET') {
        return { ok: true, json: async () => list };
      }
      if (url.endsWith('/calendar-markers') && method === 'POST') {
        const body = JSON.parse(opts.body);
        calls.POST.push(body);
        const created = { ...body, _id: 'm2', active: true };
        list = [...list, created];
        return { ok: true, json: async () => created };
      }
      if (url.includes('/calendar-markers/') && method === 'PUT') {
        const body = JSON.parse(opts.body);
        calls.PUT.push(body);
        return { ok: true, json: async () => ({ ...seedMarker, ...body }) };
      }
      if (url.includes('/calendar-markers/') && method === 'DELETE') {
        calls.DELETE.push(url);
        list = list.filter((m) => !url.endsWith(m._id));
        return { ok: true, json: async () => ({ message: 'deleted' }) };
      }
      return { ok: true, json: async () => [] };
    });

    client = createTestQueryClient();
    // The calendar-markers query is ACTIVE in this screen, so invalidation
    // immediately triggers a refetch that clears isInvalidated — assert on the
    // invalidateQueries call instead of the (transient) flag.
    invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    showSuccess.mockClear();
    showError.mockClear();
  });

  let invalidateSpy;

  afterEach(() => vi.restoreAllMocks());

  const renderScreen = () =>
    render(<CalendarMarkersManagement apiToken="tok" />, { wrapper: withQueryClient(client) });

  it('lists existing markers sorted by date', async () => {
    renderScreen();
    expect(await screen.findByText('Rosh Hashanah')).toBeInTheDocument();
  });

  it('creates a marker and invalidates the calendar-markers cache', async () => {
    renderScreen();
    await screen.findByText('Rosh Hashanah');

    fireEvent.click(screen.getByRole('button', { name: /add marker/i }));
    fireEvent.change(await screen.findByPlaceholderText('e.g. Rosh Hashanah'), { target: { value: 'Yom Kippur' } });
    fireEvent.click(screen.getByRole('button', { name: /create marker/i }));

    await waitFor(() => expect(calls.POST).toHaveLength(1));
    expect(calls.POST[0].name).toBe('Yom Kippur');
    expect(showSuccess).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: keys.calendarMarkers.all() });
  });

  it('auto-bumps the end date when the start date moves past it', async () => {
    renderScreen();
    await screen.findByText('Rosh Hashanah');

    fireEvent.click(screen.getByRole('button', { name: /add marker/i }));
    await screen.findByPlaceholderText('e.g. Rosh Hashanah');

    const start = screen.getByLabelText('Start date');
    const end = screen.getByLabelText('End date');

    // Moving start forward past the current end drags the end date along.
    fireEvent.change(start, { target: { value: '2026-09-20' } });
    expect(end.value).toBe('2026-09-20');
  });

  it('constrains the end-date picker to dates on or after the start date (min attr)', async () => {
    renderScreen();
    await screen.findByText('Rosh Hashanah');

    fireEvent.click(screen.getByRole('button', { name: /add marker/i }));
    await screen.findByPlaceholderText('e.g. Rosh Hashanah');

    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-20' } });
    expect(screen.getByLabelText('End date')).toHaveAttribute('min', '2026-09-20');
  });

  it('edits a marker (PUT fired with updated name)', async () => {
    renderScreen();
    await screen.findByText('Rosh Hashanah');

    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const nameInput = await screen.findByDisplayValue('Rosh Hashanah');
    fireEvent.change(nameInput, { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(calls.PUT).toHaveLength(1));
    expect(calls.PUT[0].name).toBe('Renamed');
  });

  it('deletes via in-button confirmation (first click arms, second deletes)', async () => {
    renderScreen();
    await screen.findByText('Rosh Hashanah');

    const deleteBtn = screen.getByRole('button', { name: /^delete$/i });
    fireEvent.click(deleteBtn); // arm
    expect(calls.DELETE).toHaveLength(0);
    const confirmBtn = await screen.findByRole('button', { name: /confirm\?/i });

    fireEvent.click(confirmBtn); // confirm
    await waitFor(() => expect(calls.DELETE).toHaveLength(1));
    expect(showSuccess).toHaveBeenCalledWith('Marker deleted');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: keys.calendarMarkers.all() });
  });
});
