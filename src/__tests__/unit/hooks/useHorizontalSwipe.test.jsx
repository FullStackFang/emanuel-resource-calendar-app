// src/__tests__/unit/hooks/useHorizontalSwipe.test.jsx
//
// Locks the gesture rules that keep a day-step swipe and the agenda's
// pull-to-refresh from ever firing on the same touch: the axis lock, its
// stickiness, and the distance threshold.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import {
  useHorizontalSwipe,
  AXIS_LOCK_TRAVEL,
  AXIS_RATIO,
  SWIPE_THRESHOLD,
} from '../../../hooks/useHorizontalSwipe';

let axisRef;

function Harness({ onSwipeLeft, onSwipeRight }) {
  const swipe = useHorizontalSwipe({ onSwipeLeft, onSwipeRight });
  axisRef = swipe.axisRef;
  return <div data-testid="zone" {...swipe.handlers} />;
}

/** One touch point at (x, y), in the shape a TouchEvent carries it. */
const at = (x, y) => [{ clientX: x, clientY: y }];

function setup() {
  const onSwipeLeft = vi.fn();
  const onSwipeRight = vi.fn();
  const { getByTestId } = render(
    <Harness onSwipeLeft={onSwipeLeft} onSwipeRight={onSwipeRight} />
  );
  return { zone: getByTestId('zone'), onSwipeLeft, onSwipeRight };
}

/** Drag from (0,0) through each waypoint, then lift. */
function drag(zone, waypoints) {
  fireEvent.touchStart(zone, { touches: at(0, 0) });
  waypoints.forEach(([x, y]) => fireEvent.touchMove(zone, { touches: at(x, y) }));
  fireEvent.touchEnd(zone, { changedTouches: at(...waypoints[waypoints.length - 1]) });
}

describe('useHorizontalSwipe', () => {
  beforeEach(() => {
    axisRef = null;
  });

  it('fires left when a horizontal gesture clears the threshold', () => {
    const { zone, onSwipeLeft, onSwipeRight } = setup();

    drag(zone, [[-20, 0], [-SWIPE_THRESHOLD, 0]]);

    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('fires right on the mirrored gesture', () => {
    const { zone, onSwipeLeft, onSwipeRight } = setup();

    drag(zone, [[20, 0], [SWIPE_THRESHOLD, 0]]);

    expect(onSwipeRight).toHaveBeenCalledTimes(1);
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('reports the locked axis while the gesture is in flight', () => {
    const { zone } = setup();

    fireEvent.touchStart(zone, { touches: at(0, 0) });
    expect(axisRef.current).toBeNull();

    // Under the lock travel: still undecided.
    fireEvent.touchMove(zone, { touches: at(AXIS_LOCK_TRAVEL - 2, 0) });
    expect(axisRef.current).toBeNull();

    fireEvent.touchMove(zone, { touches: at(40, 0) });
    expect(axisRef.current).toBe('x');
  });

  it('locks vertical and never steps a day, however far it then travels', () => {
    const { zone, onSwipeLeft, onSwipeRight } = setup();

    fireEvent.touchStart(zone, { touches: at(0, 0) });
    fireEvent.touchMove(zone, { touches: at(0, 40) });
    expect(axisRef.current).toBe('y');

    // A vertical-locked gesture that later runs far horizontally: the lock holds.
    fireEvent.touchMove(zone, { touches: at(-200, 40) });
    expect(axisRef.current).toBe('y');
    fireEvent.touchEnd(zone, { changedTouches: at(-200, 40) });

    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('ignores a diagonal that does not clear the axis ratio', () => {
    const { zone, onSwipeLeft } = setup();

    // |dx| = 100, |dy| = 80 -> 100 < 80 * 1.5, so this locks vertical.
    const dy = Math.ceil(100 / AXIS_RATIO) + 1;
    drag(zone, [[-100, dy]]);

    expect(axisRef.current).toBe('y');
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('does not fire an x-locked gesture that stops short of the threshold', () => {
    const { zone, onSwipeLeft, onSwipeRight } = setup();

    drag(zone, [[-(SWIPE_THRESHOLD - 1), 0]]);

    expect(axisRef.current).toBe('x');
    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('bails on multi-touch', () => {
    const { zone, onSwipeLeft } = setup();

    fireEvent.touchStart(zone, {
      touches: [{ clientX: 0, clientY: 0 }, { clientX: 50, clientY: 0 }],
    });
    fireEvent.touchMove(zone, { touches: at(-200, 0) });
    fireEvent.touchEnd(zone, { changedTouches: at(-200, 0) });

    expect(axisRef.current).toBeNull();
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('abandons a gesture that gains a second finger mid-drag', () => {
    const { zone, onSwipeLeft } = setup();

    fireEvent.touchStart(zone, { touches: at(0, 0) });
    fireEvent.touchMove(zone, { touches: at(-40, 0) });
    expect(axisRef.current).toBe('x');

    fireEvent.touchMove(zone, {
      touches: [{ clientX: -200, clientY: 0 }, { clientX: -100, clientY: 0 }],
    });
    fireEvent.touchEnd(zone, { changedTouches: at(-200, 0) });

    expect(axisRef.current).toBeNull();
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('resets the axis at the start of the next gesture, not at the end of one', () => {
    const { zone } = setup();

    drag(zone, [[-SWIPE_THRESHOLD, 0]]);
    // Still readable after the gesture: descendants' touchend handlers bubble
    // outward and run BEFORE this hook's.
    expect(axisRef.current).toBe('x');

    fireEvent.touchStart(zone, { touches: at(0, 0) });
    expect(axisRef.current).toBeNull();
  });

  it('does not fire on a lift with no intervening move', () => {
    const { zone, onSwipeLeft, onSwipeRight } = setup();

    fireEvent.touchStart(zone, { touches: at(0, 0) });
    fireEvent.touchEnd(zone, { changedTouches: at(0, 0) });

    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });
});
