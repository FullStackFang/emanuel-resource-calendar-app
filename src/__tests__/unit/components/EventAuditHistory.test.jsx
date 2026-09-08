import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { bridgeSseToReactQuery } from '../../../hooks/useServerEvents';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EventAuditHistory from '../../../components/EventAuditHistory';

let queryClient;
afterEach(() => { cleanup(); queryClient?.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function renderComponent() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><EventAuditHistory eventId="reported-event" apiToken="test-token" /></QueryClientProvider>);
}

function renderHistory(entry) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ auditHistory: [
    { timestamp: '2026-09-08T13:20:54Z', ...entry },
  ] }) }));
  return renderComponent();
}

describe('EventAuditHistory', () => {
  it('shows the approver and date changes stored as an array', async () => {
    renderHistory({ action: 'edit-request-approved', performedByEmail: 'approver@example.com', changes: [
      { field: 'startDate', oldValue: '2027-04-26', newValue: '2027-04-29' },
    ] });
    await screen.findByText('edit-request-approved');
    expect(screen.getByText('approver@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Show details'));
    expect(screen.getByText('2027-04-26')).toBeInTheDocument();
    expect(screen.getByText('2027-04-29')).toBeInTheDocument();
  });

  it('continues to show legacy changeSet details', async () => {
    renderHistory({ changeType: 'update', changeSet: [
      { field: 'eventTitle', oldValue: 'Old title', newValue: 'New title' },
    ] });
    fireEvent.click(await screen.findByTitle('Show details'));
    expect(screen.getByText('Old title')).toBeInTheDocument();
    expect(screen.getByText('New title')).toBeInTheDocument();
  });

  it('continues to show a legacy single change', async () => {
    renderHistory({ changeType: 'update', changes: { field: 'eventTitle', oldValue: 'Old title', newValue: 'New title' } });
    expect(await screen.findByText(/Old title.*New title/)).toBeInTheDocument();
  });

  it('does not render an empty change array as a None-to-None change', async () => {
    renderHistory({ action: 'edit-request-submitted', changes: [] });
    await screen.findByText('edit-request-submitted');
    expect(screen.queryByText(/None/)).not.toBeInTheDocument();
  });

  it.each([
    {},
    { field: 'startDate' },
    [{ field: 'startDate' }],
    { field: 'doorOpenTime', oldValue: null, newValue: null },
    [{ field: 'doorOpenTime', oldValue: null, newValue: null }],
  ])('keeps the action without inventing a change for %j', async (changes) => {
    renderHistory({ action: 'edit-request-approved', changes });
    await screen.findByText('edit-request-approved');
    expect(screen.queryByText(/None/)).not.toBeInTheDocument();
    expect(screen.queryByTitle('Show details')).not.toBeInTheDocument();
    expect(screen.getByText('No field changes recorded.')).toBeInTheDocument();
  });

  it('shows from/to values in a legacy single change', async () => {
    renderHistory({ changeType: 'update', changes: { field: 'startDate', from: '2027-04-26', to: '2027-04-29' } });
    expect(await screen.findByText(/2027-04-26.*2027-04-29/)).toBeInTheDocument();
    expect(screen.queryByText(/None/)).not.toBeInTheDocument();
  });

  it('preserves an explicit removal and distinguishes an unrecorded previous value', async () => {
    renderHistory({ changeType: 'update', changes: [
      { field: 'doorOpenTime', oldValue: '16:00', newValue: null },
      { field: 'startDate', newValue: '2027-04-29' },
    ] });
    fireEvent.click(await screen.findByTitle('Show details'));
    expect(screen.getByText('16:00')).toBeInTheDocument();
    expect(screen.getAllByText('None')).toHaveLength(1);
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
    expect(screen.getByText('2027-04-29')).toBeInTheDocument();
  });

  it('does not add a bogus inline change beside a valid changeSet', async () => {
    renderHistory({ changeType: 'update', changes: {}, changeSet: [
      { field: 'startDate', oldValue: '2027-04-26', newValue: '2027-04-29' },
    ] });
    fireEvent.click(await screen.findByTitle('Show details'));
    expect(screen.getByText('2027-04-26')).toBeInTheDocument();
    expect(screen.getByText('2027-04-29')).toBeInTheDocument();
    expect(screen.queryByText(/None/)).not.toBeInTheDocument();
  });

  it('preserves changes to false and zero', async () => {
    renderHistory({ changeType: 'update', changes: [
      { field: 'isAllDayEvent', oldValue: true, newValue: false },
      { field: 'setupTimeMinutes', oldValue: 30, newValue: 0 },
    ] });
    fireEvent.click(await screen.findByTitle('Show details'));
    expect(screen.getByText('false')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('refreshes an open history after an SSE update and keeps the same entry expanded', async () => {
    const original = { _id: 'old', action: 'edit-request-approved', timestamp: '2026-09-08T13:20:54Z', changes: [
      { field: 'startDate', oldValue: '2027-04-26', newValue: '2027-04-29' },
    ] };
    renderHistory(original);
    fireEvent.click(await screen.findByTitle('Show details'));
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ auditHistory: [
      { _id: 'new', action: 'Updated again', timestamp: '2026-09-08T13:22:42Z' }, original,
    ] }) });
    act(() => { bridgeSseToReactQuery({ eventId: 'reported-event', action: 'updated' }, queryClient); });
    expect(await screen.findByText('Updated again')).toBeInTheDocument();
    expect(screen.getByText('2027-04-29')).toBeInTheDocument();
  });

  it('loads older history entries beyond the first page', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ auditHistory: [
        { _id: 'new', action: 'Recent change', timestamp: '2026-09-08T13:20:54Z' },
      ], pagination: { total: 2, offset: 0, limit: 1, hasMore: true } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ auditHistory: [
        { _id: 'old', action: 'Older change', timestamp: '2026-08-18T13:20:54Z' },
      ], pagination: { total: 2, offset: 1, limit: 1, hasMore: false } }) }));
    renderComponent();
    fireEvent.click(await screen.findByRole('button', { name: 'Load older changes' }));
    expect(await screen.findByText('Older change')).toBeInTheDocument();
    expect(screen.getByText('Recent change')).toBeInTheDocument();
    expect(fetch.mock.calls[1][0]).toContain('offset=1');
  });

  it('shows requested changes separately from applied changes', async () => {
    renderHistory({ action: 'edit-request-submitted', changes: [], metadata: {
      proposedChanges: { startDate: '2027-04-29' },
    } });
    fireEvent.click(await screen.findByTitle('Show details'));
    expect(screen.getByText('Requested changes:')).toBeInTheDocument();
    expect(screen.getByText('2027-04-29')).toBeInTheDocument();
    expect(screen.queryByText('Changes made:')).not.toBeInTheDocument();
  });

  it('presents requested fields with readable labels, units, and explicit empty values', async () => {
    renderHistory({ action: 'edit-request-submitted', changes: [], metadata: {
      proposedChanges: {
        setupTimeMinutes: 120, teardownTimeMinutes: 120,
        reservationStartMinutes: 120, reservationEndMinutes: 120,
        reservationStartTime: '16:00', reservationEndTime: '17:00',
        doorOpenTime: null, doorCloseTime: null, isOnBehalfOf: false,
        contactName: '', contactEmail: '',
      },
    } });
    fireEvent.click(await screen.findByTitle('Show details'));
    expect(screen.getByText('Setup buffer')).toBeInTheDocument();
    expect(screen.getByText('Reservation start')).toBeInTheDocument();
    expect(screen.getAllByText('120 min')).toHaveLength(4);
    expect(screen.getByText('4:00 PM')).toBeInTheDocument();
    expect(screen.getByText('5:00 PM')).toBeInTheDocument();
    expect(screen.getByText('On behalf of someone else')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getAllByText('Not set')).toHaveLength(4);
    expect(screen.getAllByRole('term')).toHaveLength(11);
    expect(screen.getAllByRole('definition')).toHaveLength(11);
  });

  it('shows legacy from/to fields in reservation audits', async () => {
    renderHistory({ changeType: 'resubmit', changeSet: [{ field: 'status', from: 'rejected', to: 'pending' }] });
    fireEvent.click(await screen.findByTitle('Show details'));
    expect(screen.getByText('rejected')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('checks for new history every 30 seconds when no live event arrives', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    renderHistory({ action: 'Original entry' });
    await screen.findByText('Original entry');
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ auditHistory: [
      { _id: 'new', action: 'Polled entry', timestamp: '2026-09-08T13:22:42Z' },
    ] }) });
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(await screen.findByText('Polled entry')).toBeInTheDocument();
  });
});
