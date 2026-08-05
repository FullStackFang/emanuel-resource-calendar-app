// Chip capacity for the SeriesOccurrenceBand's one-row window
// (scheduling-assistant-series-mode, SOB-23): how many occurrence chips fit
// in one row of the measured width. Pure so the math is testable without
// layout; the band feeds it a ResizeObserver-measured width.

export const CHIP_WIDTH_PX = 35;
export const DENSE_CHIP_WIDTH_PX = 14;
export const CHIP_GAP_PX = 5;
export const ELLIPSIS_SLOTS = 2;
export const MIN_WINDOW = 3;
// Pre-measurement first paint + test environments (jsdom has no layout)
export const FALLBACK_CAPACITY = 12;

export function computeChipCapacity(rowWidth, dense) {
  if (!rowWidth || rowWidth <= 0) return FALLBACK_CAPACITY;
  const unit = (dense ? DENSE_CHIP_WIDTH_PX : CHIP_WIDTH_PX) + CHIP_GAP_PX;
  return Math.max(MIN_WINDOW + ELLIPSIS_SLOTS, Math.floor((rowWidth + CHIP_GAP_PX) / unit));
}
