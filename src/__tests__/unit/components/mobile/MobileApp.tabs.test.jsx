// src/__tests__/unit/components/mobile/MobileApp.tabs.test.jsx
//
// The phone shell has no route table — App.jsx renders <MobileApp /> INSTEAD
// of <Routes> — so until this change the URL was carried but never read. The
// schedule email's ?view=my-assignments handoff (EmailDestinationRouter)
// navigated to /my-assignments and a phone recipient still saw the calendar.
//
// This suite locks the tab bar as a projection of the pathname: the active
// tab derives from the URL and a tap navigates. That one rule is what makes
// an emailed link, a reload, and a desktop-shaped link all open the right tab.
//
// Test IDs: MAT-1 to MAT-6

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import MobileApp from '../../../../components/mobile/MobileApp';

vi.mock('../../../../hooks/usePwaInstall', () => ({
  usePwaInstall: () => ({ isAvailable: false, canPrompt: false, platform: 'manual', promptInstall: vi.fn() }),
}));
vi.mock('../../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ canApproveReservations: false }),
}));
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: 'test-token' }),
}));
vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({
    instance: { logoutRedirect: vi.fn() },
    accounts: [{ name: 'Rodney Rogers', username: 'RRogers@emanuelnyc.org' }],
  }),
}));

// The tab views pull in React Query, contexts and the event pipeline. Only
// WHICH one mounts matters here.
vi.mock('../../../../components/mobile/MobileCalendarTab', () => ({
  default: () => <div data-testid="calendar-tab" />,
}));
vi.mock('../../../../components/mobile/MobileRequests', () => ({
  default: () => <div data-testid="requests-tab" />,
}));
vi.mock('../../../../components/MyAssignments', () => ({
  default: () => <div data-testid="assignments-tab" />,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MobileApp />
      <LocationProbe />
    </MemoryRouter>
  );
}

const tab = (name) => screen.getByRole('button', { name });

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('MobileApp tab <-> path', () => {
  it('MAT-1: the root path opens the Calendar tab', () => {
    renderAt('/');

    expect(screen.getByTestId('calendar-tab')).toBeInTheDocument();
    expect(tab('Calendar')).toHaveAttribute('aria-current', 'page');
  });

  // The email deep link. EmailDestinationRouter resolves ?view=my-assignments
  // to this path; the phone shell must honour it exactly as the desktop route
  // table does.
  it('MAT-2: /my-assignments opens the Assignments tab', () => {
    renderAt('/my-assignments');

    expect(screen.getByTestId('assignments-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('calendar-tab')).not.toBeInTheDocument();
    expect(tab('Assignments')).toHaveAttribute('aria-current', 'page');
  });

  it('MAT-3: tapping Assignments mounts the view and moves the URL with it', () => {
    renderAt('/');

    fireEvent.click(tab('Assignments'));

    expect(screen.getByTestId('assignments-tab')).toBeInTheDocument();
    expect(screen.getByTestId('pathname')).toHaveTextContent('/my-assignments');
  });

  it('MAT-4: tapping Calendar from Assignments returns to the root path', () => {
    renderAt('/my-assignments');

    fireEvent.click(tab('Calendar'));

    expect(screen.getByTestId('calendar-tab')).toBeInTheDocument();
    expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/$/);
  });

  // The desktop URL for the same view. A phone user opening it should not be
  // silently bounced to the calendar.
  it('MAT-5: /my-reservations opens the Requests tab', () => {
    renderAt('/my-reservations');

    expect(screen.getByTestId('requests-tab')).toBeInTheDocument();
    expect(tab('Requests')).toHaveAttribute('aria-current', 'page');
  });

  // A desktop-only path (admin screens, booking form) has no phone tab. The
  // shell falls back to the calendar rather than rendering nothing.
  it('MAT-6: an unmapped path falls back to the Calendar tab', () => {
    renderAt('/admin/scheduling-sheets');

    expect(screen.getByTestId('calendar-tab')).toBeInTheDocument();
    expect(tab('Calendar')).toHaveAttribute('aria-current', 'page');
  });
});
