// src/__tests__/unit/components/Navigation.calendarMarkers.test.jsx
//
// Locks the Holidays & Closures navigation IA for Events-department members vs
// admins — parallels Navigation.userManagement.test.jsx.
//
// Anyone whose department is "events" has canManageCalendarMarkers: true
// (role-independent — even a viewer). The nav must surface a TOP-LEVEL
// "Holidays & Closures" link for them; admins reach it inside the Admin
// dropdown. The whole-nav early return (which hides the nav for plain viewers)
// must NOT fire for an Events-dept viewer, or the link would never render.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let mockPermissions = {};
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => mockPermissions,
}));

vi.mock('../../../hooks/usePolling', () => ({ usePolling: vi.fn() }));
vi.mock('../../../hooks/useDataRefreshBus', () => ({ useDataRefreshBus: vi.fn() }));
vi.mock('../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => vi.fn(() => Promise.resolve({ ok: false })),
}));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: null }),
}));
vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

import Navigation from '../../../components/Navigation';

const baseViewer = {
  canViewCalendar: true,
  canSubmitReservation: false,
  canApproveReservations: false,
  canManageUsers: false,
  canManageCalendarMarkers: false,
  isAdmin: false,
};

function renderNav() {
  return render(
    <MemoryRouter>
      <Navigation />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockPermissions = { ...baseViewer };
});

describe('Navigation — Holidays & Closures IA', () => {
  it('events-dept viewer: shows a top-level Holidays & Closures link and no Admin dropdown', () => {
    mockPermissions = { ...baseViewer, canManageCalendarMarkers: true, department: 'events' };
    renderNav();

    // Accessible name now includes the department tag suffix, so match loosely.
    const link = screen.getByRole('link', { name: /Holidays & Closures/ });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/admin/calendar-markers');

    // The department tag explains WHY this non-admin sees an admin-area link.
    expect(screen.getByText('Events')).toBeInTheDocument();

    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('events-dept viewer: department tag is scoped to the top-level link only', () => {
    mockPermissions = { ...baseViewer, canManageCalendarMarkers: true, department: 'events' };
    renderNav();

    const tag = screen.getByText('Events');
    // The tag lives inside the Holidays & Closures link, not as a stray node.
    const link = screen.getByRole('link', { name: /Holidays & Closures/ });
    expect(link).toContainElement(tag);
  });

  it('admin: shows the link inside the Admin dropdown, no duplicate top-level link', () => {
    mockPermissions = {
      ...baseViewer,
      canSubmitReservation: true,
      canApproveReservations: true,
      canManageUsers: true,
      canManageCalendarMarkers: true,
      isAdmin: true,
    };
    renderNav();

    const adminToggle = screen.getByText('Admin');
    expect(adminToggle).toBeInTheDocument();

    expect(screen.queryByRole('link', { name: 'Holidays & Closures' })).not.toBeInTheDocument();

    fireEvent.click(adminToggle);
    const link = screen.getByRole('link', { name: 'Holidays & Closures' });
    expect(link.getAttribute('href')).toBe('/admin/calendar-markers');
  });

  it('plain viewer (no events dept): nav hidden entirely, no link', () => {
    mockPermissions = { ...baseViewer };
    const { container } = renderNav();
    expect(container.querySelector('nav')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Holidays & Closures' })).not.toBeInTheDocument();
  });
});
