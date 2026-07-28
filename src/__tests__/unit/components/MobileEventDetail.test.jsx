// src/__tests__/unit/components/MobileEventDetail.test.jsx
//
// Locks the read-only floor-plan surface in the mobile detail sheet:
//  - a "Floor Plan" field renders (only) when the event has a floor plan image
//  - tapping the thumbnail opens a fullscreen lightbox; close/zoom behave
//
// useFloorPlan is mocked (its fetch/blob path is covered by useFloorPlan.test.js)
// so these tests focus purely on the component's rendering + lightbox logic.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { __resetBackDismissForTests } from '../../../hooks/useBackDismiss';

vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: 'tok' }),
}));
vi.mock('../../../hooks/useScrollLock', () => ({ default: vi.fn() }));

// The sheet gained a withdraw action (Requests tab), which pulls in MSAL for
// the requester check, authFetch for the DELETE, and toasts for the outcome.
// None of it engages here — these cases pass no showReservationContext — but
// the hooks still run, so they need providers or stubs. The withdraw behaviour
// itself is covered by mobile/MobileEventDetail.withdraw.test.jsx.
vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({ accounts: [] }),
}));
vi.mock('../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => vi.fn(),
}));
vi.mock('../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() }),
}));
vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), log: vi.fn() },
}));

let mockFloorPlan;
vi.mock('../../../hooks/useFloorPlan', () => ({
  default: () => mockFloorPlan,
}));

import MobileEventDetail from '../../../components/mobile/MobileEventDetail';

const baseEvent = {
  eventId: 'evt-1',
  eventTitle: 'Spring Gala',
  status: 'published',
  startDate: '2026-05-01',
};

/** Presses the device Back button. */
function pressBack() {
  fireEvent.popState(window, { state: window.history.state });
}

/**
 * Resolves once the next popstate lands. Register BEFORE the action that
 * triggers it — jsdom's history traversal is asynchronous and takes longer than
 * a single macrotask, so awaiting a bare setTimeout(0) races it.
 */
function nextPopState() {
  return new Promise((resolve) => {
    window.addEventListener('popstate', resolve, { once: true });
  });
}

// useBackDismiss keeps module-level bookkeeping and retires its history marker
// asynchronously, so give every case a clean slate and let stray traversals
// from the previous one land before the next begins.
beforeEach(() => {
  __resetBackDismissForTests();
});
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
});

describe('MobileEventDetail — floor plan', () => {
  beforeEach(() => {
    mockFloorPlan = { floorPlanUrl: null, fileName: '' };
  });

  it('renders a Floor Plan field with the image when a plan exists', () => {
    mockFloorPlan = { floorPlanUrl: 'blob:plan', fileName: 'social-hall.png' };

    render(<MobileEventDetail event={baseEvent} onClose={() => {}} />);

    expect(screen.getByText('Floor Plan')).toBeTruthy();
    const img = screen.getByRole('img', { name: /floor plan/i });
    expect(img.getAttribute('src')).toBe('blob:plan');
  });

  it('does not render a Floor Plan field when there is no plan', () => {
    mockFloorPlan = { floorPlanUrl: null, fileName: '' };

    render(<MobileEventDetail event={baseEvent} onClose={() => {}} />);

    expect(screen.queryByText('Floor Plan')).toBeNull();
    expect(screen.queryByRole('button', { name: /view floor plan/i })).toBeNull();
  });

  it('opens the fullscreen lightbox when the thumbnail is tapped', () => {
    mockFloorPlan = { floorPlanUrl: 'blob:plan', fileName: 'social-hall.png' };

    render(<MobileEventDetail event={baseEvent} onClose={() => {}} />);

    expect(screen.queryByRole('dialog', { name: /floor plan/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /view floor plan/i }));
    expect(screen.getByRole('dialog', { name: /floor plan/i })).toBeTruthy();
  });

  it('closes the lightbox via the close button', () => {
    mockFloorPlan = { floorPlanUrl: 'blob:plan', fileName: 'social-hall.png' };

    render(<MobileEventDetail event={baseEvent} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /view floor plan/i }));
    fireEvent.click(screen.getByRole('button', { name: /close floor plan/i }));
    expect(screen.queryByRole('dialog', { name: /floor plan/i })).toBeNull();
  });

  it('closes the lightbox when the backdrop outside the image is tapped', () => {
    mockFloorPlan = { floorPlanUrl: 'blob:plan', fileName: 'social-hall.png' };

    render(<MobileEventDetail event={baseEvent} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /view floor plan/i }));
    fireEvent.click(screen.getByRole('dialog', { name: /floor plan/i }));
    expect(screen.queryByRole('dialog', { name: /floor plan/i })).toBeNull();
  });

  it('toggles zoom when the lightbox image is tapped (and stays open)', () => {
    mockFloorPlan = { floorPlanUrl: 'blob:plan', fileName: 'social-hall.png' };

    const { container } = render(<MobileEventDetail event={baseEvent} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /view floor plan/i }));
    const dialog = screen.getByRole('dialog', { name: /floor plan/i });
    const stage = container.querySelector('.mobile-detail-lightbox-stage');
    expect(stage.classList.contains('zoomed')).toBe(false);

    fireEvent.click(within(dialog).getByRole('img', { name: /floor plan/i }));
    expect(stage.classList.contains('zoomed')).toBe(true);
    // tapping the image must not close the lightbox
    expect(screen.getByRole('dialog', { name: /floor plan/i })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('img', { name: /floor plan/i }));
    expect(stage.classList.contains('zoomed')).toBe(false);
  });

  it('closes the lightbox on Escape', () => {
    mockFloorPlan = { floorPlanUrl: 'blob:plan', fileName: 'social-hall.png' };

    render(<MobileEventDetail event={baseEvent} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /view floor plan/i }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /floor plan/i })).toBeNull();
  });
});

// The mobile shell renders no routes, so without this the device Back button
// leaves the app instead of backing out of the event — and in the installed PWA
// it is the only back affordance there is.
describe('MobileEventDetail — device Back button', () => {
  beforeEach(() => {
    mockFloorPlan = { floorPlanUrl: null, fileName: '' };
  });

  it('closes the sheet when Back is pressed', () => {
    const onClose = vi.fn();

    render(<MobileEventDetail event={baseEvent} onClose={onClose} />);
    pressBack();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not hijack Back while the sheet is closed', () => {
    const onClose = vi.fn();

    render(<MobileEventDetail event={null} onClose={onClose} />);
    pressBack();

    expect(onClose).not.toHaveBeenCalled();
  });

  it('backs out of the lightbox first, leaving the sheet open', () => {
    mockFloorPlan = { floorPlanUrl: 'blob:plan', fileName: 'social-hall.png' };
    const onClose = vi.fn();

    render(<MobileEventDetail event={baseEvent} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /view floor plan/i }));

    pressBack();

    expect(screen.queryByRole('dialog', { name: /floor plan/i })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes the sheet on the next Back after the lightbox is dismissed', () => {
    mockFloorPlan = { floorPlanUrl: 'blob:plan', fileName: 'social-hall.png' };
    const onClose = vi.fn();

    render(<MobileEventDetail event={baseEvent} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /view floor plan/i }));

    pressBack();
    pressBack();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves Back working after the lightbox is closed by its own button', async () => {
    mockFloorPlan = { floorPlanUrl: 'blob:plan', fileName: 'social-hall.png' };
    const onClose = vi.fn();

    render(<MobileEventDetail event={baseEvent} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /view floor plan/i }));

    // Closing the lightbox retires its own marker; that must not spill over and
    // close the sheet underneath, nor swallow the user's next Back press.
    const retired = nextPopState();
    fireEvent.click(screen.getByRole('button', { name: /close floor plan/i }));
    await retired;
    expect(onClose).not.toHaveBeenCalled();

    pressBack();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
