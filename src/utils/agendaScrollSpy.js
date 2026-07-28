/**
 * Which day section sits at the top of the agenda viewport.
 *
 * Pure so the whole decision is testable without a render. The alternative,
 * `IntersectionObserver`, is stubbed to a no-op in `src/test-setup.js` — its
 * callback never fires — so an observer-based spy could not be covered without
 * changing shared test infrastructure.
 *
 * @param {Array<{key: string, offsetTop: number}>} sections
 *        Day sections and their offsets from the top of the scrolled content.
 *        Order is not assumed.
 * @param {number} scrollTop  The list's current scroll position.
 * @returns {string|null} The section key, or null when there are no sections.
 */
export function dayAtScrollTop(sections, scrollTop) {
  if (!Array.isArray(sections) || sections.length === 0) return null;

  const ordered = [...sections].sort((a, b) => a.offsetTop - b.offsetTop);

  // Scrolled above the first section (rubber-banding, or a leading gap): the
  // first day is still what the reader is looking at.
  let current = ordered[0].key;
  for (const section of ordered) {
    if (section.offsetTop > scrollTop) break;
    current = section.key;
  }
  return current;
}

export default dayAtScrollTop;
