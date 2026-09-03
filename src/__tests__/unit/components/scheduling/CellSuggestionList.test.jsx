// CellSuggestionList.test.jsx
//
// The cell-anchored suggestion surface. Two structural facts drive every test
// here: `.ss-grid-scroll` clips anything rendered inside a cell, and the grid's
// sticky header row and label column sit at z-indexes 2-4 — so the list has to
// live in a portal at document.body with fixed positioning. The second fact is
// event ordering: a pointer press inside the list must be suppressed, or the
// input's blur commits the raw typed term before the click ever lands.
//
// Test IDs: CSL-*

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import CellSuggestionList from '../../../../components/scheduling/CellSuggestionList';

const PEOPLE = [
  { userId: 'u1', name: 'Sarah Levine', email: 'sarah@x.org' },
  { userId: 'u2', name: 'Sam Alto', email: 'sam@x.org' },
];

const LOCATIONS = [{ _id: 'l1', displayName: 'Wise Hall' }];

/** A picker result shaped like useMentionPicker's, overridable per test. */
const pickerOf = (over = {}) => ({
  mode: 'mention',
  term: 'sa',
  personMatches: PEOPLE,
  personOverflow: 0,
  locationMatches: [],
  locationOverflow: 0,
  timePreview: null,
  mentionTime: null,
  pendingSegment: () => null,
  ...over,
});

/**
 * An anchor with a real rect. jsdom reports every rect as zero, so the flip
 * and follow behavior is only observable if the anchor is stubbed.
 */
function anchorAt({ top = 100, height = 30, left = 50, width = 160 } = {}) {
  const el = document.createElement('td');
  el.getBoundingClientRect = () => ({
    top, left, width, height, bottom: top + height, right: left + width, x: left, y: top,
  });
  document.body.appendChild(el);
  return { current: el };
}

const renderList = (props = {}) => {
  const handlers = {
    onPickPerson: vi.fn(),
    onPickLocation: vi.fn(),
    onPickTime: vi.fn(),
    onAddPlaceholder: vi.fn(),
    onUseAsText: vi.fn(),
    onStartExternal: vi.fn(),
    onChangeExternal: vi.fn(),
    onAddExternal: vi.fn(),
    onCancelExternal: vi.fn(),
  };
  const anchorRef = props.anchorRef || anchorAt();
  render(
    <CellSuggestionList
      anchorRef={anchorRef}
      picker={pickerOf(props.picker)}
      externalDraft={props.externalDraft ?? null}
      {...handlers}
      {...(props.overrides || {})}
    />
  );
  return { ...handlers, anchorRef };
};

beforeEach(() => {
  window.innerHeight = 800;
});
afterEach(() => {
  document.body.querySelectorAll('td').forEach((el) => el.remove());
});

describe('CellSuggestionList — entries', () => {
  it('CSL-1: person entries render and picking one reports the person', () => {
    const { onPickPerson } = renderList();
    const list = screen.getByTestId('cell-suggestions');
    fireEvent.click(within(list).getByText('Sarah Levine'));
    expect(onPickPerson).toHaveBeenCalledWith(PEOPLE[0]);
  });

  it('CSL-2: locations render as their own group under @', () => {
    const { onPickLocation } = renderList({ picker: { locationMatches: LOCATIONS } });
    const list = screen.getByTestId('cell-suggestions');
    expect(within(list).getByTestId('cell-suggestions-locations-group')).toHaveTextContent(/locations/i);
    fireEvent.click(within(list).getByText(/Wise Hall/));
    expect(onPickLocation).toHaveBeenCalledWith(LOCATIONS[0]);
  });

  it('CSL-3: a term that reads as a time is offered as a selectable entry', () => {
    const time = { value: '18:00', display: '6:00 PM' };
    const { onPickTime } = renderList({ picker: { term: '6pm', mentionTime: time, personMatches: [] } });
    const row = screen.getByTestId('cell-suggestions-time-row');
    expect(row).toHaveTextContent('6:00 PM');
    fireEvent.click(row);
    expect(onPickTime).toHaveBeenCalledWith(time);
  });

  it('CSL-4: the overflow count is honest rather than a silent truncation', () => {
    renderList({ picker: { personOverflow: 3 } });
    expect(screen.getByText(/3 more matches\. Keep typing/)).toBeInTheDocument();
    renderList({ picker: { personOverflow: 1 } });
    expect(screen.getByText(/1 more match\. Keep typing/)).toBeInTheDocument();
  });
});

describe('CellSuggestionList — escape hatches', () => {
  it('CSL-5: an unmatched @term can be kept as an unassigned placeholder', () => {
    const { onAddPlaceholder } = renderList({ picker: { term: 'usher_team', personMatches: [] } });
    fireEvent.click(screen.getByText(/unassigned placeholder/i));
    expect(onAddPlaceholder).toHaveBeenCalled();
  });

  it('CSL-6: the not-a-user hatch opens a name and email form that adds an external person', () => {
    const { onStartExternal } = renderList();
    fireEvent.click(screen.getByText(/Not a user\? Add name/));
    expect(onStartExternal).toHaveBeenCalled();

    const { onAddExternal, onChangeExternal } = renderList({ externalDraft: { name: 'Marcus Webb', email: '' } });
    const form = screen.getByTestId('cell-external-person-form');
    fireEvent.change(within(form).getByPlaceholderText('Email (optional)'), { target: { value: 'm@abc.com' } });
    expect(onChangeExternal).toHaveBeenCalledWith({ name: 'Marcus Webb', email: 'm@abc.com' });
    fireEvent.click(within(form).getByText('Add person'));
    expect(onAddExternal).toHaveBeenCalled();
  });

  it('CSL-7: an unmatched # location term falls back to free text', () => {
    const { onUseAsText } = renderList({ picker: { mode: 'location', term: 'green room', locationMatches: [], personMatches: [] } });
    fireEvent.click(screen.getByText(/as free text/));
    expect(onUseAsText).toHaveBeenCalled();
  });

  it('CSL-8: # mode offers locations only — no people, no not-a-user hatch', () => {
    renderList({ picker: { mode: 'location', locationMatches: LOCATIONS, personMatches: [] } });
    const list = screen.getByTestId('cell-suggestions');
    expect(within(list).queryByText('Sarah Levine')).not.toBeInTheDocument();
    expect(within(list).queryByText(/Not a user\?/)).not.toBeInTheDocument();
  });
});

describe('CellSuggestionList — pointer versus blur', () => {
  it('CSL-9: a pointer press inside the list is suppressed so selection resolves before a blur commit', () => {
    // Without this the input blurs first, commits the raw typed term, and the
    // list unmounts before the click lands — intermittently, by event order.
    renderList();
    const list = screen.getByTestId('cell-suggestions');
    const notPrevented = fireEvent.mouseDown(within(list).getByText('Sarah Levine'));
    expect(notPrevented).toBe(false); // fireEvent returns false when default was prevented
  });
});

describe('CellSuggestionList — positioning', () => {
  it('CSL-10: the list is portaled to document.body, not nested in the clipping grid', () => {
    const grid = document.createElement('div');
    grid.className = 'ss-grid-scroll';
    document.body.appendChild(grid);

    renderList();
    const list = screen.getByTestId('cell-suggestions');
    expect(grid.contains(list)).toBe(false);
    expect(list.parentElement).toBe(document.body);
    grid.remove();
  });

  it('CSL-11: it is fixed-positioned above the sticky header row and label column', () => {
    renderList({ anchorRef: anchorAt({ top: 100, height: 30, left: 50 }) });
    const list = screen.getByTestId('cell-suggestions');
    expect(list.style.position).toBe('fixed');
    expect(list.style.top).toBe('130px'); // directly under the anchor cell
    expect(list.style.left).toBe('50px');
    // The grid's sticky chrome tops out at z-index 4.
    expect(Number(list.style.zIndex)).toBeGreaterThan(4);
  });

  it('CSL-12: near the bottom of the viewport the list flips above its cell', () => {
    window.innerHeight = 300;
    renderList({ anchorRef: anchorAt({ top: 250, height: 30 }) });
    const list = screen.getByTestId('cell-suggestions');
    expect(list.style.top).toBe('');
    expect(list.style.bottom).toBe('50px'); // innerHeight - anchor top
  });

  it('CSL-13: it follows its cell when the grid scrolls or the window resizes', () => {
    const el = document.createElement('td');
    let top = 100;
    el.getBoundingClientRect = () => ({ top, left: 50, width: 160, height: 30, bottom: top + 30, right: 210, x: 50, y: top });
    document.body.appendChild(el);

    renderList({ anchorRef: { current: el } });
    expect(screen.getByTestId('cell-suggestions').style.top).toBe('130px');

    top = 40;
    fireEvent.scroll(document.body);
    expect(screen.getByTestId('cell-suggestions').style.top).toBe('70px');

    top = 200;
    fireEvent(window, new Event('resize'));
    expect(screen.getByTestId('cell-suggestions').style.top).toBe('230px');
  });
});
