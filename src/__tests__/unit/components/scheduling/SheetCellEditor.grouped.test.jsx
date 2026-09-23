import React from 'react';
import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import SheetCellEditor from '../../../../components/scheduling/SheetCellEditor';

it('keeps later entries separate after adding a person in the expanded editor', () => {
  const onSave = vi.fn();
  render(<SheetCellEditor cell={null} people={[{ userId: 'u1', name: 'Stephen', email: 's@x.org' }]}
    locations={[]} onSave={onSave} onClose={vi.fn()} />);
  const input = screen.getByTestId('cell-editor-input');
  fireEvent.change(input, { target: { value: '@Stephen @615pm @Usher' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.queryByTestId('editor-group-target')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId('cell-editor-save'));
  expect(onSave.mock.calls[0][0].segments).toMatchObject([
    { type: 'person', name: 'Stephen' },
    { type: 'text', text: '6:15 PM' },
    { type: 'text', text: '@Usher' }
  ]);
  expect(onSave.mock.calls[0][0].segments[0].details).toBeUndefined();
});

it('edits an existing group without deleting its person or other details', () => {
  const onSave = vi.fn();
  const person = { type: 'person', userId: 'u1', name: 'Stephen', email: 's@x.org', details: [
    { type: 'text', text: 'Usher' }, { type: 'text', text: 'North door' }
  ] };
  render(<SheetCellEditor cell={{ segments: [person] }} people={[]} locations={[]} onSave={onSave} onClose={vi.fn()} />);
  const roster = screen.getByTestId('cell-chip-user');
  expect(within(roster).getByTestId('editor-roster-name')).toHaveTextContent('Stephen');
  expect(within(roster).getByTestId('editor-group-details')).toHaveTextContent('North door');
  expect(roster).not.toHaveTextContent('Details');
  const editDetails = screen.getByRole('button', { name: 'Edit details for Stephen' });
  editDetails.focus();
  fireEvent.click(editDetails);
  expect(screen.getByTestId('editor-group-target')).toHaveTextContent('Adding details to Stephen');
  expect(screen.getByTestId('cell-editor-input')).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Remove Usher' }));
  const input = screen.getByTestId('cell-editor-input');
  fireEvent.change(input, { target: { value: '@6pm' } });
  expect(screen.getByRole('button', { name: 'Add 6:00 PM to Stephen' })).toBeInTheDocument();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByTestId('editor-group-target')).toHaveTextContent('Adding details to Stephen');
  fireEvent.change(input, { target: { value: '@North entrance' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByTestId('editor-group-target')).toHaveTextContent('Adding details to Stephen');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.queryByTestId('editor-group-target')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId('cell-editor-save'));
  expect(onSave.mock.calls[0][0].segments).toMatchObject([
    { type: 'person', name: 'Stephen', details: [{ text: 'North door' }, { text: '6:00 PM' }, { text: 'North entrance' }] }
  ]);
});
