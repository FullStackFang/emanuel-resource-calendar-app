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

/** A horizontal drag across `dx` px, clearing the axis lock and the threshold. */
function swipe(el, dx) {
  fireEvent.touchStart(el, { touches: [{ clientX: 200, clientY: 300 }] });
  fireEvent.touchMove(el, { touches: [{ clientX: 200 + dx / 2, clientY: 300 }] });
  fireEvent.touchMove(el, { touches: [{ clientX: 200 + dx, clientY: 300 }] });
  fireEvent.touchEnd(el, { changedTouches: [{ clientX: 200 + dx, clientY: 300 }] });
}

const SECTION_HEIGHT = 100;
const boxAt = (top) => ({
  top, bottom: top + SECTION_HEIGHT, height: SECTION_HEIGHT,
  left: 0, right: 400, width: 400, x: 0, y: top,
});

/**
 * jsdom has no layout, so the agenda's scroll spy needs its geometry supplied:
 * day section N starts at N * SECTION_HEIGHT in the list's content space.
 */
function stubAgendaGeometry(container) {
  const list = container.querySelector('.mobile-agenda-list');
  let scrollTop = 0;
  Object.defineProperty(list, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v) => { scrollTop = v; },
  });
  list.getBoundingClientRect = () => boxAt(0);

  const measure = () => {
    container.querySelectorAll('.mobile-agenda-day').forEach((el, i) => {
      el.getBoundingClientRect = () => boxAt(i * SECTION_HEIGHT - scrollTop);
    });
  };
  measure();

  return (index) => {
    scrollTop = index * SECTION_HEIGHT;
    measure();
    fireEvent.scroll(list);
  };
}

describe('MobileCalendarTab', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0)); // Wed Jul 15 2026
    window.localStorage.clear();
    // jsdom implements neither, and the agenda's scroll-into-view uses both.
    Element.prototype.scrollIntoView = vi.fn();
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

  describe('day-stepping swipe', () => {
    /** The gesture zone wraps the active view only — never the week strip. */
    const viewZone = (container) => container.querySelector('.mobile-calendar-view');

    it('steps one day forward on a swipe left', async () => {
      const { container } = await renderTab();
      expect(screen.getByRole('button', { name: /Wednesday July 15/i }).getAttribute('aria-pressed')).toBe('true');

      swipe(viewZone(container), -120);
      await act(async () => {});

      expect(screen.getByRole('button', { name: /Thursday July 16/i }).getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByRole('button', { name: /Wednesday July 15/i }).getAttribute('aria-pressed')).toBe('false');
    });

    it('steps one day back on a swipe right', async () => {
      const { container } = await renderTab();

      swipe(viewZone(container), 120);
      await act(async () => {});

      expect(screen.getByRole('button', { name: /Tuesday July 14/i }).getAttribute('aria-pressed')).toBe('true');
    });

    it('shifts the 3-day grid by exactly one column', async () => {
      window.localStorage.setItem(VIEW_STORAGE_KEY, 'threeDay');
      const { container } = await renderTab();
      expect(screen.getByTestId('three-day-column-2026-07-15')).toBeTruthy();

      swipe(viewZone(container), -120);
      await act(async () => {});

      // The leftmost column is the day that was second; two of the three days
      // stay on screen, so the reader keeps their anchor.
      expect(screen.getByTestId('three-day-column-2026-07-16')).toBeTruthy();
      expect(screen.getByTestId('three-day-column-2026-07-17')).toBeTruthy();
      expect(screen.queryByTestId('three-day-column-2026-07-15')).toBeNull();
    });

    it('ignores a vertical drag', async () => {
      const { container } = await renderTab();

      fireEvent.touchStart(viewZone(container), { touches: [{ clientX: 200, clientY: 400 }] });
      fireEvent.touchMove(viewZone(container), { touches: [{ clientX: 200, clientY: 300 }] });
      fireEvent.touchMove(viewZone(container), { touches: [{ clientX: 60, clientY: 300 }] });
      fireEvent.touchEnd(viewZone(container), { changedTouches: [{ clientX: 60, clientY: 300 }] });
      await act(async () => {});

      expect(screen.getByRole('button', { name: /Wednesday July 15/i }).getAttribute('aria-pressed')).toBe('true');
    });

    it('does not step a day when the swipe lands on the week strip', async () => {
      const { container } = await renderTab();

      swipe(container.querySelector('.mobile-week-strip'), -120);
      await act(async () => {});

      expect(screen.getByRole('button', { name: /Wednesday July 15/i }).getAttribute('aria-pressed')).toBe('true');
    });

    it('fetches the missing range when a swipe leaves the loaded window', async () => {
      const { container } = await renderTab();
      const callsBefore = globalThis.fetch.mock.calls.length;

      // The window runs Jul 12-25; eleven forward steps clear its end.
      for (let i = 0; i < 11; i++) {
        swipe(viewZone(container), -120);
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {});
      }

      // Same append the hook already performs for a strip tap — swipe is just
      // another writer of `selectedDate`. (Dedupe/append itself is covered by
      // useMobileEvents.test.jsx.)
      await waitFor(() => expect(globalThis.fetch.mock.calls.length).toBeGreaterThan(callsBefore));
      expect(screen.getByRole('button', { name: /Sunday July 26/i }).getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('agenda scroll drives the week strip', () => {
    beforeEach(() => {
      // Run the spy's rAF throttle inline.
      vi.stubGlobal('requestAnimationFrame', (cb) => { cb(); return 1; });
      vi.stubGlobal('cancelAnimationFrame', () => {});
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('highlights the day scrolled to the top, without moving the fetch window', async () => {
      const { container } = await renderTab();
      const scrollToSection = stubAgendaGeometry(container);
      const callsBefore = globalThis.fetch.mock.calls.length;
      const sectionsBefore = container.querySelectorAll('.mobile-agenda-day').length;

      // Section 5 of the Jul 12-25 window is Friday Jul 17.
      scrollToSection(5);
      await act(async () => {});

      expect(screen.getByRole('button', { name: /Friday July 17/i }).getAttribute('aria-pressed')).toBe('true');
      // Observation is not intent: same fetch window, same rendered days.
      expect(globalThis.fetch).toHaveBeenCalledTimes(callsBefore);
      expect(container.querySelectorAll('.mobile-agenda-day').length).toBe(sectionsBefore);
      expect(container.querySelector('.mobile-agenda-day-header').textContent).toMatch(/Sunday, Jul 12/);
    });

    it('advances the strip to the following week when scrolling crosses into it', async () => {
      const { container } = await renderTab();
      const scrollToSection = stubAgendaGeometry(container);

      // Section 7 is Sunday Jul 19 — the first day of the next week.
      scrollToSection(7);
      await act(async () => {});

      expect(screen.getByRole('button', { name: /Sunday July 19/i }).getAttribute('aria-pressed')).toBe('true');
      expect(screen.queryByRole('button', { name: /Sunday July 12/i })).toBeNull();
    });

    it('does not step the strip through days a tap scrolls past', async () => {
      const { container } = await renderTab();
      const scrollToSection = stubAgendaGeometry(container);

      // Tap Saturday Jul 18 — four sections below Jul 15.
      fireEvent.click(screen.getByRole('button', { name: /Saturday July 18/i }));
      await act(async () => {});

      // The smooth scroll's intervening frames must not drag the strip along.
      scrollToSection(4);
      scrollToSection(5);
      await act(async () => {});

      expect(screen.getByRole('button', { name: /Saturday July 18/i }).getAttribute('aria-pressed')).toBe('true');
    });
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
