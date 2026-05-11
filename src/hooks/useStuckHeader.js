import { useEffect, useState } from 'react';

// Returns true when the referenced 1px sentinel scrolls out of view above
// its nearest scroll ancestor, indicating the sibling sticky header is "stuck."
// Pair with a `<div ref={sentinelRef} className="grid-header-sentinel" />`
// placed immediately before the sticky element.
export function useStuckHeader(sentinelRef) {
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsStuck(entry.intersectionRatio < 1),
      { threshold: [1], rootMargin: '-1px 0px 0px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [sentinelRef]);

  return isStuck;
}
