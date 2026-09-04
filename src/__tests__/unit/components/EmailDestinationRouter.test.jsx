// EmailDestinationRouter.test.jsx
//
// The consumer half of the emailed-destination round trip: what happens after a
// recipient clicks "View My Assignments" in a schedule email.
//
// The scenarios that matter are the two arrival paths — a live session (the
// query string is still on the URL) and a sign-in bounce (MSAL returned to the
// origin bare, so only sessionStorage remembers) — plus the guarantees that one
// link is honored exactly once and that an untrusted value can never navigate.
//
// Test IDs: EDR-1 to EDR-9

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

import EmailDestinationRouter from '../../../components/EmailDestinationRouter';
import { EMAIL_DESTINATION_STORAGE_KEY } from '../../../utils/emailDestination';

// Stands in for the routed screens so the assertions read as "which screen did
// the recipient land on", not "what is the URL".
function Probe() {
  const location = useLocation();
  return <div data-testid="here">{location.pathname}</div>;
}

function renderAt(path, { apiToken = 'token' } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <EmailDestinationRouter apiToken={apiToken} />
      <Routes>
        <Route path="/" element={<Probe />} />
        <Route path="/my-assignments" element={<Probe />} />
        <Route path="/admin/scheduling-sheets" element={<Probe />} />
      </Routes>
    </MemoryRouter>
  );
}

const landedOn = () => screen.getByTestId('here').textContent;

describe('EmailDestinationRouter', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  // ── Arrival with a live session (spec: "Already-signed-in recipient") ──────

  it('EDR-1: routes to My Assignments straight from the URL', () => {
    renderAt('/?view=my-assignments');

    expect(landedOn()).toBe('/my-assignments');
  });

  it('EDR-2: leaves an ordinary visit alone', () => {
    renderAt('/');

    expect(landedOn()).toBe('/');
  });

  // ── Arrival after the MSAL bounce (spec: "Signed-out recipient") ───────────
  // MSAL returns to window.location.origin with the query string GONE, so the
  // only surviving record of where the recipient was headed is sessionStorage.

  it('EDR-3: routes from sessionStorage when the query string did not survive', () => {
    sessionStorage.setItem(EMAIL_DESTINATION_STORAGE_KEY, 'my-assignments');

    renderAt('/');

    expect(landedOn()).toBe('/my-assignments');
  });

  // The route is unguarded, so navigating before auth would render an empty
  // list — which reads as "you have no assignments", not "not signed in yet".
  it('EDR-4: waits for apiToken before routing, then routes once it arrives', () => {
    sessionStorage.setItem(EMAIL_DESTINATION_STORAGE_KEY, 'my-assignments');

    const { rerender } = render(
      <MemoryRouter initialEntries={['/']}>
        <EmailDestinationRouter apiToken={null} />
        <Routes>
          <Route path="/" element={<Probe />} />
          <Route path="/my-assignments" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    );
    expect(landedOn()).toBe('/');
    // The destination must still be waiting, not consumed by the early render.
    expect(sessionStorage.getItem(EMAIL_DESTINATION_STORAGE_KEY)).toBe('my-assignments');

    act(() => {
      rerender(
        <MemoryRouter initialEntries={['/']}>
          <EmailDestinationRouter apiToken="token" />
          <Routes>
            <Route path="/" element={<Probe />} />
            <Route path="/my-assignments" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      );
    });

    expect(landedOn()).toBe('/my-assignments');
  });

  // ── Consumed exactly once (spec: "A captured destination is consumed once") ─

  it('EDR-5: clears the stored destination once it is honored', () => {
    sessionStorage.setItem(EMAIL_DESTINATION_STORAGE_KEY, 'my-assignments');

    renderAt('/');

    expect(sessionStorage.getItem(EMAIL_DESTINATION_STORAGE_KEY)).toBeNull();
  });

  // A reload is a fresh mount with empty storage — the recipient must get the
  // normal default screen, not be dragged back to the emailed one.
  it('EDR-6: a later visit renders the default screen', () => {
    sessionStorage.setItem(EMAIL_DESTINATION_STORAGE_KEY, 'my-assignments');
    const first = renderAt('/');
    expect(landedOn()).toBe('/my-assignments');
    first.unmount();

    renderAt('/');

    expect(landedOn()).toBe('/');
  });

  // ── Untrusted input (spec: "Only known destinations are honored") ──────────

  it('EDR-7: ignores an unknown destination and clears it', () => {
    sessionStorage.setItem(EMAIL_DESTINATION_STORAGE_KEY, 'not-a-destination');

    renderAt('/');

    expect(landedOn()).toBe('/');
    expect(sessionStorage.getItem(EMAIL_DESTINATION_STORAGE_KEY)).toBeNull();
  });

  // The value comes from an email. Were it used as a route, '?view=' would be
  // an arbitrary-navigation primitive.
  it('EDR-8: never navigates to a path-like or absolute-URL value', () => {
    for (const value of ['/admin/scheduling-sheets', 'https://evil.example/phish', '//evil.example']) {
      sessionStorage.clear();
      const view = renderAt(`/?view=${encodeURIComponent(value)}`);

      expect(landedOn()).toBe('/');
      view.unmount();
    }
  });

  it('EDR-9: renders nothing', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/?view=my-assignments']}>
        <EmailDestinationRouter apiToken="token" />
      </MemoryRouter>
    );

    expect(container).toBeEmptyDOMElement();
  });
});
