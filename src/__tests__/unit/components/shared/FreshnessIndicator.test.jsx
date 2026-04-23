// src/__tests__/unit/components/shared/FreshnessIndicator.test.jsx

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Mock the SSE context so each test can pick the status to render.
const mockUseSSE = vi.fn();
vi.mock('../../../../context/SSEContext', () => ({
  useSSE: () => mockUseSSE(),
}));

import FreshnessIndicator from '../../../../components/shared/FreshnessIndicator';

function renderAt(sseStatus) {
  mockUseSSE.mockReturnValue({ isConnected: sseStatus === 'live', sseStatus });
  return render(
    <FreshnessIndicator
      lastFetchedAt={Date.now()}
      onRefresh={() => {}}
      isRefreshing={false}
    />
  );
}

describe('FreshnessIndicator — SSE status badge', () => {
  beforeEach(() => {
    cleanup();
    mockUseSSE.mockReset();
  });

  it('renders a "Live" badge when sseStatus is "live"', () => {
    renderAt('live');
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent(/Live/);
    expect(badge.className).toMatch(/freshness-status--live/);
  });

  it('renders a "Reconnecting" badge when sseStatus is "reconnecting"', () => {
    renderAt('reconnecting');
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent(/Reconnecting/);
    expect(badge.className).toMatch(/freshness-status--reconnecting/);
  });

  it('renders an "Offline" badge when sseStatus is "offline"', () => {
    renderAt('offline');
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent(/Offline/);
    expect(badge.className).toMatch(/freshness-status--offline/);
  });

  it('falls back to the offline visual when sseStatus is an unknown value', () => {
    renderAt('nonsense-value');
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent(/Offline/);
    expect(badge.className).toMatch(/freshness-status--offline/);
  });

  it('renders an accessible aria-label that includes the connection status', () => {
    renderAt('reconnecting');
    const badge = screen.getByRole('status');
    expect(badge.getAttribute('aria-label')).toMatch(/Reconnecting/);
  });

  it('does not render anything when lastFetchedAt is not provided', () => {
    mockUseSSE.mockReturnValue({ isConnected: true, sseStatus: 'live' });
    const { container } = render(<FreshnessIndicator lastFetchedAt={null} onRefresh={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('preserves the last-fetched relative-time text alongside the status badge', () => {
    renderAt('live');
    // Both the status label and the "Updated ..." text should be visible.
    expect(screen.getByRole('status')).toHaveTextContent(/Live/);
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });
});
