import { useLayoutEffect, useState } from 'react';

// Tracks the original header's viewport rect (left + width) AND the visual
// pixel width of its `.category-header` cell. Both are needed because the
// floating clone is portal-rendered to document.body — escaping any ancestor
// `zoom`/`transform` AND the CSS variable scope of `.calendar-container`.
// Pass the returned `categoryWidth` back via inline `--calendar-category-column-width`
// on the clone so its first cell matches the original's visual width exactly.
export function useFloatingHeaderRect(ref, enabled) {
  const [data, setData] = useState(null);

  useLayoutEffect(() => {
    if (!enabled) {
      setData(null);
      return;
    }
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const update = () => {
      const r = el.getBoundingClientRect();
      const categoryCell = el.querySelector('.category-header');
      const cw = categoryCell ? categoryCell.getBoundingClientRect().width : null;
      setData({ left: r.left, width: r.width, categoryWidth: cw });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [ref, enabled]);

  return data;
}
