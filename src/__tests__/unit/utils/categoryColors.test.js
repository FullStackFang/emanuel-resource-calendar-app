// src/__tests__/unit/utils/categoryColors.test.js
//
// Locks the shared Outlook category color resolver. The important guarantee is
// that the resolver is TOTAL — every input yields a paintable hex — because the
// mobile grid colors every block through it and the categories query falls back
// to [] whenever Graph is unreachable.

import { describe, it, expect } from 'vitest';
import {
  buildCategoryColorResolver,
  CATEGORY_PRESET_COLORS,
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

  it('falls back to gray for a category absent from the master list', () => {
    const resolve = buildCategoryColorResolver(CATEGORIES);
    expect(resolve('Not A Real Category')).toBe(DEFAULT_CATEGORY_COLOR);
  });

  it('falls back to gray for empty, null, and undefined category names', () => {
    const resolve = buildCategoryColorResolver(CATEGORIES);
    expect(resolve('')).toBe(DEFAULT_CATEGORY_COLOR);
    expect(resolve(null)).toBe(DEFAULT_CATEGORY_COLOR);
    expect(resolve(undefined)).toBe(DEFAULT_CATEGORY_COLOR);
  });

  it('falls back to gray for a preset the app does not map', () => {
    // Outlook exposes preset16-24; the app has never mapped them. Gray, not
    // undefined — a block with `undefined` for a color renders unstyled.
    const resolve = buildCategoryColorResolver(CATEGORIES);
    expect(resolve('Unmapped Preset')).toBe(DEFAULT_CATEGORY_COLOR);
    expect(resolve('No Color')).toBe(DEFAULT_CATEGORY_COLOR);
  });

  it('returns gray for everything when the category list is empty or missing', () => {
    // Graph down -> useOutlookCategoriesQuery resolves []. Everything must still
    // render, just uncolored.
    for (const input of [[], undefined, null, 'not-an-array']) {
      const resolve = buildCategoryColorResolver(input);
      expect(resolve('Worship')).toBe(DEFAULT_CATEGORY_COLOR);
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
