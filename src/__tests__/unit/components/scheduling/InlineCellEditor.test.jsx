// InlineCellEditor.test.jsx
//
// Editing a scheduling sheet cell in place. The rule this suite exists to
// protect is the one the modal violated: NO exit path silently discards typed
// content. Enter, Tab and blur all commit whatever is in the box; Escape is the
// single deliberate discard, and it restores the snapshot taken when editing
// began.
//
// Test IDs: ICE-*

import React, { useRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, createEvent } from '@testing-library/react';

import InlineCellEditor from '../../../../components/scheduling/InlineCellEditor';

const PEOPLE = [
  { userId: 'u1', name: 'Sarah Levine', email: 'sarah@x.org' },
  { userId: 'u2', name: 'Sam Alto', email: 'sam@x.org' },
];
const LOCATIONS = [{ _id: 'l1', displayName: 'Wise Hall' }];

const PERSON_SEG = { type: 'person', userId: 'u1', name: 'Sarah Levine', email: 'sarah@x.org', placeholder: false, callTimeOverride: null };

/** Mounts the editor inside an anchor element, the way the grid cell does. */
function Harness({ cell, onCommit, onCancel, initialInput }) {
  const anchorRef = useRef(null);
  return (
    <div ref={anchorRef} data-testid="anchor">
      <InlineCellEditor
        cell={cell}
        people={PEOPLE}
        locations={LOCATIONS}
        anchorRef={anchorRef}
        initialInput={initialInput}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    </div>
  );
}

let onCommit, onCancel;
beforeEach(() => {
  onCommit = vi.fn();
  onCancel = vi.fn();
});

const open = (cell = { segments: [], note: null }, initialInput = '') => {
  render(<Harness cell={cell} onCommit={onCommit} onCancel={onCancel} initialInput={initialInput} />);
  return screen.getByTestId('inline-cell-input');
};

describe('InlineCellEditor — existing content', () => {
  it('ICE-1: existing segments render in their stored order', () => {
    open({ segments: [{ type: 'text', text: '6:00 PM' }, PERSON_SEG, { type: 'location', locationId: 'l1', name: 'Wise Hall' }], note: null });
    const editor = screen.getByTestId('inline-cell-editor');
    const chips = within(editor).getAllByTestId(/inline-chip-/);
    // Stored order is preserved: text, then the person, then the location.
    expect(chips.map((c) => c.dataset.testid)).toEqual([
      'inline-chip-text', 'inline-chip-user', 'inline-chip-location',
    ]);
    expect(chips[0]).toHaveTextContent('6:00 PM');
    expect(chips[1]).toHaveTextContent('Sarah Levine');
    expect(chips[2]).toHaveTextContent('Wise Hall');
  });

  it('ICE-2: any existing segment can be removed', () => {
    const input = open({ segments: [{ type: 'text', text: 'Ch. 4' }, PERSON_SEG], note: null });
    fireEvent.click(screen.getByLabelText('Remove Ch. 4'));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ segments: [PERSON_SEG] }), 'down');
  });

  it('ICE-23: removing a chip survives the blur-commit a real mouse click causes', () => {
    // fireEvent.click alone (ICE-2) never blurs the input, so it cannot see
    // this bug. A real browser runs mousedown -> blur -> click, and blur
    // commits and unmounts the editor: unless mousedown is defaultPrevented,
    // the click lands on a detached node and the chip is never removed.
    const input = open({ segments: [{ type: 'text', text: 'Ch. 4' }, PERSON_SEG], note: null });
    const remove = screen.getByLabelText('Remove Ch. 4');

    const mouseDown = createEvent.mouseDown(remove);
    fireEvent(remove, mouseDown);
    // The guard is the whole fix: focus must NOT leave the input.
    expect(mouseDown.defaultPrevented).toBe(true);
    if (!mouseDown.defaultPrevented) fireEvent.blur(input);
    fireEvent.click(remove);

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Remove Ch. 4')).not.toBeInTheDocument();

    // And the removal is what commits, rather than the pre-click snapshot.
    fireEvent.keyDown(screen.getByTestId('inline-cell-input'), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ segments: [PERSON_SEG] }), 'down');
  });

  it('ICE-3: the in-cell editor offers no note field — notes belong to the expanded editor', () => {
    open({ segments: [], note: { text: 'North door', authorName: null, at: '2027-01-01T00:00:00Z' } });
    expect(screen.queryByTestId('cell-note-input')).not.toBeInTheDocument();
    expect(screen.queryByText('+ Add note')).not.toBeInTheDocument();
  });

  it('ICE-4: the editor seeds itself with the character that started editing', () => {
    const input = open({ segments: [], note: null }, '6');
    expect(input).toHaveValue('6');
  });
});

describe('InlineCellEditor — adding chips from every suggestion kind', () => {
  it('ICE-5: @ adds a person chip and clears the typed trigger', () => {
    const input = open();
    fireEvent.change(input, { target: { value: '@sarah' } });
    fireEvent.click(within(screen.getByTestId('cell-suggestions')).getByText('Sarah Levine'));

    expect(input).toHaveValue('');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ segments: [PERSON_SEG] }), 'down');
  });

  it('ICE-6: @ also adds a location chip carrying the location id', () => {
    const input = open();
    fireEvent.change(input, { target: { value: '@wise' } });
    fireEvent.click(within(screen.getByTestId('cell-suggestions')).getByText(/Wise Hall/));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ segments: [{ type: 'location', locationId: 'l1', name: 'Wise Hall' }] }),
      'down'
    );
  });

  it('ICE-7: # narrows to locations only', () => {
    const input = open();
    fireEvent.change(input, { target: { value: '#wise' } });
    const list = screen.getByTestId('cell-suggestions');
    expect(within(list).queryByText('Sarah Levine')).not.toBeInTheDocument();
    expect(within(list).getByText(/Wise Hall/)).toBeInTheDocument();
  });

  it('ICE-8: @ followed by a time offers that time and adds it normalized', () => {
    const input = open();
    fireEvent.change(input, { target: { value: '@6pm' } });
    fireEvent.click(screen.getByTestId('cell-suggestions-time-row'));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ segments: [{ type: 'text', text: '6:00 PM' }] }),
      'down'
    );
  });

  it('ICE-9: an unmatched @term can be kept as an unassigned placeholder', () => {
    const input = open();
    fireEvent.change(input, { target: { value: '@usher_team' } });
    fireEvent.click(screen.getByText(/unassigned placeholder/i));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ segments: [expect.objectContaining({ placeholder: true, name: '@usher_team' })] }),
      'down'
    );
  });

  it('ICE-10: the not-a-user hatch adds an external person with name and email', () => {
    const input = open();
    fireEvent.change(input, { target: { value: '@Marcus' } });
    fireEvent.click(screen.getByText(/Not a user\? Add name/));

    const form = screen.getByTestId('cell-external-person-form');
    fireEvent.change(within(form).getByPlaceholderText('Full name'), { target: { value: 'Marcus Webb' } });
    fireEvent.change(within(form).getByPlaceholderText('Email (optional)'), { target: { value: 'marcus@abc.com' } });
    fireEvent.click(within(form).getByText('Add person'));

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: [expect.objectContaining({ userId: null, name: 'Marcus Webb', email: 'marcus@abc.com', placeholder: false })],
      }),
      'down'
    );
  });

  it('ICE-11: an unmatched # term falls back to a free-text segment', () => {
    const input = open();
    fireEvent.change(input, { target: { value: '#green room' } });
    fireEvent.click(screen.getByText(/as free text/));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ segments: [{ type: 'text', text: 'green room' }] }),
      'down'
    );
  });

  it('ICE-12: picking a suggestion by pointer wins the race against the blur commit', () => {
    // Mutation guard: drop the mousedown suppression in CellSuggestionList and
    // the browser blurs the input first, committing '@sarah' as raw text.
    const input = open();
    fireEvent.change(input, { target: { value: '@sarah' } });
    const row = within(screen.getByTestId('cell-suggestions')).getByText('Sarah Levine');

    const notPrevented = fireEvent.mouseDown(row);
    expect(notPrevented).toBe(false); // focus never leaves the input, so no blur fires
    fireEvent.click(row);
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ segments: [PERSON_SEG] }), 'down');
  });
});

describe('InlineCellEditor — commit and discard', () => {
  it('ICE-13: Enter commits the cell and asks to advance downward', () => {
    const input = open();
    fireEvent.change(input, { target: { value: 'Ch. 4 backup' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ segments: [{ type: 'text', text: 'Ch. 4 backup' }] }),
      'down'
    );
  });

  it('ICE-14: Tab commits the cell and asks to advance rightward', () => {
    const input = open();
    fireEvent.change(input, { target: { value: 'Ch. 4 backup' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ segments: [{ type: 'text', text: 'Ch. 4 backup' }] }),
      'right'
    );
  });

  it('ICE-24: Tab walks the suggestion rows instead of leaving the cell, and Enter takes the highlighted one', () => {
    const input = open();
    fireEvent.change(input, { target: { value: '@sa' } });
    // Both people match '@sa'; the first is highlighted for Enter from the start.
    const rows = () => screen.getAllByTestId('cell-suggestions').length && screen.getByTestId('cell-suggestions');
    expect(within(rows()).getByText('Sarah Levine').closest('button')).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'Tab' });
    expect(within(rows()).getByText('Sam Alto').closest('button')).toHaveAttribute('aria-selected', 'true');
    expect(onCommit).not.toHaveBeenCalled();  // Tab did NOT leave the cell

    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(screen.getByTestId('inline-cell-input'), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ segments: [expect.objectContaining({ name: 'Sam Alto' })] }),
      'down'
    );
  });

  it('ICE-25: Shift+Tab walks back, and the highlight wraps rather than stranding', () => {
    const input = open();
    fireEvent.change(input, { target: { value: '@sa' } });
    const list = () => screen.getByTestId('cell-suggestions');
    const selected = () => within(list()).getAllByRole('option').findIndex((b) => b.getAttribute('aria-selected') === 'true');
    const rowCount = () => within(list()).getAllByRole('option').length;

    expect(selected()).toBe(0);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(selected()).toBe(1);
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(selected()).toBe(0);
    // Back past the first row lands on the last, not on nothing.
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(selected()).toBe(rowCount() - 1);
  });

  it('ICE-26: Enter on a term that matched nobody still commits the term, rather than taking an escape hatch', () => {
    // The only rows left are the placeholder and add-an-outsider hatches, so
    // nothing starts highlighted — a mutation that highlights row 0
    // unconditionally turns every unmatched name into a form popup.
    const input = open();
    fireEvent.change(input, { target: { value: '@zzzz' } });
    const list = screen.getByTestId('cell-suggestions');
    expect(within(list).queryByRole('option', { selected: true })).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ segments: [{ type: 'text', text: '@zzzz' }] }),
      'down'
    );
  });

  it('ICE-27: Tab can still reach those escape hatches deliberately', () => {
    const input = open();
    fireEvent.change(input, { target: { value: '@zzzz' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    const first = within(screen.getByTestId('cell-suggestions')).getAllByRole('option')[0];
    expect(first).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(screen.getByTestId('inline-cell-input'), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ segments: [expect.objectContaining({ placeholder: true, name: '@zzzz' })] }),
      'down'
    );
  });

  it('ICE-15: moving focus away commits, so leaving a cell never discards typed content', () => {
    // Mutation guard: bind commit to Enter only and this fails.
    const input = open();
    fireEvent.change(input, { target: { value: '6pm' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ segments: [{ type: 'text', text: '6:00 PM' }] }),
      null
    );
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('ICE-16: text still in the input is included alongside committed chips', () => {
    const input = open();
    fireEvent.change(input, { target: { value: '@sarah' } });
    fireEvent.click(within(screen.getByTestId('cell-suggestions')).getByText('Sarah Levine'));
    fireEvent.change(input, { target: { value: 'north door' } });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ segments: [PERSON_SEG, { type: 'text', text: 'north door' }] }),
      null
    );
  });

  it('ICE-17: Escape discards and restores the pre-edit snapshot', () => {
    const input = open({ segments: [{ type: 'text', text: 'Ch. 4' }], note: null });
    fireEvent.click(screen.getByLabelText('Remove Ch. 4'));
    fireEvent.change(input, { target: { value: 'replacement' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    // The snapshot is restored, so a stray later blur cannot resurrect the edit.
    expect(screen.getByTestId('inline-cell-editor')).toHaveTextContent('Ch. 4');
    expect(input).toHaveValue('');
  });

  it('ICE-18: Escape then blur does not double back into a commit', () => {
    const input = open();
    fireEvent.change(input, { target: { value: 'scratch' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('ICE-19: an existing note is carried through an in-cell commit unchanged', () => {
    const note = { text: 'North door', authorName: 'M. Gold', at: '2027-08-29T00:00:00Z' };
    const input = open({ segments: [], note });
    fireEvent.change(input, { target: { value: '6pm' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith({ segments: [{ type: 'text', text: '6:00 PM' }], note }, 'down');
  });

  it('ICE-20: a cell with no note commits a null note rather than inventing one', () => {
    const input = open();
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit.mock.calls[0][0].note).toBeNull();
  });
});

describe('InlineCellEditor — time normalization', () => {
  it.each([['6pm'], ['6 PM'], ['6:00'], ['18:00'], ['1800']])(
    'ICE-21: %s commits in the sheet\'s one normalized format',
    (typed) => {
      const input = open();
      fireEvent.change(input, { target: { value: typed } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onCommit.mock.calls[0][0].segments[0].text).toBe('6:00 PM');
    }
  );

  it('ICE-22: text that is not a time commits exactly as typed', () => {
    const input = open();
    fireEvent.change(input, { target: { value: 'after kiddush' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit.mock.calls[0][0].segments[0]).toEqual({ type: 'text', text: 'after kiddush' });
  });
});
