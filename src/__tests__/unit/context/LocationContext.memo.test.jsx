// src/__tests__/unit/context/LocationContext.memo.test.jsx
//
// Regression test for the LocationContext memoization fix. The fix wraps the
// context value object in `useMemo` so consumers do not re-render solely
// because the parent re-rendered (which previously created a fresh value
// literal, invalidating every consumer).
//
// We render a parent that holds unrelated state, attach a memoized consumer
// that counts its own renders, then trigger the parent to re-render. The
// consumer's render count MUST stay at the initial value.

import React, { useState, memo } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

// Mock the underlying data fetch with a STABLE return value. Returning a
// fresh object literal on each call would defeat the LocationProvider's
// downstream memoization — `data` identity would change every render and
// the context value would be invalidated even though nothing actually
// changed. The production hook (TanStack Query) returns stable references
// across renders when the data does not change, so the mock must mirror that.
//
// `vi.mock` is hoisted so the factory must construct its own stable value
// internally (cannot reference outer-scope consts that are declared below).
vi.mock('../../../hooks/useLocationsQuery', () => {
  const stableResult = {
    data: [
      { _id: 'loc-1', name: 'Main Sanctuary', isReservable: true },
      { _id: 'loc-2', name: 'Library', isReservable: false },
    ],
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
    dataUpdatedAt: 1700000000000,
  };
  return {
    useLocationsQuery: () => stableResult,
  };
});

vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { LocationProvider, useLocations } from '../../../context/LocationContext';

describe('LocationContext memoization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not re-render consumers when an unrelated parent re-renders', () => {
    const consumerRenderCount = { count: 0 };

    // Memoized consumer — only re-renders when its props/context change.
    const Consumer = memo(function Consumer() {
      consumerRenderCount.count += 1;
      const ctx = useLocations();
      return <div data-testid="consumer">locations: {ctx.locations.length}</div>;
    });

    // Parent that owns unrelated state and forces a re-render via a setter.
    let triggerParentRerender;
    function Parent() {
      const [unrelated, setUnrelated] = useState(0);
      triggerParentRerender = () => setUnrelated(n => n + 1);
      return (
        <LocationProvider apiToken="test-token">
          {/* unrelated value lives in parent's tree, NOT in context */}
          <span data-testid="unrelated">{unrelated}</span>
          <Consumer />
        </LocationProvider>
      );
    }

    render(<Parent />);

    const initialRenderCount = consumerRenderCount.count;
    expect(initialRenderCount).toBeGreaterThan(0);

    // Trigger an unrelated parent re-render.
    act(() => {
      triggerParentRerender();
    });

    // Consumer must NOT have re-rendered: the context value is the same
    // memoized object, and Consumer is memo'd, so React.memo bails out.
    expect(consumerRenderCount.count).toBe(initialRenderCount);

    // Multiple unrelated re-renders should still not cascade.
    act(() => {
      triggerParentRerender();
      triggerParentRerender();
      triggerParentRerender();
    });

    expect(consumerRenderCount.count).toBe(initialRenderCount);
  });
});
