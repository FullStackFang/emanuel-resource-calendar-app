import React from 'react';
import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SheetCellEditor from '../../../../components/scheduling/SheetCellEditor';

it('saves typed details under their person in the expanded editor', () => {
  const onSave = vi.fn();
  render(<SheetCellEditor cell={null} people={[{ userId: 'u1', name: 'Stephen', email: 's@x.org' }]}
    locations={[]} onSave={onSave} onClose={vi.fn()} />);
  const input = screen.getByTestId('cell-editor-input');
  fireEvent.change(input, { target: { value: '@Stephen @615pm @Usher' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByTestId('cell-chip-user')).toHaveTextContent('Usher');
  fireEvent.click(screen.getByTestId('cell-editor-save'));
  expect(onSave.mock.calls[0][0].segments).toMatchObject([
    { type: 'person', name: 'Stephen', details: [{ text: '6:15 PM' }, { text: 'Usher' }] }
  ]);
});
