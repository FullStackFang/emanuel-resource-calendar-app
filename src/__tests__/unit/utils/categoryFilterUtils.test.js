import { describe, it, expect } from 'vitest';
import { selectedNamesToCategoryIds } from '../../../utils/categoryFilterUtils';

describe('selectedNamesToCategoryIds', () => {
  const base = [{ _id: 'a1', name: 'Skirball' }, { _id: 'b2', name: 'Adult Ed' }];
  it('maps names case-insensitively to id strings', () => {
    expect(selectedNamesToCategoryIds(['skirball ', 'Adult Ed'], base)).toEqual(['a1', 'b2']);
  });
  it('omits Uncategorized and unregistered names', () => {
    expect(selectedNamesToCategoryIds(['Uncategorized', 'Unknown'], base)).toEqual([]);
  });
  it('handles empty / nullish inputs', () => {
    expect(selectedNamesToCategoryIds([], base)).toEqual([]);
    expect(selectedNamesToCategoryIds(null, base)).toEqual([]);
    expect(selectedNamesToCategoryIds(['Skirball'], null)).toEqual([]);
  });
});
