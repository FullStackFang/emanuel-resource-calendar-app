import { useRef, useEffect, useMemo, useCallback } from 'react';

/** Travel, in px, before the gesture commits to an axis. */
export const AXIS_LOCK_TRAVEL = 10;
/** Horizontal travel must exceed vertical travel by this factor to lock `x`. */
export const AXIS_RATIO = 1.5;
/** Horizontal distance, in px, that a completed `x` gesture must cover to fire. */
export const SWIPE_THRESHOLD = 60;

/**
 * A one-axis touch gesture: horizontal swipes, with the locked axis exposed.
 *
 * The axis lock is the point of the hook, not the swipe. Anything else bound to
 * the same subtree — pull-to-refresh, in this app — reads `axisRef` and defers,
 * so one gesture can never drive two behaviors. Two independent handlers would
 * each be deciding on behalf of the other with no shared view of the gesture.
 *
 * Rules, in order:
 *  1. More than one touch point is a pinch, not a swipe. Bail for the gesture.
 *  2. Once travel passes `AXIS_LOCK_TRAVEL`, lock to `x` if `|dx| > |dy| *
 *     AXIS_RATIO`, else `y`. The lock holds for the rest of the gesture — a
 *     gesture that starts vertical can never become a day step.
 *  3. On end, fire only if the axis is `x` and `|dx| >= SWIPE_THRESHOLD`.
 *     Distance only, no velocity floor: a slow deliberate drag is a legitimate
 *     swipe on a list the user is already touching for other reasons.
 *
 * `axisRef` is deliberately NOT cleared on touch end — it is reset at the start
 * of the next gesture. React events bubble, so a descendant's `onTouchEnd` runs
 * before this hook's; clearing on end would hand that descendant a null axis.
 *
 * @param {() => void} onSwipeLeft   Fired on a leftward swipe (forward in time).
 * @param {() => void} onSwipeRight  Fired on a rightward swipe (backward).
 * @returns {{ handlers: object, axisRef: React.MutableRefObject<'x'|'y'|null> }}
 */
export function useHorizontalSwipe({ onSwipeLeft, onSwipeRight } = {}) {
  const axisRef = useRef(null);
  const startRef = useRef(null);
  const deltaRef = useRef({ dx: 0, dy: 0 });

  // Kept in a ref so `handlers` stays referentially stable regardless of
  // whether the caller memoized its callbacks.
  const callbacksRef = useRef({ onSwipeLeft, onSwipeRight });
  useEffect(() => {
    callbacksRef.current = { onSwipeLeft, onSwipeRight };
  }, [onSwipeLeft, onSwipeRight]);

  const onTouchStart = useCallback((e) => {
    axisRef.current = null;
    deltaRef.current = { dx: 0, dy: 0 };
    if (e.touches.length > 1) {
      startRef.current = null;
      return;
    }
    startRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);

  const onTouchMove = useCallback((e) => {
    if (!startRef.current) return;
    if (e.touches.length > 1) {
      // A second finger arrived mid-gesture; abandon it without an axis.
      startRef.current = null;
      axisRef.current = null;
      return;
    }
    const dx = e.touches[0].clientX - startRef.current.x;
    const dy = e.touches[0].clientY - startRef.current.y;
    deltaRef.current = { dx, dy };
    if (axisRef.current === null && Math.hypot(dx, dy) > AXIS_LOCK_TRAVEL) {
      axisRef.current = Math.abs(dx) > Math.abs(dy) * AXIS_RATIO ? 'x' : 'y';
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    const start = startRef.current;
    startRef.current = null;
    if (!start || axisRef.current !== 'x') return;
    const { dx } = deltaRef.current;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (dx < 0) callbacksRef.current.onSwipeLeft?.();
    else callbacksRef.current.onSwipeRight?.();
  }, []);

  const handlers = useMemo(
    () => ({ onTouchStart, onTouchMove, onTouchEnd }),
    [onTouchStart, onTouchMove, onTouchEnd]
  );

  return { handlers, axisRef };
}

export default useHorizontalSwipe;
