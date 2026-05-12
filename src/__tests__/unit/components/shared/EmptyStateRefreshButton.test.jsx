// src/__tests__/unit/components/shared/EmptyStateRefreshButton.test.jsx
//
// Defense-in-depth: every list empty state renders this button so users can
// recover from any blank state that slips past the documented isPending gate.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import EmptyStateRefreshButton from '../../../../components/shared/EmptyStateRefreshButton';

describe('EmptyStateRefreshButton', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders the default label "Refresh Data"', () => {
    render(<EmptyStateRefreshButton onClick={() => {}} />);
    expect(screen.getByRole('button')).toHaveTextContent(/Refresh Data/);
  });

  it('renders a custom label when provided', () => {
    render(<EmptyStateRefreshButton onClick={() => {}} label="Try again" />);
    expect(screen.getByRole('button')).toHaveTextContent(/Try again/);
  });

  it('exposes an accessible aria-label for assistive tech', () => {
    render(<EmptyStateRefreshButton onClick={() => {}} />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-label')).toMatch(/Refresh/);
  });

  it('calls onClick when clicked and not refreshing', () => {
    const handleClick = vi.fn();
    render(<EmptyStateRefreshButton onClick={handleClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled while isRefreshing is true', () => {
    const handleClick = vi.fn();
    render(<EmptyStateRefreshButton onClick={handleClick} isRefreshing={true} />);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    // Disabled button should not invoke onClick.
    fireEvent.click(btn);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('applies a refreshing class when isRefreshing is true so the icon can spin', () => {
    render(<EmptyStateRefreshButton onClick={() => {}} isRefreshing={true} />);
    expect(screen.getByRole('button').className).toMatch(/refreshing/);
  });

  it('does not apply the refreshing class when isRefreshing is false', () => {
    render(<EmptyStateRefreshButton onClick={() => {}} isRefreshing={false} />);
    expect(screen.getByRole('button').className).not.toMatch(/refreshing/);
  });
});
