// src/__tests__/unit/components/mobile/MobileBottomTabs.test.jsx
//
// The mobile tab set. Two invariants worth locking:
//   - No dead tabs. The Chat placeholder is retired and must not come back;
//     a visible tab that does nothing is what gets an app rejected under
//     Apple guideline 4.2.
//   - Tab ids are wire identifiers. `my-events` feeds ?view=my-events and
//     keys.events.list({ view: 'my-events' }); relabeling the tab to
//     "Requests" must not rename it.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import MobileBottomTabs from '../../../../components/mobile/MobileBottomTabs';

describe('MobileBottomTabs', () => {
  // MBT-1: the default bar for a user without approval rights — Calendar and
  // Requests, nothing else.
  it('MBT-1: renders exactly two tabs without canApproveReservations', () => {
    render(<MobileBottomTabs activeTab="calendar" onTabChange={vi.fn()} permissions={{ canApproveReservations: false }} />);

    const tabs = screen.getAllByRole('button');
    expect(tabs).toHaveLength(2);
    expect(screen.getByText('Calendar')).toBeInTheDocument();
    expect(screen.getByText('Requests')).toBeInTheDocument();
  });

  // MBT-2: the retired placeholder. Also covers the old label, so a partial
  // revert that restores "My Events" fails here.
  it('MBT-2: renders no Chat tab and no "My Events" label', () => {
    render(<MobileBottomTabs activeTab="calendar" onTabChange={vi.fn()} />);

    expect(screen.queryByText('Chat')).not.toBeInTheDocument();
    expect(screen.queryByText('My Events')).not.toBeInTheDocument();
  });

  // MBT-3: the label changed; the identifier did not. Renaming the id would
  // silently break ?view=my-events and every cache key derived from it.
  it('MBT-3: the Requests tab still reports the my-events identifier', () => {
    const onTabChange = vi.fn();
    render(<MobileBottomTabs activeTab="calendar" onTabChange={onTabChange} />);

    fireEvent.click(screen.getByText('Requests'));

    expect(onTabChange).toHaveBeenCalledWith('my-events');
  });

  // MBT-4: omitting the prop entirely must not crash or hide ungated tabs —
  // the agenda-only callers pass nothing.
  it('MBT-4: renders ungated tabs when no permissions prop is supplied', () => {
    render(<MobileBottomTabs activeTab="my-events" onTabChange={vi.fn()} />);

    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText('Requests').closest('button')).toHaveAttribute('aria-current', 'page');
  });
});
