// src/__tests__/unit/components/mobile/MobileCalendarTab.test.jsx
//
// Locks the calendar tab shell: the agenda and the 3-day grid are two
// presentations of ONE window. The load-bearing guarantee is that switching
// between them is pure presentation — no refetch, no date reset — so these
// tests drive the REAL useMobileEvents hook over a mocked fetch rather than
// stubbing the hook, which would make the no-refetch assertion vacuous.
//
// MobileEventDetail is stubbed: the real sheet pulls in MSAL, notifications,
// and the floor-plan fetch, none of which this container is responsible for.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('../../../../config/config', () => ({
  default: {
    API_BASE_URL: 'http://localhost:3001/api',
    DEFAULT_DISPLAY_CALENDAR: 'TempleEvents@example.org',
    CALENDAR_CONFIG: {
      DEFAULT_MODE: 'sandbox',
      SANDBOX_CALENDAR: 'sandbox@example.org',
      PRODUCTION_CALENDAR: 'prod@example.org',
    },
  },
}));
vi.mock('../../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: 'test-token' }),
}));
vi.mock('../../../../utils/agendaEventPipeline', () => ({
  prepareEventsForAgenda: (raw) => raw,
}));
vi.mock('../../../../utils/eventTransformers', () => ({
  transformEventToFlatStructure: (e) => e,
}));
vi.mock('../../../../hooks/useCategoriesQuery', () => ({
  useOutlookCategoriesQuery: () => ({
    data: [{ name: 'Worship', color: 'preset8' }],
  }),
}));
vi.mock('../../../../hooks/useScrollLock', () => ({ default: vi.fn() }));
vi.mock('../../../../components/mobile/MobileEventDetail', () => ({
  default: ({ event, onClose }) => (
    event ? (
      <div data-testid="detail-sheet">
        <span>{event.eventTitle}</span>
        <button onClick={onClose}>Close sheet</button>
      </div>
    ) : null
  ),
}));

import MobileCalendarTab, { VIEW_STORAGE_KEY } from '../../../../components/mobile/MobileCalendarTab';

const EVENTS = [
  {
    id: 'e1',
    status: 'published',
    eventTitle: 'Morning Minyan',
    categories: ['Worship'],
    startDate: '2026-07-15',
    endDate: '2026-07-15',
    startDateTime: '2026-07-15T07:00:00',
    endDateTime: '2026-07-15T08:00:00',
  },
  {
    id: 'e2',
    status: 'published',
    eventTitle: 'Board Meeting',
    categories: ['Worship'],
    startDate: '2026-07-16',
    endDate: '2026-07-16',
    startDateTime: '2026-07-16T19:00:00',
    endDateTime: '2026-07-16T20:30:00',
  },
];

async function renderTab() {
  const utils = render(<MobileCalendarTab />);
  // The mount fetch resolves before anything meaningful can be asserted.
  await waitFor(() => expect(screen.queryByText(/Morning Minyan/)).toBeTruthy());
  return utils;
}

describe('MobileCalendarTab', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0)); // Wed Jul 15 2026
    window.localStorage.clear();
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ events: EVENTS }),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens in the agenda view when no preference is stored', async () => {
    await renderTab();

    expect(screen.getByRole('button', { name: 'Agenda' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '3 Day' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('three-day-scroll')).toBeNull();
  });

  it('restores the 3 Day view from localStorage', async () => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, 'threeDay');
    await renderTab();

    expect(screen.getByTestId('three-day-scroll')).toBeTruthy();
    expect(screen.getByRole('button', { name: '3 Day' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('ignores an unrecognized stored view and falls back to agenda', async () => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, 'week');
    await renderTab();

    expect(screen.getByRole('button', { name: 'Agenda' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('switches to the 3-day grid without refetching, and persists the choice', async () => {
    await renderTab();
    const callsBefore = globalThis.fetch.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: '3 Day' }));
    await act(async () => {});

    expect(screen.getByTestId('three-day-scroll')).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledTimes(callsBefore);
    expect(window.localStorage.getItem(VIEW_STORAGE_KEY)).toBe('threeDay');

    // ...and back, still with no network.
    fireEvent.click(screen.getByRole('button', { name: 'Agenda' }));
    await act(async () => {});
    expect(globalThis.fetch).toHaveBeenCalledTimes(callsBefore);
    expect(window.localStorage.getItem(VIEW_STORAGE_KEY)).toBe('agenda');
  });

  it('keeps the selected date when switching views', async () => {
    await renderTab();

    // Thu Jul 16, inside the already-loaded week.
    fireEvent.click(screen.getByRole('button', { name: /Thursday July 16/i }));
    fireEvent.click(screen.getByRole('button', { name: '3 Day' }));
    await act(async () => {});

    expect(screen.getByTestId('three-day-column-2026-07-16')).toBeTruthy();
    expect(screen.queryByTestId('three-day-column-2026-07-15')).toBeNull();
  });

  it('week strip taps drive the 3-day window', async () => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, 'threeDay');
    await renderTab();

    expect(screen.getByTestId('three-day-column-2026-07-15')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Friday July 17/i }));
    await act(async () => {});

    // Selected date is the LEFTMOST column; the window runs forward from it.
    expect(screen.getByTestId('three-day-column-2026-07-17')).toBeTruthy();
    expect(screen.getByTestId('three-day-column-2026-07-19')).toBeTruthy();
    expect(screen.queryByTestId('three-day-column-2026-07-15')).toBeNull();
  });

  it('opens the detail sheet from an agenda card', async () => {
    await renderTab();
    expect(screen.queryByTestId('detail-sheet')).toBeNull();

    fireEvent.click(screen.getByText('Morning Minyan').closest('button'));

    const sheet = screen.getByTestId('detail-sheet');
    expect(sheet.textContent).toContain('Morning Minyan');
  });

  it('opens the detail sheet from a 3-day grid block', async () => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, 'threeDay');
    await renderTab();
    expect(screen.queryByTestId('detail-sheet')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Morning Minyan, 7:00 AM/i }));

    expect(screen.getByTestId('detail-sheet').textContent).toContain('Morning Minyan');
  });
});
