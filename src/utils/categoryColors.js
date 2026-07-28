// src/utils/categoryColors.js
/**
 * Outlook category color resolution, shared by any view that renders events in
 * their category color.
 *
 * The preset -> hex table is lifted verbatim from `Calendar.jsx`'s inline
 * `getCategoryColor`, which remains the desktop source of truth for now
 * (consolidating it is a follow-up). Only the presets the desktop actually maps
 * are listed: Outlook defines preset16-preset24 as well, but the desktop has
 * never mapped them and resolves them to the gray fallback — inventing hexes
 * here would make the two surfaces disagree about the same category.
 */

/** Outlook `preset*` identifiers to the hex the app paints them with. */
export const CATEGORY_PRESET_COLORS = {
  preset0: '#ff8c00',   // Orange
  preset1: '#e51400',   // Red
  preset2: '#60a917',   // Green
  preset3: '#f472d0',   // Pink
  preset4: '#00aba9',   // Teal
  preset5: '#008a00',   // Dark Green
  preset6: '#ba141a',   // Dark Red
  preset7: '#fa6800',   // Dark Orange
  preset8: '#1ba1e2',   // Blue
  preset9: '#0050ef',   // Dark Blue
  preset10: '#6a00ff',  // Purple
  preset11: '#aa00ff',  // Dark Purple
  preset12: '#825a2c',  // Brown
  preset13: '#6d8764',  // Olive
  preset14: '#647687',  // Steel
  preset15: '#76608a',  // Mauve
};

/** Genuinely uncategorized, or a preset the app does not map. */
export const DEFAULT_CATEGORY_COLOR = '#cccccc';

/**
 * Palette for categories that exist on events but are not registered as Outlook
 * categories. Same list, same order, same hash as `Calendar.jsx` — the two
 * surfaces MUST agree on the color for a given name, so do not "improve" either
 * copy in isolation.
 */
export const DYNAMIC_CATEGORY_COLORS = [
  '#FF6B6B', '#4ECDC4', '#556270', '#C7F464', '#FF8C94',
  '#9DE0AD', '#45ADA8', '#547980', '#594F4F', '#FE4365',
  '#83AF9B', '#FC9D9A', '#F18D9E', '#3A89C9', '#F9CDAD',
];

/**
 * Stable color for an unregistered category name.
 *
 * Why this exists rather than falling back to gray: in practice most event
 * categories are NOT registered Outlook categories, and the master list is
 * empty outright whenever Graph is unreachable. Returning gray in those cases
 * makes every event on the calendar the same color, which is worse than an
 * arbitrary-but-stable one.
 */
export function getDynamicCategoryColor(categoryName) {
  const hash = String(categoryName).split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  return DYNAMIC_CATEGORY_COLORS[Math.abs(hash) % DYNAMIC_CATEGORY_COLORS.length];
}

/** Treated as "no category" rather than as a category literally named this. */
const UNCATEGORIZED = 'Uncategorized';

/**
 * Build a resolver over a fetched Outlook category master list.
 *
 * Behavior-equivalent to `Calendar.jsx`'s `getCategoryColor`, deliberately:
 *   1. registered Outlook category -> its preset hex
 *   2. absent / 'Uncategorized'    -> gray
 *   3. anything else               -> a stable hashed color
 *
 * Total by construction, so an empty or failed categories query still yields a
 * fully colored calendar.
 *
 * @param {Array<{name: string, color: string}>} [outlookCategories]
 * @returns {(categoryName: string) => string} hex color
 */
export function buildCategoryColorResolver(outlookCategories) {
  const list = Array.isArray(outlookCategories) ? outlookCategories : [];
  const byName = new Map(
    list.filter(cat => cat && cat.name).map(cat => [cat.name, cat.color])
  );

  return function resolveCategoryColor(categoryName) {
    if (!categoryName || categoryName === UNCATEGORIZED) {
      return DEFAULT_CATEGORY_COLOR;
    }
    if (byName.has(categoryName)) {
      // Registered, but on a preset the app has never mapped: gray, matching
      // the desktop rather than hashing behind Outlook's back.
      return CATEGORY_PRESET_COLORS[byName.get(categoryName)] || DEFAULT_CATEGORY_COLOR;
    }
    return getDynamicCategoryColor(categoryName);
  };
}

export default buildCategoryColorResolver;
