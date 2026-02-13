// src/hooks/useScrollLock.js
import { useLayoutEffect } from 'react';

/**
 * Centralized scroll lock for modals.
 *
 * Uses useLayoutEffect (fires synchronously before paint) so the scrollbar
 * never flickers into view. Reference counting supports nested modals —
 * body scroll is only restored when every modal has unmounted/closed.
 *
 * Compensates for scrollbar width by adding equivalent padding-right so
 * content doesn't shift when the scrollbar disappears.
 */

let lockCount = 0;
let savedOverflow = '';
let savedPaddingRight = '';

function getScrollbarWidth() {
  return window.innerWidth - document.documentElement.clientWidth;
}

function lock() {
  lockCount++;
  if (lockCount === 1) {
    const scrollbarWidth = getScrollbarWidth();
    savedOverflow = document.body.style.overflow;
    savedPaddingRight = document.body.style.paddingRight;

    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      const current = parseInt(getComputedStyle(document.body).paddingRight, 10) || 0;
      document.body.style.paddingRight = `${current + scrollbarWidth}px`;
    }
  }
}

function unlock() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = savedOverflow;
    document.body.style.paddingRight = savedPaddingRight;
  }
}

export default function useScrollLock(isOpen) {
  useLayoutEffect(() => {
    if (isOpen) {
      lock();
      return () => unlock();
    }
  }, [isOpen]);
}
