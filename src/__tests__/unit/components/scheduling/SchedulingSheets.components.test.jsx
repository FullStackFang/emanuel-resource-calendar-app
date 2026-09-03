// SchedulingSheets.components.test.jsx
//
// Direct component tests for the grid, the cell editor, and the email panel
// (tasks 6.3-6.6): the picker's 5-cap + honest overflow + escape hatches,
// two-step delete confirms, the linked-event drift/missing flags, the soft
// double-booking warning, and the placeholder hard-block messaging with the
// admin-only override.
//
// Test IDs: SCE-* (cell editor), SSG-* (grid), SEP-* (email panel)

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';

import SheetCellEditor from '../../../../components/scheduling/SheetCellEditor';
import SchedulingSheetGrid from '../../../../components/scheduling/SchedulingSheetGrid';
import EmailSchedulesPanel from '../../../../components/scheduling/EmailSchedulesPanel';

const PEOPLE = [
  { userId: 'u1', name: 'Sarah Levine', email: 'sarah@x.org' },
  { userId: 'u2', name: 'Sam Alto', email: 'sam@x.org' },
  { userId: 'u3', name: 'Sandy Boone', email: 'sandy@x.org' },
  { userId: 'u4', name: 'Saul Chan', email: 'saul@x.org' },
  { userId: 'u5', name: 'Sasha Diaz', email: 'sasha@x.org' },
  { userId: 'u6', name: 'Salim Evans', email: 'salim@x.org' },
  { userId: 'u7', name: 'Sable Fox', email: 'sable@x.org' },
  { userId: 'u8', name: 'Sage Gil', email: 'sage@x.org' },
];

const LOCATIONS = [
  { _id: 'l1', displayName: 'Wise Hall' },
  { _id: 'l2', displayName: 'Leventritt' },
];

describe('SheetCellEditor', () => {
  let onSave, onClose;
  beforeEach(() => {
    onSave = vi.fn();
    onClose = vi.fn();
  });

  const openEditor = (cell = { segments: [], note: null }) =>
    render(<SheetCellEditor cell={cell} people={PEOPLE} locations={LOCATIONS} onSave={onSave} onClose={onClose} />);

  it('SCE-1: @ shows at most 5 matches with an honest overflow count', () => {
    openEditor();
    fireEvent.change(screen.getByTestId('cell-editor-input'), { target: { value: '@sa' } });

    const picker = screen.getByTestId('person-picker');
    // 8 people match 'sa'; only 5 rows plus the escape hatch render.
    expect(within(picker).getAllByText(/@x\.org/)).toHaveLength(5);
    expect(within(picker).getByText(/3 more matches\. Keep typing/)).toBeInTheDocument();
  });

  it('SCE-2: an unmatched @term can be kept as a placeholder chip', () => {
    openEditor();
    fireEvent.change(screen.getByTestId('cell-editor-input'), { target: { value: '@usher_team' } });
    fireEvent.click(screen.getByText(/unassigned placeholder/i));

    expect(screen.getByTestId('cell-chip-placeholder')).toHaveTextContent('@usher_team');

    fireEvent.click(screen.getByTestId('cell-editor-save'));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: [expect.objectContaining({ type: 'person', placeholder: true, name: '@usher_team', email: null })],
      })
    );
  });

  it('SCE-3: the not-a-user escape hatch adds an external person with name and email', () => {
    openEditor();
    fireEvent.change(screen.getByTestId('cell-editor-input'), { target: { value: '@Marcus' } });
    fireEvent.click(screen.getByText(/Not a user\? Add name/));

    const form = screen.getByTestId('external-person-form');
    fireEvent.change(within(form).getByPlaceholderText('Full name'), { target: { value: 'Marcus Webb' } });
    fireEvent.change(within(form).getByPlaceholderText('Email (optional)'), { target: { value: 'marcus@abcsecurity.com' } });
    fireEvent.click(within(form).getByText('Add person'));

    expect(screen.getByTestId('cell-chip-external')).toHaveTextContent('Marcus Webb');

    fireEvent.click(screen.getByTestId('cell-editor-save'));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: [expect.objectContaining({ type: 'person', userId: null, email: 'marcus@abcsecurity.com', placeholder: false })],
      })
    );
  });

  it('SCE-4: # opens the location picker and selection stores the location id', () => {
    openEditor();
    fireEvent.change(screen.getByTestId('cell-editor-input'), { target: { value: '#wise' } });

    const picker = screen.getByTestId('location-picker');
    fireEvent.click(within(picker).getByText('Wise Hall'));

    fireEvent.click(screen.getByTestId('cell-editor-save'));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: [expect.objectContaining({ type: 'location', locationId: 'l1', name: 'Wise Hall' })],
      })
    );
  });

  it('SCE-5: plain text commits as a text segment and notes round-trip', () => {
    openEditor();
    const input = screen.getByTestId('cell-editor-input');
    fireEvent.change(input, { target: { value: 'Ch. 4 backup 6' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    fireEvent.click(screen.getByText('+ Add note'));
    fireEvent.change(screen.getByTestId('cell-note-input'), { target: { value: 'Bring the walkie' } });

    fireEvent.click(screen.getByTestId('cell-editor-save'));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: [{ type: 'text', text: 'Ch. 4 backup 6' }],
        note: expect.objectContaining({ text: 'Bring the walkie' }),
      })
    );
  });

  it('SCE-7: @ is the universal tag — the mention picker offers locations too, and picking one stores the location id', () => {
    openEditor();
    fireEvent.change(screen.getByTestId('cell-editor-input'), { target: { value: '@wise' } });

    const picker = screen.getByTestId('person-picker');
    expect(within(picker).getByTestId('mention-locations-group')).toHaveTextContent(/locations/i);
    fireEvent.click(within(picker).getByText(/Wise Hall/));

    fireEvent.click(screen.getByTestId('cell-editor-save'));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: [expect.objectContaining({ type: 'location', locationId: 'l1', name: 'Wise Hall' })],
      })
    );
  });

  it('SCE-6: a person chip takes a per-person call-time override', () => {
    openEditor({ segments: [{ type: 'person', userId: 'u1', name: 'Sarah Levine', email: 'sarah@x.org', placeholder: false, callTimeOverride: null }], note: null });

    fireEvent.click(screen.getByTitle(/personal call time/i));
    const editor = screen.getByTestId('call-time-editor');
    fireEvent.change(within(editor).getByPlaceholderText('16:00'), { target: { value: '15:45' } });
    fireEvent.click(within(editor).getByText('Set'));

    fireEvent.click(screen.getByTestId('cell-editor-save'));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: [expect.objectContaining({ callTimeOverride: '15:45' })],
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

function buildDay() {
  const rows = [
    { id: 'rLoc', label: 'Location', kind: 'starter' },
    { id: 'rCall', label: 'Call Time', kind: 'starter' },
    { id: 'rDoors', label: 'Doors Open', kind: 'starter' },
    { id: 'rBegins', label: 'Begins', kind: 'starter' },
    { id: 'rEnds', label: 'Ends', kind: 'starter' },
    { id: 'rUshers', label: 'Ushers', kind: 'custom' },
  ];
  const columns = [
    {
      id: 'c1',
      name: 'Erev Service',
      linkedEvent: {
        eventId: 'ev1',
        linkedAt: '2027-08-01T00:00:00Z',
        snapshot: { title: 'Erev Service', startDateTime: '2027-09-11T16:30:00', endDateTime: '2027-09-11T19:00:00', locationNames: [] },
      },
    },
    {
      id: 'c2',
      name: 'YP Dinner',
      linkedEvent: {
        eventId: 'ev2',
        linkedAt: '2027-08-01T00:00:00Z',
        snapshot: { title: 'YP Dinner', startDateTime: '2027-09-11T18:00:00', endDateTime: '2027-09-11T21:00:00', locationNames: [] },
      },
    },
    { id: 'c3', name: 'Overflow', linkedEvent: null },
  ];
  const person = { type: 'person', userId: 'u1', name: 'Sarah Levine', email: 'sarah@x.org', placeholder: false, callTimeOverride: null };
  return {
    _id: 'd1',
    date: '2027-09-11',
    title: 'Erev RH',
    _version: 3,
    rows,
    columns,
    cells: {
      'rBegins:c1': { segments: [{ type: 'text', text: '16:30' }], note: null },
      'rEnds:c1': { segments: [{ type: 'text', text: '19:00' }], note: null },
      'rBegins:c2': { segments: [{ type: 'text', text: '18:00' }], note: null },
      'rEnds:c2': { segments: [{ type: 'text', text: '21:00' }], note: null },
      'rUshers:c1': { segments: [person], note: { text: 'North door', authorName: 'M. Gold', at: '2027-08-29T00:00:00Z' } },
      'rUshers:c2': { segments: [person], note: null },
    },
    taggedEmails: ['sarah@x.org'],
    emailLog: [],
    emailStatus: [],
  };
}

describe('SchedulingSheetGrid', () => {
  let onStructure, onCellSave;
  beforeEach(() => {
    onStructure = vi.fn();
    onCellSave = vi.fn();
  });

  // A published event as the page shell now maps it: HH:MM prefill fields plus
  // the when-line data for the '@' mention picker.
  const LINKABLE = [
    {
      id: 'ev9',
      title: 'Community Dinner',
      date: '2027-09-11',
      startDateTime: '2027-09-11T18:00:00',
      endDateTime: '2027-09-11T21:00:00',
      startTime: '18:00',
      endTime: '21:00',
      setupTime: '17:00',
      doorOpenTime: '17:30',
      locationNames: ['Wise Hall', 'Uptown Annex'],
    },
  ];

  const renderGrid = ({ day = buildDay(), live, publishedEvents = [] } = {}) => {
    const liveEventsById = live !== undefined ? live : new Map([
      // ev1 drifted (time changed); ev2 deliberately absent → missing.
      ['ev1', { id: 'ev1', title: 'Erev Service', startDateTime: '2027-09-11T17:00:00', endDateTime: '2027-09-11T19:30:00', locationNames: [] }],
    ]);
    render(
      <SchedulingSheetGrid
        day={day}
        canEdit
        people={PEOPLE}
        locations={LOCATIONS}
        publishedEvents={publishedEvents}
        liveEventsById={liveEventsById}
        onCellSave={onCellSave}
        onStructure={onStructure}
      />
    );
    return day;
  };

  it('SSG-1: a linked column whose event changed shows the drift flag, and refresh updates the snapshot explicitly', () => {
    renderGrid();
    const flag = screen.getByTestId('link-drift-c1');
    expect(flag).toHaveTextContent(/changed since linked/i);

    fireEvent.click(within(flag).getByText(/refresh from event/i));
    expect(onStructure).toHaveBeenCalledTimes(1);
    const updatedC1 = onStructure.mock.calls[0][0].columns.find((c) => c.id === 'c1');
    expect(updatedC1.linkedEvent.snapshot.startDateTime).toBe('2027-09-11T17:00:00');
  });

  it('SSG-2: a linked column whose event no longer exists degrades without breaking', () => {
    renderGrid();
    expect(screen.getByTestId('link-missing-c2')).toHaveTextContent(/no longer exists/i);
    // The column still renders its cells.
    expect(screen.getByTestId('cell-rUshers:c2')).toBeInTheDocument();
  });

  it('SSG-3: the same person in two overlapping columns gets a soft warning, never a block', () => {
    renderGrid();
    // Sarah is in c1 (16:30-19:00) and c2 (18:00-21:00) — overlap.
    expect(screen.getAllByTestId('double-booking-warning').length).toBeGreaterThan(0);
    // Cells stay clickable/editable — no blocking UI exists.
    fireEvent.click(screen.getByTestId('cell-rUshers:c1'));
    expect(screen.getByTestId('sheet-cell-editor')).toBeInTheDocument();
  });

  it('SSG-4: deleting a column is a two-step in-button confirm', () => {
    renderGrid();
    const header = screen.getByTestId('column-header-c3');
    const del = within(header).getByTitle('Delete this column');

    fireEvent.click(del);
    expect(del).toHaveTextContent('Confirm?');
    expect(onStructure).not.toHaveBeenCalled();

    fireEvent.click(del);
    expect(onStructure).toHaveBeenCalledWith({ columns: expect.not.arrayContaining([expect.objectContaining({ id: 'c3' })]) });
  });

  it('SSG-5: starter rows are ordinary rows — deletable like any other', () => {
    renderGrid();
    const label = screen.getByTestId('row-label-rDoors');
    const del = within(label).getByTitle('Delete this row');
    fireEvent.click(del);
    fireEvent.click(del);
    const rows = onStructure.mock.calls[0][0].rows;
    expect(rows.some((r) => r.id === 'rDoors')).toBe(false);
  });

  it('SSG-6: adding a row appends a custom row through the structure callback', () => {
    renderGrid();
    const input = screen.getByTestId('add-row-input');
    fireEvent.change(input, { target: { value: 'Security walkie channel' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const rows = onStructure.mock.calls[0][0].rows;
    expect(rows.at(-1)).toEqual(expect.objectContaining({ label: 'Security walkie channel', kind: 'custom' }));
  });

  it('SSG-7: the note marker opens the note popover', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('note-marker-rUshers:c1'));
    expect(screen.getByTestId('note-popover-rUshers:c1')).toHaveTextContent('North door');
  });

  it('SSG-8: @ in the add-column input lists events with date and times; picking one links the column AND prefills the starter rows', () => {
    renderGrid({ publishedEvents: LINKABLE });
    fireEvent.click(screen.getByTestId('add-column-button'));
    fireEvent.change(screen.getByTestId('add-column-input'), { target: { value: '@din' } });

    const option = screen.getByTestId('event-option-ev9');
    // The picker row carries when-context, not just a name.
    expect(option).toHaveTextContent('Community Dinner');
    expect(option).toHaveTextContent('18:00');
    fireEvent.click(option);

    expect(onStructure).toHaveBeenCalledTimes(1);
    const [updates, cellWrites] = onStructure.mock.calls[0];
    const added = updates.columns.at(-1);
    expect(added.name).toBe('Community Dinner');
    expect(added.linkedEvent).toEqual(expect.objectContaining({ eventId: 'ev9' }));

    const byRow = Object.fromEntries(cellWrites.map((w) => [w.rowId, w]));
    expect(Object.keys(byRow)).toHaveLength(5);
    expect(cellWrites.every((w) => w.colId === added.id)).toBe(true);
    // Location row: chips, with a real id where the name matches a location.
    expect(byRow.rLoc.cell.segments).toEqual([
      expect.objectContaining({ type: 'location', locationId: 'l1', name: 'Wise Hall' }),
      expect.objectContaining({ type: 'location', locationId: null, name: 'Uptown Annex' }),
    ]);
    expect(byRow.rCall.cell.segments).toEqual([{ type: 'text', text: '17:00' }]);
    expect(byRow.rDoors.cell.segments).toEqual([{ type: 'text', text: '17:30' }]);
    expect(byRow.rBegins.cell.segments).toEqual([{ type: 'text', text: '18:00' }]);
    expect(byRow.rEnds.cell.segments).toEqual([{ type: 'text', text: '21:00' }]);
  });

  it('SSG-9: plain text in the add-column input still adds a free-standing column, no link, no prefill', () => {
    renderGrid({ publishedEvents: LINKABLE });
    fireEvent.click(screen.getByTestId('add-column-button'));
    const input = screen.getByTestId('add-column-input');
    fireEvent.change(input, { target: { value: 'Overflow West' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onStructure).toHaveBeenCalledTimes(1);
    const [updates, cellWrites] = onStructure.mock.calls[0];
    expect(updates.columns.at(-1)).toEqual(expect.objectContaining({ name: 'Overflow West', linkedEvent: null }));
    expect(cellWrites).toBeUndefined();
  });

  it('SSG-10: @ while renaming links an existing column in place and prefills ONLY still-empty starter cells', () => {
    renderGrid({ publishedEvents: LINKABLE });
    // c1 already has Begins (16:30) and Ends (19:00) filled in.
    const header = screen.getByTestId('column-header-c1');
    fireEvent.doubleClick(within(header).getByText('Erev Service'));
    fireEvent.change(within(header).getByPlaceholderText(/@ to link an event/), { target: { value: '@community' } });
    fireEvent.click(screen.getByTestId('event-option-ev9'));

    const [updates, cellWrites] = onStructure.mock.calls[0];
    const c1 = updates.columns.find((c) => c.id === 'c1');
    expect(c1.name).toBe('Community Dinner');
    expect(c1.linkedEvent).toEqual(expect.objectContaining({ eventId: 'ev9' }));

    const rowIds = cellWrites.map((w) => w.rowId);
    expect(rowIds).toEqual(expect.arrayContaining(['rLoc', 'rCall', 'rDoors']));
    // Entered values are never clobbered by a link.
    expect(rowIds).not.toContain('rBegins');
    expect(rowIds).not.toContain('rEnds');
  });

  it('SSG-11: legacy string-stored locationNames prefill as split chips instead of crashing', () => {
    // Real events can carry locationDisplayNames as a comma-separated STRING
    // (the string-stored-locations legacy shape) — this reproduced a live
    // 'names.map is not a function' crash on pick.
    renderGrid({
      publishedEvents: [{ ...LINKABLE[0], locationNames: 'Wise Hall, Uptown Annex' }],
    });
    fireEvent.click(screen.getByTestId('add-column-button'));
    fireEvent.change(screen.getByTestId('add-column-input'), { target: { value: '@din' } });
    fireEvent.click(screen.getByTestId('event-option-ev9'));

    const [, cellWrites] = onStructure.mock.calls[0];
    const loc = cellWrites.find((w) => w.rowId === 'rLoc');
    expect(loc.cell.segments).toEqual([
      expect.objectContaining({ type: 'location', locationId: 'l1', name: 'Wise Hall' }),
      expect.objectContaining({ type: 'location', locationId: null, name: 'Uptown Annex' }),
    ]);
  });

  it('SSG-13: dragging a column onto another column reorders columns and preserves linked-event metadata', () => {
    const day = renderGrid();
    const handle = screen.getByTestId('column-drag-handle-c1');
    const target = screen.getByTestId('column-header-c3');

    fireEvent.dragStart(handle);
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    expect(onStructure).toHaveBeenCalledTimes(1);
    const columns = onStructure.mock.calls[0][0].columns;
    expect(columns.map((c) => c.id)).toEqual(['c2', 'c3', 'c1']);
    const movedC1 = columns.find((c) => c.id === 'c1');
    expect(movedC1).toEqual(day.columns.find((c) => c.id === 'c1'));
  });

  it('SSG-14: column drag does not trigger rename, delete, or link refresh', () => {
    renderGrid();
    const handle = screen.getByTestId('column-drag-handle-c1');
    const target = screen.getByTestId('column-header-c3');

    fireEvent.dragStart(handle);
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    expect(screen.queryByTestId('sheet-cell-editor')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/@ to link an event/)).not.toBeInTheDocument();
  });

  it('SSG-15: the column move menu moves left/right and calls onStructure', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('column-drag-handle-c2'));
    const menu = screen.getByTestId('column-move-menu-c2');

    fireEvent.click(within(menu).getByText('Move left'));
    expect(onStructure.mock.calls[0][0].columns.map((c) => c.id)).toEqual(['c2', 'c1', 'c3']);
  });

  it('SSG-16: column move-to-start and move-to-end are disabled at the boundaries', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('column-drag-handle-c1'));
    const firstMenu = screen.getByTestId('column-move-menu-c1');
    expect(within(firstMenu).getByText('Move left')).toBeDisabled();
    expect(within(firstMenu).getByText('Move to start')).toBeDisabled();
    fireEvent.click(screen.getByTestId('column-drag-handle-c1'));

    fireEvent.click(screen.getByTestId('column-drag-handle-c3'));
    const lastMenu = screen.getByTestId('column-move-menu-c3');
    expect(within(lastMenu).getByText('Move right')).toBeDisabled();
    expect(within(lastMenu).getByText('Move to end')).toBeDisabled();
  });

  it('SSG-17: dragging a custom row onto another custom row reorders rows below the locked starter prefix', () => {
    const day = buildDay();
    day.rows.push({ id: 'rGreeters', label: 'Greeters', kind: 'custom' });
    renderGrid({ day });

    const handle = screen.getByTestId('row-drag-handle-rGreeters');
    const target = screen.getByTestId('row-label-rUshers');
    fireEvent.dragStart(handle);
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    expect(onStructure).toHaveBeenCalledTimes(1);
    const rows = onStructure.mock.calls[0][0].rows;
    expect(rows.map((r) => r.id)).toEqual(['rLoc', 'rCall', 'rDoors', 'rBegins', 'rEnds', 'rGreeters', 'rUshers']);
  });

  it('SSG-18: starter rows have no drag handle or move menu', () => {
    renderGrid();
    expect(screen.queryByTestId('row-drag-handle-rLoc')).not.toBeInTheDocument();
    expect(screen.queryByTestId('row-drag-handle-rBegins')).not.toBeInTheDocument();
  });

  it('SSG-19: the custom row move menu moves up/down within the custom group and calls onStructure', () => {
    const day = buildDay();
    day.rows.push({ id: 'rGreeters', label: 'Greeters', kind: 'custom' });
    renderGrid({ day });

    fireEvent.click(screen.getByTestId('row-drag-handle-rGreeters'));
    const menu = screen.getByTestId('row-move-menu-rGreeters');
    fireEvent.click(within(menu).getByText('Move up'));

    const rows = onStructure.mock.calls[0][0].rows;
    expect(rows.map((r) => r.id)).toEqual(['rLoc', 'rCall', 'rDoors', 'rBegins', 'rEnds', 'rGreeters', 'rUshers']);
  });

  it('SSG-20: a single custom row has no-op move up/down disabled', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('row-drag-handle-rUshers'));
    const menu = screen.getByTestId('row-move-menu-rUshers');
    expect(within(menu).getByText('Move up')).toBeDisabled();
    expect(within(menu).getByText('Move down')).toBeDisabled();
  });

  it('SSG-21: read-only users see no reorder handles or move menus', () => {
    render(
      <SchedulingSheetGrid
        day={buildDay()}
        canEdit={false}
        people={PEOPLE}
        locations={LOCATIONS}
        publishedEvents={[]}
        liveEventsById={new Map()}
        onCellSave={onCellSave}
        onStructure={onStructure}
      />
    );
    expect(screen.queryByTestId('column-drag-handle-c1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('row-drag-handle-rUshers')).not.toBeInTheDocument();
  });

  it('SSG-22: adding a column stays open in a saving state until onStructure reports success, then closes', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('add-column-button'));
    const input = screen.getByTestId('add-column-input');
    fireEvent.change(input, { target: { value: 'Overflow West' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onStructure).toHaveBeenCalledTimes(1);
    const [, , callbacks] = onStructure.mock.calls[0];
    // Still visible and disabled — no blank gap between click and the column appearing.
    expect(screen.getByTestId('add-column-form')).toBeInTheDocument();
    expect(input).toBeDisabled();
    expect(screen.getByText('Adding…')).toBeInTheDocument();

    act(() => callbacks.onSuccess());
    expect(screen.queryByTestId('add-column-form')).not.toBeInTheDocument();
  });

  it('SSG-23: a failed add-column save re-enables the form instead of closing it, keeping the typed name', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('add-column-button'));
    const input = screen.getByTestId('add-column-input');
    fireEvent.change(input, { target: { value: 'Overflow West' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const [, , callbacks] = onStructure.mock.calls[0];
    act(() => callbacks.onError());

    expect(screen.getByTestId('add-column-form')).toBeInTheDocument();
    expect(screen.getByTestId('add-column-input')).not.toBeDisabled();
    expect(screen.getByTestId('add-column-input')).toHaveValue('Overflow West');
    expect(screen.getByText('Add')).toBeInTheDocument();
  });

  it('SSG-24: linking an event also shows a saving state and closes on success', () => {
    renderGrid({ publishedEvents: LINKABLE });
    fireEvent.click(screen.getByTestId('add-column-button'));
    fireEvent.change(screen.getByTestId('add-column-input'), { target: { value: '@din' } });
    fireEvent.click(screen.getByTestId('event-option-ev9'));

    expect(onStructure).toHaveBeenCalledTimes(1);
    const [, , callbacks] = onStructure.mock.calls[0];
    expect(screen.getByTestId('add-column-form')).toBeInTheDocument();
    expect(screen.getByTestId('add-column-input')).toBeDisabled();

    act(() => callbacks.onSuccess());
    expect(screen.queryByTestId('add-column-form')).not.toBeInTheDocument();
  });

  it('SSG-25: clicking the modal backdrop cancels the add-column form; clicking inside it does not', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('add-column-button'));
    const form = screen.getByTestId('add-column-form');

    fireEvent.mouseDown(form);
    expect(screen.getByTestId('add-column-form')).toBeInTheDocument();

    fireEvent.mouseDown(document.querySelector('.ss-editor-backdrop'));
    expect(screen.queryByTestId('add-column-form')).not.toBeInTheDocument();
    expect(onStructure).not.toHaveBeenCalled();
  });

  it('SSG-26: Escape cancels the add-column form and clears the typed name', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('add-column-button'));
    const input = screen.getByTestId('add-column-input');
    fireEvent.change(input, { target: { value: 'Overflow West' } });

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('add-column-form')).not.toBeInTheDocument();
    expect(onStructure).not.toHaveBeenCalled();

    // Reopening starts fresh, not with the cancelled draft.
    fireEvent.click(screen.getByTestId('add-column-button'));
    expect(screen.getByTestId('add-column-input')).toHaveValue('');
  });

  it('SSG-27: the Cancel button closes the add-column modal without saving', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('add-column-button'));
    const form = screen.getByTestId('add-column-form');
    fireEvent.change(screen.getByTestId('add-column-input'), { target: { value: 'Overflow West' } });

    fireEvent.click(within(form).getByText('Cancel'));
    expect(screen.queryByTestId('add-column-form')).not.toBeInTheDocument();
    expect(onStructure).not.toHaveBeenCalled();
  });

  it('SSG-12: opening a cell editor refreshes the people directory (stale-tab self-heal)', () => {
    const onRefreshPeople = vi.fn();
    render(
      <SchedulingSheetGrid
        day={buildDay()}
        canEdit
        people={PEOPLE}
        locations={LOCATIONS}
        publishedEvents={[]}
        liveEventsById={new Map()}
        onCellSave={onCellSave}
        onStructure={onStructure}
        onRefreshPeople={onRefreshPeople}
      />
    );
    fireEvent.click(screen.getByTestId('cell-rUshers:c3'));
    expect(screen.getByTestId('sheet-cell-editor')).toBeInTheDocument();
    expect(onRefreshPeople).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

function buildSheetForEmail({ withPlaceholder = false, emailStatus = [] } = {}) {
  const day = buildDay();
  day.emailStatus = emailStatus;
  if (withPlaceholder) {
    day.cells['rUshers:c3'] = {
      segments: [{ type: 'person', userId: null, name: '@usher_team', email: null, placeholder: true, callTimeOverride: null }],
      note: null,
    };
  }
  return { sheet: { _id: 's1', name: '2027 High Holy Days', days: [day] }, day };
}

describe('EmailSchedulesPanel', () => {
  it('SEP-1: recipients render with per-person status (not yet emailed / sent / stale)', () => {
    const { sheet, day } = buildSheetForEmail({
      emailStatus: [{ email: 'sarah@x.org', sentAt: '2027-08-30T00:00:00Z', stale: true }],
    });
    render(<EmailSchedulesPanel sheet={sheet} activeDay={day} isAdmin={false} onSend={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByTestId('status-sarah@x.org')).toHaveTextContent(/changed since/i);
  });

  it('SEP-2: placeholders hard-block the send for a non-admin manager (no override offered)', () => {
    const { sheet, day } = buildSheetForEmail({ withPlaceholder: true });
    render(<EmailSchedulesPanel sheet={sheet} activeDay={day} isAdmin={false} onSend={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByTestId('placeholder-block')).toHaveTextContent(/blocked/i);
    expect(screen.getByTestId('send-schedules-button')).toBeDisabled();
    expect(screen.queryByTestId('allow-placeholders')).not.toBeInTheDocument();
  });

  it('SEP-3: an admin can override; the override plainly says placeholders are skipped', () => {
    const { sheet, day } = buildSheetForEmail({ withPlaceholder: true });
    render(<EmailSchedulesPanel sheet={sheet} activeDay={day} isAdmin onSend={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByTestId('send-schedules-button')).toBeDisabled();
    fireEvent.click(screen.getByTestId('allow-placeholders'));
    expect(screen.getByTestId('send-schedules-button')).not.toBeDisabled();
    expect(screen.getByText(/placeholders are skipped/i)).toBeInTheDocument();
  });

  it('SEP-4: sending is a two-step confirm; results render per recipient', async () => {
    const { sheet, day } = buildSheetForEmail();
    const onSend = vi.fn().mockResolvedValue({
      sent: 1,
      failed: 1,
      results: [
        { email: 'sarah@x.org', success: true },
        { email: 'bad@x.org', success: false, error: 'mailbox unavailable' },
      ],
      skippedPlaceholders: [],
    });
    render(<EmailSchedulesPanel sheet={sheet} activeDay={day} isAdmin onSend={onSend} onClose={vi.fn()} />);

    const button = screen.getByTestId('send-schedules-button');
    fireEvent.click(button);
    expect(button).toHaveTextContent('Confirm send?');
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ dayId: 'd1' }));

    const results = await screen.findByTestId('send-results');
    expect(within(results).getByTestId('result-bad@x.org')).toHaveTextContent(/mailbox unavailable/);
    expect(within(results).getByTestId('result-sarah@x.org')).toHaveTextContent(/Sent/);
  });

  it('SEP-5: whole-sheet scope sends wholeSheet: true', () => {
    const { sheet, day } = buildSheetForEmail();
    const onSend = vi.fn().mockResolvedValue({ sent: 1, failed: 0, results: [], skippedPlaceholders: [] });
    render(<EmailSchedulesPanel sheet={sheet} activeDay={day} isAdmin onSend={onSend} onClose={vi.fn()} />);

    fireEvent.click(screen.getByLabelText(/All days in this sheet/));
    const button = screen.getByTestId('send-schedules-button');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ wholeSheet: true }));
  });
});
