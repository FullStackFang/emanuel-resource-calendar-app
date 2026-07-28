// src/__tests__/unit/utils/categoryColors.test.js
//
// Locks the shared Outlook category color resolver. The important guarantee is
// that the resolver is TOTAL — every input yields a paintable hex — because the
// mobile grid colors every block through it and the categories query falls back
// to [] whenever Graph is unreachable.

import { describe, it, expect } from 'vitest';
import {
  buildCategoryColorResolver,
  getDynamicCategoryColor,
  CATEGORY_PRESET_COLORS,
  DYNAMIC_CATEGORY_COLORS,
  DEFAULT_CATEGORY_COLOR,
} from '../../../utils/categoryColors';

const CATEGORIES = [
  { name: 'Worship', color: 'preset8' },
  { name: 'Education', color: 'preset2' },
  { name: 'Unmapped Preset', color: 'preset20' },
  { name: 'No Color', color: null },
];

describe('buildCategoryColorResolver', () => {
  it('resolves a known category to its preset hex', () => {
    const resolve = buildCategoryColorResolver(CATEGORIES);
    expect(resolve('Worship')).toBe('#1ba1e2');
    expect(resolve('Education')).toBe('#60a917');
  });

  it('hashes a category absent from the master list to a stable color', () => {
    // NOT gray. Most real event categories are unregistered, so graying them
    // renders the whole calendar in one color — the bug this branch fixes.
    const resolve = buildCategoryColorResolver(CATEGORIES);
    const color = resolve('Not A Real Category');

    expect(color).not.toBe(DEFAULT_CATEGORY_COLOR);
    expect(DYNAMIC_CATEGORY_COLORS).toContain(color);
    expect(resolve('Not A Real Category')).toBe(color); // stable across calls
  });

  it('gives different unregistered categories different colors', () => {
    const resolve = buildCategoryColorResolver([]);
    const colors = new Set(
      ['Worship', 'Education', 'Meeting', 'Facilities', 'Youth'].map(resolve)
    );
    expect(colors.size).toBeGreaterThan(1);
  });

  it('falls back to gray for empty, null, undefined, and Uncategorized', () => {
    const resolve = buildCategoryColorResolver(CATEGORIES);
    expect(resolve('')).toBe(DEFAULT_CATEGORY_COLOR);
    expect(resolve(null)).toBe(DEFAULT_CATEGORY_COLOR);
    expect(resolve(undefined)).toBe(DEFAULT_CATEGORY_COLOR);
    // The literal placeholder getEventCategories emits, not a real category.
    expect(resolve('Uncategorized')).toBe(DEFAULT_CATEGORY_COLOR);
  });

  it('matches the desktop hash exactly', () => {
    // Calendar.jsx getDynamicCategoryColor, copied verbatim. If this drifts,
    // the same category renders in two different colors on the two surfaces.
    const desktop = (categoryName) => {
      const hash = categoryName.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
      }, 0);
      const colors = [
        '#FF6B6B', '#4ECDC4', '#556270', '#C7F464', '#FF8C94',
        '#9DE0AD', '#45ADA8', '#547980', '#594F4F', '#FE4365',
        '#83AF9B', '#FC9D9A', '#F18D9E', '#3A89C9', '#F9CDAD',
      ];
      return colors[Math.abs(hash) % colors.length];
    };

    for (const name of ['Worship', 'Adult Education', 'B Mitzvah', 'Facilities', 'x']) {
      expect(getDynamicCategoryColor(name)).toBe(desktop(name));
    }
  });

  it('falls back to gray for a REGISTERED category on a preset the app does not map', () => {
    // Outlook exposes preset16-24; the app has never mapped them. Gray rather
    // than hashing — the category IS registered, so we defer to Outlook and
    // show no opinion, exactly as the desktop does.
    const resolve = buildCategoryColorResolver(CATEGORIES);
    expect(resolve('Unmapped Preset')).toBe(DEFAULT_CATEGORY_COLOR);
    expect(resolve('No Color')).toBe(DEFAULT_CATEGORY_COLOR);
  });

  it('stays colorful when the category list is empty or missing', () => {
    // Graph down -> useOutlookCategoriesQuery resolves []. The calendar must
    // degrade to hashed colors, NOT to a wall of gray.
    for (const input of [[], undefined, null, 'not-an-array']) {
      const resolve = buildCategoryColorResolver(input);
      const color = resolve('Worship');
      expect(color).not.toBe(DEFAULT_CATEGORY_COLOR);
      expect(color).toBe(getDynamicCategoryColor('Worship'));
    }
  });

  it('tolerates malformed entries in the master list', () => {
    const resolve = buildCategoryColorResolver([
      null,
      { color: 'preset1' }, // no name
      { name: 'Good', color: 'preset1' },
    ]);
    expect(resolve('Good')).toBe('#e51400');
  });

  it('exposes the preset table the desktop calendar uses', () => {
    expect(CATEGORY_PRESET_COLORS.preset0).toBe('#ff8c00');
    expect(CATEGORY_PRESET_COLORS.preset15).toBe('#76608a');
    expect(Object.keys(CATEGORY_PRESET_COLORS)).toHaveLength(16);
  });
});
