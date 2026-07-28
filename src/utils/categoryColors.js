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

/** Uncategorized, unknown category, or unmapped preset. */
export const DEFAULT_CATEGORY_COLOR = '#cccccc';

/**
 * Build a resolver over a fetched Outlook category master list.
 *
 * Deliberately total: an empty or failed categories query (the hook falls back
 * to `[]` when Graph is down) yields a resolver that returns gray for
 * everything, so callers render fully — just uncolored.
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
    if (!categoryName) return DEFAULT_CATEGORY_COLOR;
    const preset = byName.get(categoryName);
    return CATEGORY_PRESET_COLORS[preset] || DEFAULT_CATEGORY_COLOR;
  };
}

export default buildCategoryColorResolver;
