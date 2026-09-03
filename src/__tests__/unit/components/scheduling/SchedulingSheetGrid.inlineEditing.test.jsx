// SchedulingSheetGrid.inlineEditing.test.jsx
//
// The grid half of in-cell editing: two distinct cell states (focused vs
// editing), spreadsheet keyboard semantics on top of them, the expand
// affordance that still reaches the full editor for notes, and the read-only
// gate — absent controls, not disabled ones, matching every other structural
// control in this grid.
//
// Test IDs: SSI-*

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import SchedulingSheetGrid from '../../../../components/scheduling/SchedulingSheetGrid';

// `?raw` yields an empty string for CSS under vitest's stylesheet handling, so
// the print rules are read straight off disk.
const sheetCss = readFileSync(
  resolve(process.cwd(), 'src/components/scheduling/SchedulingSheets.css'),
  'utf8'
);

const PEOPLE = [{ userId: 'u1', name: 'Sarah Levine', email: 'sarah@x.org' }];
const LOCATIONS = [{ _id: 'l1', displayName: 'Wise Hall' }];

// Rows in render order: rLoc, rCall, rDoors, rBegins, rEnds, then rUshers last.
// Columns in render order: c1, c2, c3.
function buildDay() {
  return {
    _id: 'd1',
    date: '2027-09-11',
    title: 'Erev RH',
    _version: 3,
    rows: [
      { id: 'rLoc', label: 'Location', kind: 'starter' },
      { id: 'rCall', label: 'Call Time', kind: 'starter' },
      { id: 'rDoors', label: 'Doors Open', kind: 'starter' },
      { id: 'rBegins', label: 'Begins', kind: 'starter' },
      { id: 'rEnds', label: 'Ends', kind: 'starter' },
      { id: 'rUshers', label: 'Ushers', kind: 'custom' },
    ],
    columns: [
      { id: 'c1', name: 'Erev Service', linkedEvent: null },
      { id: 'c2', name: 'YP Dinner', linkedEvent: null },
      { id: 'c3', name: 'Overflow', linkedEvent: null },
    ],
    cells: {
      'rUshers:c1': { segments: [{ type: 'text', text: 'Ch. 4' }], note: { text: 'North door', authorName: 'M. Gold', at: '2027-08-29T00:00:00Z' } },
    },
    taggedEmails: [],
    emailLog: [],
    emailStatus: [],
  };
}

let onCellSave, onStructure, onRefreshPeople;
beforeEach(() => {
  onCellSave = vi.fn();
  onStructure = vi.fn();
  onRefreshPeople = vi.fn();
});

const renderGrid = ({ canEdit = true, day = buildDay() } = {}) => {
  render(
    <SchedulingSheetGrid
      day={day}
      canEdit={canEdit}
      people={PEOPLE}
      locations={LOCATIONS}
      publishedEvents={[]}
      liveEventsById={new Map()}
      onCellSave={onCellSave}
      onStructure={onStructure}
      onRefreshPeople={onRefreshPeople}
    />
  );
  return day;
};

/** Click a cell, then Escape out of editing — leaving it focused, not editing. */
const focusCell = (key) => {
  fireEvent.click(screen.getByTestId(`cell-${key}`));
  fireEvent.keyDown(screen.getByTestId('inline-cell-input'), { key: 'Escape' });
};

describe('SchedulingSheetGrid — entering edit mode', () => {
  it('SSI-1: clicking an editable cell edits in place and opens no dialog over the sheet', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('cell-rCall:c1'));

    expect(within(screen.getByTestId('cell-rCall:c1')).getByTestId('inline-cell-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('sheet-cell-editor')).not.toBeInTheDocument();
    // The grid itself is still mounted and scrollable behind nothing.
    expect(screen.getByTestId('sheet-grid')).toBeInTheDocument();
  });

  it('SSI-2: opening a cell refreshes the people directory (stale-tab self-heal)', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('cell-rCall:c1'));
    expect(onRefreshPeople).toHaveBeenCalledTimes(1);
  });

  it('SSI-3: an existing cell opens with its stored segments loaded for editing', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('cell-rUshers:c1'));
    expect(screen.getByTestId('inline-cell-editor')).toHaveTextContent('Ch. 4');
  });

  it('SSI-4: typing on a focused cell promotes it to editing, seeded with the character typed', () => {
    renderGrid();
    focusCell('rCall:c1');
    fireEvent.keyDown(screen.getByTestId('cell-rCall:c1'), { key: '6' });
    expect(screen.getByTestId('inline-cell-input')).toHaveValue('6');
  });
});

describe('SchedulingSheetGrid — keyboard navigation', () => {
  it('SSI-5: Enter commits and advances to the cell below', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('cell-rCall:c1'));
    fireEvent.change(screen.getByTestId('inline-cell-input'), { target: { value: '5pm' } });
    fireEvent.keyDown(screen.getByTestId('inline-cell-input'), { key: 'Enter' });

    expect(onCellSave).toHaveBeenCalledWith('rCall', 'c1', expect.objectContaining({
      segments: [{ type: 'text', text: '5:00 PM' }],
    }));
    expect(screen.getByTestId('cell-rDoors:c1')).toHaveFocus();
    expect(screen.queryByTestId('inline-cell-editor')).not.toBeInTheDocument();
  });

  it('SSI-6: Enter in the last row commits without wrapping into another column', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('cell-rUshers:c1'));
    fireEvent.change(screen.getByTestId('inline-cell-input'), { target: { value: 'late' } });
    fireEvent.keyDown(screen.getByTestId('inline-cell-input'), { key: 'Enter' });

    expect(onCellSave).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('cell-rUshers:c1')).toHaveFocus();
  });

  it('SSI-7: Tab commits and advances to the cell on the right', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('cell-rCall:c1'));
    fireEvent.change(screen.getByTestId('inline-cell-input'), { target: { value: '5pm' } });
    fireEvent.keyDown(screen.getByTestId('inline-cell-input'), { key: 'Tab' });

    expect(onCellSave).toHaveBeenCalledWith('rCall', 'c1', expect.anything());
    expect(screen.getByTestId('cell-rCall:c2')).toHaveFocus();
  });

  it('SSI-8: Tab in the last column commits without wrapping to the next row', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('cell-rCall:c3'));
    fireEvent.change(screen.getByTestId('inline-cell-input'), { target: { value: '5pm' } });
    fireEvent.keyDown(screen.getByTestId('inline-cell-input'), { key: 'Tab' });
    expect(screen.getByTestId('cell-rCall:c3')).toHaveFocus();
  });

  it('SSI-9: arrow keys move the focused cell when nothing is being edited', () => {
    renderGrid();
    focusCell('rCall:c1');

    fireEvent.keyDown(screen.getByTestId('cell-rCall:c1'), { key: 'ArrowDown' });
    expect(screen.getByTestId('cell-rDoors:c1')).toHaveFocus();

    fireEvent.keyDown(screen.getByTestId('cell-rDoors:c1'), { key: 'ArrowRight' });
    expect(screen.getByTestId('cell-rDoors:c2')).toHaveFocus();

    fireEvent.keyDown(screen.getByTestId('cell-rDoors:c2'), { key: 'ArrowUp' });
    expect(screen.getByTestId('cell-rCall:c2')).toHaveFocus();

    fireEvent.keyDown(screen.getByTestId('cell-rCall:c2'), { key: 'ArrowLeft' });
    expect(screen.getByTestId('cell-rCall:c1')).toHaveFocus();

    expect(onCellSave).not.toHaveBeenCalled();
  });

  it('SSI-10: arrow keys at the grid edge keep focus where it is', () => {
    renderGrid();
    focusCell('rLoc:c1');
    fireEvent.keyDown(screen.getByTestId('cell-rLoc:c1'), { key: 'ArrowUp' });
    expect(screen.getByTestId('cell-rLoc:c1')).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId('cell-rLoc:c1'), { key: 'ArrowLeft' });
    expect(screen.getByTestId('cell-rLoc:c1')).toHaveFocus();
  });

  it('SSI-11: arrow keys inside a cell being edited stay in the cell — they move the caret, not the focus', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('cell-rCall:c1'));
    const input = screen.getByTestId('inline-cell-input');
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(screen.getByTestId('inline-cell-editor')).toBeInTheDocument();
    expect(within(screen.getByTestId('cell-rCall:c1')).getByTestId('inline-cell-input')).toBeInTheDocument();
    expect(screen.getByTestId('cell-rDoors:c1')).not.toHaveFocus();
  });

  it('SSI-12: Escape returns from editing to focused, without leaving the grid or saving', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('cell-rCall:c1'));
    fireEvent.change(screen.getByTestId('inline-cell-input'), { target: { value: 'scratch' } });
    fireEvent.keyDown(screen.getByTestId('inline-cell-input'), { key: 'Escape' });

    expect(onCellSave).not.toHaveBeenCalled();
    expect(screen.queryByTestId('inline-cell-editor')).not.toBeInTheDocument();
    expect(screen.getByTestId('cell-rCall:c1')).toHaveFocus();

    // Still focused means arrow navigation works straight away.
    fireEvent.keyDown(screen.getByTestId('cell-rCall:c1'), { key: 'ArrowDown' });
    expect(screen.getByTestId('cell-rDoors:c1')).toHaveFocus();
  });

  it('SSI-13: leaving a cell by clicking another one commits the first', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('cell-rCall:c1'));
    const input = screen.getByTestId('inline-cell-input');
    fireEvent.change(input, { target: { value: '5pm' } });
    fireEvent.blur(input);

    expect(onCellSave).toHaveBeenCalledWith('rCall', 'c1', expect.objectContaining({
      segments: [{ type: 'text', text: '5:00 PM' }],
    }));
  });

  it('SSI-26: a blur commit leaves focus where the user put it, instead of pulling it back', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('cell-rCall:c1'));
    expect(screen.getByTestId('inline-cell-input')).toHaveFocus();

    // A real click on another cell focuses that cell on mousedown, and THAT is
    // what blurs the editor. Pulling focus back here is not cosmetic: the grid
    // lives in a scrollport, so re-focusing a cell the user has scrolled away
    // from scrolls the sheet back between mousedown and mouseup. The content
    // moves out from under the pointer and the click on the new cell is never
    // dispatched at all.
    act(() => { screen.getByTestId('cell-rUshers:c2').focus(); });

    expect(onCellSave).toHaveBeenCalled();
    expect(screen.getByTestId('cell-rUshers:c2')).toHaveFocus();
  });
});

describe('SchedulingSheetGrid — the expanded editor', () => {
  it('SSI-14: the expand affordance opens the full editor with note editing available', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('cell-expand-rUshers:c1'));

    const dialog = screen.getByTestId('sheet-cell-editor');
    expect(dialog).toBeInTheDocument();
    // The note is the reason this surface still exists.
    expect(within(dialog).getByTestId('cell-note-input')).toHaveValue('North door');
  });

  it('SSI-15: saving from the expanded editor routes through the same cell save path', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('cell-expand-rCall:c2'));
    fireEvent.change(screen.getByTestId('cell-editor-input'), { target: { value: '5pm' } });
    fireEvent.click(screen.getByTestId('cell-editor-save'));

    expect(onCellSave).toHaveBeenCalledWith('rCall', 'c2', expect.objectContaining({
      segments: [{ type: 'text', text: '5:00 PM' }],
    }));
    expect(screen.queryByTestId('sheet-cell-editor')).not.toBeInTheDocument();
  });

  it('SSI-16: the expand affordance does not itself enter in-cell editing', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('cell-expand-rCall:c2'));
    expect(screen.queryByTestId('inline-cell-editor')).not.toBeInTheDocument();
  });
});

describe('SchedulingSheetGrid — read-only', () => {
  it('SSI-17: a read-only grid renders no in-cell editor, no suggestion list, and no expand affordance', () => {
    renderGrid({ canEdit: false });

    fireEvent.click(screen.getByTestId('cell-rCall:c1'));
    expect(screen.queryByTestId('inline-cell-editor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cell-suggestions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cell-expand-rUshers:c1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sheet-cell-editor')).not.toBeInTheDocument();
  });

  it('SSI-18: read-only cells are not keyboard-focusable editing targets and Enter or Tab saves nothing', () => {
    renderGrid({ canEdit: false });
    const cell = screen.getByTestId('cell-rCall:c1');
    expect(cell).not.toHaveAttribute('tabindex');

    fireEvent.keyDown(cell, { key: 'Enter' });
    fireEvent.keyDown(cell, { key: 'Tab' });
    fireEvent.keyDown(cell, { key: '6' });

    expect(onCellSave).not.toHaveBeenCalled();
    expect(screen.queryByTestId('inline-cell-editor')).not.toBeInTheDocument();
  });

  it('SSI-20: read-only cells never carry the focused or editing state classes', () => {
    renderGrid({ canEdit: false });
    const cell = screen.getByTestId('cell-rCall:c1');
    fireEvent.click(cell);
    expect(cell.className).not.toMatch(/ss-cell-(focused|editing)/);
  });

  it('SSI-19: read-only cells still show committed content and their note marker', () => {
    renderGrid({ canEdit: false });
    expect(screen.getByTestId('cell-rUshers:c1')).toHaveTextContent('Ch. 4');
    fireEvent.click(screen.getByTestId('note-marker-rUshers:c1'));
    expect(screen.getByTestId('note-popover-rUshers:c1')).toHaveTextContent('North door');
  });
});

describe('SchedulingSheetGrid — print output', () => {
  // jsdom cannot evaluate an @media print block, so the rules are asserted at
  // the source. The list is portaled outside .ss-sheet-card and would already
  // be hidden by `body * { visibility: hidden }`; the explicit display:none
  // makes that intentional rather than incidental.
  const printBlock = sheetCss.slice(sheetCss.indexOf('@media print'));

  // Every `display: none` declaration in the print block, reduced to the
  // selector lists that carry it.
  const hiddenSelectors = printBlock
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .filter((rule) => /display:\s*none/.test(rule))
    .map((rule) => rule.split('{')[0])
    .join(' ');

  it.each([
    ['the in-cell editor', '.ss-inline-cell-editor'],
    ['the expand affordance', '.ss-cell-expand'],
    ['the keyboard-shortcut hint', '.ss-corner-hint'],
    ['the suggestion list', '.ss-cell-suggestions'],
  ])('SSI-21: %s is excluded from the printed sheet', (_label, selector) => {
    expect(hiddenSelectors).toContain(selector);
  });

  it('SSI-23: the in-cell input opts out of the global input chrome', () => {
    // src/index.css styles EVERY input with a border, an 8px radius and a 3px
    // focus glow. At in-cell size that ring renders as an oval floating inside
    // the cell, overlapping the text. jsdom applies no stylesheets, so the
    // reset is asserted at the source.
    const rule = sheetCss.slice(
      sheetCss.indexOf('.ss-inline-cell-input {'),
      sheetCss.indexOf('.ss-cell-expand {')
    );
    expect(rule).toMatch(/border-radius:\s*0/);
    expect(rule).toMatch(/box-shadow:\s*none/);
    expect(rule).toMatch(/border:\s*none/);
    // ...and the :focus state must reset it too, or the glow returns on click.
    expect(rule.slice(rule.indexOf(':focus'))).toMatch(/box-shadow:\s*none/);
  });

  it('SSI-25: the label editors opt out of the global input chrome too', () => {
    // Same defect as SSI-23, two inputs further on: renaming a row or column
    // and the add-a-row box all sit INSIDE a grid label, where index.css's
    // border + 8px radius + 3px focus glow render as an oval in the cell.
    const rule = sheetCss.slice(
      sheetCss.indexOf('.ss-rename-input,'),
      sheetCss.indexOf('.ss-add-btn {')
    );
    expect(rule).toContain('.ss-add-row-input');
    expect(rule).toContain('border: none');
    expect(rule).toContain('border-radius: 0');
    expect(rule).toContain('box-shadow: none');
    // ...and the :focus state must reset the glow too, or it returns on click.
    expect(rule.slice(rule.indexOf(':focus'))).toContain('box-shadow: none');
  });

  it('SSI-24: the page is height-bounded, which is what lets the sticky header actually stick', () => {
    // The header row and the row-label column are both position: sticky, but
    // they stick inside .ss-grid-scroll — and a scrollport that never scrolls
    // never moves a sticky child. Signed in, .app-container carries only
    // min-height, so without this cap every box in the chain grows to fit the
    // whole table and the page scrolls instead. jsdom does no layout, so the
    // cap is asserted at the source, like the print rules above.
    const pageRule = sheetCss.slice(sheetCss.indexOf('.ss-page {'), sheetCss.indexOf('.ss-topbar {'));
    expect(pageRule).toContain('max-height: calc(100vh');
    expect(pageRule).toContain('min-height: 0');

    const headerRule = sheetCss.slice(sheetCss.indexOf('.ss-grid thead th {'));
    expect(headerRule.slice(0, headerRule.indexOf('}'))).toContain('position: sticky');
    const scrollRule = sheetCss.slice(sheetCss.indexOf('.ss-grid-scroll {'));
    expect(scrollRule.slice(0, scrollRule.indexOf('}'))).toContain('overflow-y: auto');
  });

  it('SSI-22: committed cell content is still printed', () => {
    expect(printBlock).not.toMatch(/\.ss-cell\s*,|\.ss-cell\s*\{[^}]*display:\s*none/);
    expect(printBlock).toContain('.ss-sheet-card, .ss-sheet-card * { visibility: visible; }');
  });
});
