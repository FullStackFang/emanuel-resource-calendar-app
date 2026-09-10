// SchedulingSheets.components.test.jsx
//
// Direct component tests for the grid, the cell editor, and the email panel
// (tasks 6.3-6.6): the picker's 5-cap + honest overflow + escape hatches,
// two-step delete confirms, the linked-event drift/missing flags, the soft
// double-booking warning, and the placeholder skip messaging (placeholders
// are reported, never a block).
//
// Test IDs: SCE-* (cell editor), SSG-* (grid), SEP-* (email panel, 1-22)

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';

import SheetCellEditor from '../../../../components/scheduling/SheetCellEditor';
import SchedulingSheetGrid from '../../../../components/scheduling/SchedulingSheetGrid';
import EmailSchedulesPanel from '../../../../components/scheduling/EmailSchedulesPanel';
import { logger } from '../../../../utils/logger';

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
    fireEvent.change(within(editor).getByPlaceholderText('6pm or 18:00'), { target: { value: '15:45' } });
    fireEvent.click(within(editor).getByText('Set'));

    fireEvent.click(screen.getByTestId('cell-editor-save'));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: [expect.objectContaining({ callTimeOverride: '15:45' })],
      })
    );
  });

  it('SCE-14: the per-person call time accepts 6pm and stores the strict HH:MM the server requires', () => {
    openEditor({ segments: [{ type: 'person', userId: 'u1', name: 'Sarah Levine', email: 'sarah@x.org', placeholder: false, callTimeOverride: null }], note: null });

    fireEvent.click(screen.getByTitle(/personal call time/i));
    const editor = screen.getByTestId('call-time-editor');
    fireEvent.change(within(editor).getByPlaceholderText('6pm or 18:00'), { target: { value: '6pm' } });
    fireEvent.click(within(editor).getByText('Set'));

    fireEvent.click(screen.getByTestId('cell-editor-save'));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ segments: [expect.objectContaining({ callTimeOverride: '18:00' })] })
    );
  });

  // ── Time entry (SCE-8..13) ────────────────────────────────────────────────

  it('SCE-8: a typed time is committed by Save cell — no Enter required', () => {
    // Regression: save() used to read only `segments`, silently discarding
    // whatever was still in the input. Times were the visible casualty because
    // people and locations commit via a picker click instead.
    openEditor();
    fireEvent.change(screen.getByTestId('cell-editor-input'), { target: { value: '6:00pm' } });
    fireEvent.click(screen.getByTestId('cell-editor-save'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ segments: [{ type: 'text', text: '6:00 PM' }] })
    );
  });

  it.each([['6pm'], ['6 PM'], ['6:00'], ['630pm'], ['18:00'], ['1800']])(
    'SCE-9: %s normalizes to one consistent sheet format',
    (typed) => {
      openEditor();
      const input = screen.getByTestId('cell-editor-input');
      fireEvent.change(input, { target: { value: typed } });
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.click(screen.getByTestId('cell-editor-save'));

      const { segments } = onSave.mock.calls[0][0];
      expect(segments[0].text).toBe(typed === '630pm' ? '6:30 PM' : '6:00 PM');
    }
  );

  it('SCE-10: a time-shaped entry previews its normalized value before commit', () => {
    openEditor();
    fireEvent.change(screen.getByTestId('cell-editor-input'), { target: { value: '6p' } });
    expect(screen.getByTestId('cell-time-hint')).toHaveTextContent('6:00 PM');
  });

  it('SCE-11: @6pm offers a Time row, so the @ muscle memory works for times too', () => {
    openEditor();
    fireEvent.change(screen.getByTestId('cell-editor-input'), { target: { value: '@6pm' } });

    const row = screen.getByTestId('mention-time-row');
    expect(row).toHaveTextContent('6:00 PM');
    fireEvent.click(row);

    fireEvent.click(screen.getByTestId('cell-editor-save'));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ segments: [{ type: 'text', text: '6:00 PM' }] })
    );
  });

  it('SCE-12: non-time free text is committed verbatim, never coerced to a clock value', () => {
    openEditor();
    fireEvent.change(screen.getByTestId('cell-editor-input'), { target: { value: 'after kiddush' } });
    expect(screen.queryByTestId('cell-time-hint')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cell-editor-save'));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ segments: [{ type: 'text', text: 'after kiddush' }] })
    );
  });

  it('SCE-13: an unpicked @term is kept as text on save rather than silently dropped', () => {
    openEditor();
    fireEvent.change(screen.getByTestId('cell-editor-input'), { target: { value: '@Marcus' } });
    fireEvent.click(screen.getByTestId('cell-editor-save'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ segments: [{ type: 'text', text: '@Marcus' }] })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

function buildDay() {
  const rows = [
      { id: 'rLoc', label: 'Location', kind: 'starter', metadataRole: 'location' },
      { id: 'rCall', label: 'Call Time', kind: 'starter', metadataRole: 'callTime' },
      { id: 'rDoors', label: 'Doors Open', kind: 'starter', metadataRole: 'doorsOpen' },
      { id: 'rBegins', label: 'Begins', kind: 'starter', metadataRole: 'begins' },
      { id: 'rEnds', label: 'Ends', kind: 'starter', metadataRole: 'ends' },
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
    expect(screen.getByTestId('inline-cell-editor')).toBeInTheDocument();
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
    // Event HH:MM is normalized to the sheet's one time format, so a prefilled
    // row and a hand-typed one read identically on the printed sheet.
    expect(byRow.rCall.cell.segments).toEqual([{ type: 'text', text: '5:00 PM' }]);
    expect(byRow.rDoors.cell.segments).toEqual([{ type: 'text', text: '5:30 PM' }]);
    expect(byRow.rBegins.cell.segments).toEqual([{ type: 'text', text: '6:00 PM' }]);
    expect(byRow.rEnds.cell.segments).toEqual([{ type: 'text', text: '9:00 PM' }]);
  });

  it('SSG-8a: event prefill follows renamed and reordered metadata roles', () => {
    const day = buildDay();
    day.rows = [
      { ...day.rows.find((row) => row.id === 'rEnds'), label: 'Wrap' },
      day.rows.find((row) => row.id === 'rUshers'),
      { ...day.rows.find((row) => row.id === 'rLoc'), label: 'Where' },
      { ...day.rows.find((row) => row.id === 'rBegins'), label: 'Go' },
      { ...day.rows.find((row) => row.id === 'rCall'), label: 'Crew arrival' },
      { ...day.rows.find((row) => row.id === 'rDoors'), label: 'House' },
    ];
    renderGrid({ day, publishedEvents: LINKABLE });
    fireEvent.click(screen.getByTestId('add-column-button'));
    fireEvent.change(screen.getByTestId('add-column-input'), { target: { value: '@din' } });
    fireEvent.click(screen.getByTestId('event-option-ev9'));

    const [, cellWrites] = onStructure.mock.calls[0];
    const byRow = Object.fromEntries(cellWrites.map((write) => [write.rowId, write.cell]));
    expect(byRow.rLoc.segments[0]).toEqual(expect.objectContaining({ type: 'location', name: 'Wise Hall' }));
    expect(byRow.rCall.segments).toEqual([{ type: 'text', text: '5:00 PM' }]);
    expect(byRow.rDoors.segments).toEqual([{ type: 'text', text: '5:30 PM' }]);
    expect(byRow.rBegins.segments).toEqual([{ type: 'text', text: '6:00 PM' }]);
    expect(byRow.rEnds.segments).toEqual([{ type: 'text', text: '9:00 PM' }]);
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

  it('SSG-17: dragging a starter row below a custom row preserves row identity, metadata, and cells', () => {
    const day = buildDay();
    renderGrid({ day });

    const handle = screen.getByTestId('row-drag-handle-rLoc');
    const target = screen.getByTestId('row-label-rUshers');
    fireEvent.dragStart(handle);
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    expect(onStructure).toHaveBeenCalledTimes(1);
    const updates = onStructure.mock.calls[0][0];
    expect(updates.rows.map((r) => r.id)).toEqual(['rCall', 'rDoors', 'rBegins', 'rEnds', 'rUshers', 'rLoc']);
    expect(updates.rows.at(-1)).toBe(day.rows[0]);
    expect(updates.rows.at(-1).metadataRole).toBe('location');
    expect(updates.cells).toBeUndefined();
    expect(day.cells['rUshers:c1'].note.text).toBe('North door');
  });

  it('SSG-18: starter rows expose drag handles and keyboard move menus', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('row-drag-handle-rLoc'));
    expect(screen.getByTestId('row-move-menu-rLoc')).toBeInTheDocument();
    expect(screen.getByTestId('row-drag-handle-rBegins')).toBeInTheDocument();
  });

  it('SSG-19: the keyboard move menu moves a custom row across a starter row', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('row-drag-handle-rUshers'));
    const menu = screen.getByTestId('row-move-menu-rUshers');
    fireEvent.click(within(menu).getByText('Move up'));

    const rows = onStructure.mock.calls[0][0].rows;
    expect(rows.map((r) => r.id)).toEqual(['rLoc', 'rCall', 'rDoors', 'rBegins', 'rUshers', 'rEnds']);
  });

  it('SSG-20: row move controls disable only true array boundaries', () => {
    renderGrid();
    fireEvent.click(screen.getByTestId('row-drag-handle-rUshers'));
    const menu = screen.getByTestId('row-move-menu-rUshers');
    expect(within(menu).getByText('Move up')).not.toBeDisabled();
    expect(within(menu).getByText('Move down')).toBeDisabled();
    expect(within(menu).getByText('Move to top')).not.toBeDisabled();
    expect(within(menu).getByText('Move to bottom')).toBeDisabled();
  });

  it('SSG-21: the row metadata action assigns and removes roles with native buttons', () => {
    const day = buildDay();
    day.rows = day.rows.filter((row) => row.metadataRole !== 'doorsOpen');
    renderGrid({ day });

    fireEvent.click(screen.getByRole('button', { name: 'Set metadata role for Ushers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Doors open' }));

    let rows = onStructure.mock.calls[0][0].rows;
    expect(rows.find((row) => row.id === 'rUshers').metadataRole).toBe('doorsOpen');

    onStructure.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Set metadata role for Location' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ordinary row' }));
    rows = onStructure.mock.calls[0][0].rows;
    expect(rows.find((row) => row.id === 'rLoc').metadataRole).toBeNull();
  });

  it('SSG-22: duplicate metadata roles show an accessible error', () => {
    renderGrid();
    fireEvent.click(screen.getByRole('button', { name: 'Set metadata role for Ushers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Location' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/Location is already assigned to Location/i);
    expect(onStructure).not.toHaveBeenCalled();
  });

  it('SSG-23: an ordinary row can recover a role after its metadata row was deleted', () => {
    const day = buildDay();
    day.rows = day.rows.filter((row) => row.id !== 'rLoc');
    renderGrid({ day });

    fireEvent.click(screen.getByRole('button', { name: 'Set metadata role for Ushers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Location' }));

    const rows = onStructure.mock.calls[0][0].rows;
    expect(rows.find((row) => row.id === 'rUshers').metadataRole).toBe('location');
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

  it('SSG-28: free text renders as its own chip, distinct from the person/location chips', () => {
    renderGrid();

    // The Begins cell holds a plain text segment. It is a chip like every
    // other segment, but carries its own kind class so the stylesheet can
    // colour it apart from a name or a room.
    const cell = screen.getByTestId('cell-rBegins:c1');
    const chip = within(cell).getByTestId('grid-chip-text');
    expect(chip).toHaveTextContent('16:30');
    expect(chip.className).toContain('ss-chip');
    expect(chip.className).toContain('ss-chip-text');

    // A person chip in the same grid keeps its own kind — the two never
    // collapse onto one class.
    const person = within(screen.getByTestId('cell-rUshers:c1')).getByTestId('grid-chip-user');
    expect(person.className).not.toContain('ss-chip-text');
  });

  it('SSG-29: Ctrl+C then Ctrl+V moves a whole cell between cells', () => {
    renderGrid();
    fireEvent.keyDown(screen.getByTestId('cell-rBegins:c1'), { key: 'c', ctrlKey: true });
    fireEvent.keyDown(screen.getByTestId('cell-rEnds:c2'), { key: 'v', ctrlKey: true });

    expect(onCellSave).toHaveBeenCalledTimes(1);
    const [rowId, colId, cell] = onCellSave.mock.calls[0];
    expect([rowId, colId]).toEqual(['rEnds', 'c2']);
    expect(cell.segments).toEqual([{ type: 'text', text: '16:30' }]);
    // The modified keys never leak into the type-to-edit path.
    expect(screen.queryByTestId('inline-cell-editor')).not.toBeInTheDocument();
  });

  it('SSG-30: the shortcuts work from inside an OPEN editor, which is the state a clicked cell is in', () => {
    // The bug this locks: clicking a cell opens the editor, so gating the
    // shortcuts on 'focused but not editing' put them out of a mouse user's
    // reach entirely.
    renderGrid();
    fireEvent.click(screen.getByTestId('cell-rUshers:c1'));
    fireEvent.keyDown(screen.getByTestId('inline-cell-input'), { key: 'c', ctrlKey: true });
    fireEvent.keyDown(screen.getByTestId('inline-cell-input'), { key: 'Escape' });

    // Paste into a cell holding something DIFFERENT ('18:00'), or the test
    // passes on the destination's own content and proves nothing.
    fireEvent.click(screen.getByTestId('cell-rBegins:c2'));
    fireEvent.keyDown(screen.getByTestId('inline-cell-input'), { key: 'v', ctrlKey: true });
    fireEvent.keyDown(screen.getByTestId('inline-cell-input'), { key: 'Enter' });

    const [rowId, colId, cell] = onCellSave.mock.calls[0];
    expect([rowId, colId]).toEqual(['rBegins', 'c2']);
    expect(cell.segments).toEqual([expect.objectContaining({ userId: 'u1', name: 'Sarah Levine' })]);
  });

  it('SSG-31: a mixed cell — a tagged person AND free text — copies whole, identity intact', () => {
    const writeText = vi.fn(() => Promise.resolve());
    const original = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      const day = buildDay();
      day.cells['rUshers:c3'] = {
        segments: [
          { type: 'person', userId: 'u1', name: 'Sarah Levine', email: 'sarah@x.org', placeholder: false, callTimeOverride: null },
          { type: 'text', text: 'some free form text' },
        ],
        note: null,
      };
      renderGrid({ day });

      fireEvent.keyDown(screen.getByTestId('cell-rUshers:c3'), { key: 'c', ctrlKey: true });
      fireEvent.keyDown(screen.getByTestId('cell-rLoc:c1'), { key: 'v', ctrlKey: true });

      // BOTH segments travel, and userId/email survive — they are what drive
      // double-booking detection and the email fan-out.
      const [, , cell] = onCellSave.mock.calls[0];
      expect(cell.segments).toEqual([
        expect.objectContaining({ type: 'person', userId: 'u1', name: 'Sarah Levine', email: 'sarah@x.org' }),
        { type: 'text', text: 'some free form text' },
      ]);
      expect(writeText).toHaveBeenCalledWith('Sarah Levine, some free form text');
    } finally {
      Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true });
    }
  });

  it('SSG-32: pasting keeps the destination note, marks the source, and adds no buttons to the grid', () => {
    renderGrid();
    fireEvent.keyDown(screen.getByTestId('cell-rBegins:c1'), { key: 'c', ctrlKey: true });
    expect(screen.getByTestId('cell-rBegins:c1').className).toContain('ss-cell-copied');
    // Copy and paste are keyboard-only; the grid grew no per-cell chrome.
    expect(screen.queryByTestId('cell-copy-rBegins:c1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cell-paste-rUshers:c1')).not.toBeInTheDocument();
    expect(screen.getByTestId('cell-clipboard-hint')).toHaveTextContent('Ctrl+C');

    // rUshers:c1 carries a note of its own ('North door').
    fireEvent.keyDown(screen.getByTestId('cell-rUshers:c1'), { key: 'v', ctrlKey: true });
    const [, , cell] = onCellSave.mock.calls[0];
    expect(cell.segments).toEqual([{ type: 'text', text: '16:30' }]);
    expect(cell.note).toEqual(expect.objectContaining({ text: 'North door' }));
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
    expect(screen.getByTestId('inline-cell-editor')).toBeInTheDocument();
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

/**
 * Three days whose rosters DIFFER, so a day selection that is wrong in either
 * direction is visible: only the middle day has Miriam, and only the last has
 * Ben. Versions differ too, so a send snapshot cannot pass by coincidence.
 */
function buildMultiDaySheet() {
  const chip = (name, email) => ({
    type: 'person', userId: null, name, email, placeholder: false, callTimeOverride: null,
  });
  const mkDay = (_id, date, title, _version, segments) => ({
    _id, date, title, _version,
    rows: [{ id: 'rU', label: 'Ushers', kind: 'custom' }],
    columns: [{ id: 'c1', name: 'Service', linkedEvent: null }],
    cells: { 'rU:c1': { segments, note: null } },
    taggedEmails: segments.map((seg) => seg.email).filter(Boolean),
    emailLog: [],
    emailStatus: [],
  });
  const d1 = mkDay('d1', '2027-09-11', 'Erev RH', 3, [chip('Sarah Levine', 'sarah@x.org')]);
  const d2 = mkDay('d2', '2027-09-15', 'Tashlich', 5, [chip('Miriam Cohen', 'miriam@x.org')]);
  const d3 = mkDay('d3', '2027-09-20', 'Kol Nidre', 7, [
    chip('Sarah Levine', 'sarah@x.org'), chip('Ben Ortiz', 'ben@x.org'),
  ]);
  return {
    sheet: {
      _id: 's1',
      name: '2027 High Holy Days',
      days: [d1, d2, d3],
      // Supplied by the server so a subject customized in Email Management is
      // respected in the prefill rather than re-guessed here.
      assignmentEmailSubject: 'Your assignments for {{scopeLabel}}',
    },
    d1, d2, d3,
  };
}

const resolvedSend = () =>
  vi.fn().mockResolvedValue({ sent: 1, failed: 0, results: [], skippedPlaceholders: [] });

describe('EmailSchedulesPanel', () => {
  it('SEP-1: recipients render with per-person status (not yet emailed / sent / stale)', () => {
    const { sheet, day } = buildSheetForEmail({
      emailStatus: [{ email: 'sarah@x.org', sentAt: '2027-08-30T00:00:00Z', stale: true }],
    });
    render(<EmailSchedulesPanel sheet={sheet} activeDay={day} onSend={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByTestId('status-sarah@x.org')).toHaveTextContent(/changed since/i);
  });

  it('SEP-2: placeholders never block the send; they are named as skipped', () => {
    const { sheet, day } = buildSheetForEmail({ withPlaceholder: true });
    render(<EmailSchedulesPanel sheet={sheet} activeDay={day} onSend={vi.fn()} onClose={vi.fn()} />);

    const note = screen.getByTestId('placeholder-note');
    expect(note).toHaveTextContent(/skipped/i);
    expect(note).toHaveTextContent('@usher_team');
    expect(note).not.toHaveTextContent(/blocked/i);
    expect(screen.getByTestId('send-schedules-button')).not.toBeDisabled();
  });

  it('SEP-9: historical orphaned cells do not appear in the recipient roster', () => {
    const { sheet, day } = buildSheetForEmail();
    day.cells['missing-row:missing-column'] = {
      segments: [{ type: 'person', name: 'Ghost', email: 'ghost@x.org', placeholder: false }],
      note: null,
    };
    day.taggedEmails.push('ghost@x.org');
    render(<EmailSchedulesPanel sheet={sheet} activeDay={day} onSend={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('Sarah Levine')).toBeInTheDocument();
    expect(screen.queryByText('Ghost')).not.toBeInTheDocument();
    expect(screen.queryByText('ghost@x.org')).not.toBeInTheDocument();
  });

  // The admin-only allowPlaceholders override is GONE along with the block.
  // This asserts the flag never comes back in the request body — a server that
  // no longer reads it would silently accept one, so only the client can lock it.
  it('SEP-3: a send with placeholders in scope carries no allowPlaceholders flag', () => {
    const { sheet, day } = buildSheetForEmail({ withPlaceholder: true });
    const onSend = vi.fn().mockResolvedValue({ sent: 1, failed: 0, results: [], skippedPlaceholders: ['@usher_team'] });
    render(<EmailSchedulesPanel sheet={sheet} activeDay={day} onSend={onSend} onClose={vi.fn()} />);

    const button = screen.getByTestId('send-schedules-button');
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).not.toHaveProperty('allowPlaceholders');
    expect(screen.queryByTestId('allow-placeholders')).not.toBeInTheDocument();
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
    render(<EmailSchedulesPanel sheet={sheet} activeDay={day} onSend={onSend} onClose={vi.fn()} />);

    const button = screen.getByTestId('send-schedules-button');
    fireEvent.click(button);
    expect(button).toHaveTextContent('Confirm send?');
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.click(button);
    // Was `dayId: 'd1'`. The panel states scope as an explicit day LIST now; the
    // singular legacy field remains accepted by the server, not emitted here.
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ dayIds: ['d1'] }));

    const results = await screen.findByTestId('send-results');
    // The raw server text is console material now (SEP-20); the row says
    // only that the send failed, in words.
    expect(within(results).getByTestId('result-bad@x.org')).toHaveTextContent(/Send failed/);
    expect(within(results).getByTestId('result-bad@x.org')).not.toHaveTextContent(/mailbox unavailable/);
    expect(within(results).getByTestId('result-sarah@x.org')).toHaveTextContent(/Sent/);
  });

  // Was 'whole-sheet scope sends wholeSheet: true'. The day rail replaced the
  // scope radios, and the new panel always states its scope EXPLICITLY — so
  // 'every day' is a full dayIds list, not the legacy flag. `wholeSheet` stays
  // a supported input on the server for older clients (SE-43); it is simply no
  // longer something this panel emits.
  it('SEP-5: selecting every day sends explicit dayIds, not the legacy wholeSheet flag', () => {
    const { sheet, day } = buildSheetForEmail();
    const onSend = vi.fn().mockResolvedValue({ sent: 1, failed: 0, results: [], skippedPlaceholders: [] });
    render(<EmailSchedulesPanel sheet={sheet} activeDay={day} onSend={onSend} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('days-all'));
    const button = screen.getByTestId('send-schedules-button');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ dayIds: ['d1'] }));
    expect(onSend.mock.calls[0][0]).not.toHaveProperty('wholeSheet');
  });

  // Default ON, because a calendar attachment nobody remembers to tick is
  // worth nothing. The server reads `includeCalendar === true` and nothing
  // else, so an unmodified send has to say so explicitly.
  it('SEP-6: the calendar attachment defaults on and the body says so', () => {
    const { sheet, day } = buildSheetForEmail();
    const onSend = vi.fn().mockResolvedValue({ sent: 1, failed: 0, results: [], skippedPlaceholders: [] });
    render(<EmailSchedulesPanel sheet={sheet} activeDay={day} onSend={onSend} onClose={vi.fn()} />);

    expect(screen.getByTestId('include-calendar')).toBeChecked();

    const button = screen.getByTestId('send-schedules-button');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ includeCalendar: true }));
  });

  // The rollback lever: a sender who hits a mail client that mishandles a
  // multi-event attachment needs a way out that is not a deploy.
  it('SEP-7: clearing the control sends includeCalendar: false', () => {
    const { sheet, day } = buildSheetForEmail();
    const onSend = vi.fn().mockResolvedValue({ sent: 1, failed: 0, results: [], skippedPlaceholders: [] });
    render(<EmailSchedulesPanel sheet={sheet} activeDay={day} onSend={onSend} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('include-calendar'));
    expect(screen.getByTestId('include-calendar')).not.toBeChecked();

    const button = screen.getByTestId('send-schedules-button');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ includeCalendar: false }));
  });

  it('SEP-8: the results pane reports the calendar file only when one went out', async () => {
    const { sheet, day } = buildSheetForEmail();
    const result = {
      sent: 1,
      failed: 0,
      results: [{ email: 'sarah@x.org', success: true }],
      skippedPlaceholders: [],
      attached: true,
      calendarAttached: true,
    };
    const onSend = vi.fn().mockResolvedValue(result);
    const view = render(<EmailSchedulesPanel sheet={sheet} activeDay={day} onSend={onSend} onClose={vi.fn()} />);

    const button = screen.getByTestId('send-schedules-button');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByTestId('attachment-note')).toHaveTextContent(/calendar file/i);

    view.unmount();
    const onSendNoCal = vi.fn().mockResolvedValue({ ...result, calendarAttached: false });
    render(<EmailSchedulesPanel sheet={sheet} activeDay={day} onSend={onSendNoCal} onClose={vi.fn()} />);
    const button2 = screen.getByTestId('send-schedules-button');
    fireEvent.click(button2);
    fireEvent.click(button2);
    expect(await screen.findByTestId('attachment-note')).not.toHaveTextContent(/calendar file/i);
  });

  // ───────────────────── day rail: arbitrary day selection ─────────────────────
  // openspec change scheduling-sheet-approver-editing-and-scoped-sharing,
  // capability scheduling-sheet-scoped-distribution. Scope used to be two radio
  // buttons (this day / every day); it is now a checkbox per day, so a send can
  // cover any subset.

  it('SEP-10: the rail lists every day and starts on the active day alone', () => {
    const { sheet, d1 } = buildMultiDaySheet();
    render(<EmailSchedulesPanel sheet={sheet} activeDay={d1} onSend={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByTestId('day-option-d1')).toBeChecked();
    expect(screen.getByTestId('day-option-d2')).not.toBeChecked();
    expect(screen.getByTestId('day-option-d3')).not.toBeChecked();

    // The roster is derived from the selection, so only day one's person shows.
    expect(screen.getByTestId('recipient-sarah@x.org')).toBeInTheDocument();
    expect(screen.queryByTestId('recipient-miriam@x.org')).toBeNull();
  });

  it('SEP-11: nonconsecutive days recompute the roster and send exactly those days', () => {
    const { sheet, d1 } = buildMultiDaySheet();
    const onSend = resolvedSend();
    render(<EmailSchedulesPanel sheet={sheet} activeDay={d1} onSend={onSend} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('day-option-d3'));

    // Day three brings Ben in; day two was never selected, so Miriam stays out.
    expect(screen.getByTestId('recipient-ben@x.org')).toBeInTheDocument();
    expect(screen.queryByTestId('recipient-miriam@x.org')).toBeNull();

    const button = screen.getByTestId('send-schedules-button');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ dayIds: ['d1', 'd3'] }));
  });

  it('SEP-12: All selects every day; None clears it and disables sending', () => {
    const { sheet, d1 } = buildMultiDaySheet();
    render(<EmailSchedulesPanel sheet={sheet} activeDay={d1} onSend={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('days-all'));
    expect(screen.getByTestId('day-option-d2')).toBeChecked();
    expect(screen.getByTestId('recipient-miriam@x.org')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('days-none'));
    expect(screen.getByTestId('day-option-d1')).not.toBeChecked();
    // An empty selection must never fall through to sending everybody.
    expect(screen.getByTestId('send-schedules-button')).toBeDisabled();
  });

  it('SEP-13: changing the day selection restores every eligible recipient', () => {
    const { sheet, d1 } = buildMultiDaySheet();
    render(<EmailSchedulesPanel sheet={sheet} activeDay={d1} onSend={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('days-all'));
    fireEvent.click(screen.getByTestId('recipient-toggle-sarah@x.org'));
    expect(screen.getByTestId('recipient-toggle-sarah@x.org')).not.toBeChecked();

    // A different roster invalidates a selection made against the old one, so
    // the deselection is dropped rather than silently carried across.
    fireEvent.click(screen.getByTestId('day-option-d2'));
    expect(screen.getByTestId('recipient-toggle-sarah@x.org')).toBeChecked();
  });

  it('SEP-14: changing anything after arming requires a fresh first click', () => {
    const { sheet, d1 } = buildMultiDaySheet();
    const onSend = resolvedSend();
    render(<EmailSchedulesPanel sheet={sheet} activeDay={d1} onSend={onSend} onClose={vi.fn()} />);

    const button = screen.getByTestId('send-schedules-button');
    fireEvent.click(button);
    expect(button).toHaveTextContent(/confirm/i);

    fireEvent.click(screen.getByTestId('day-option-d3'));
    expect(button).not.toHaveTextContent(/confirm/i);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('SEP-15: the send carries a version snapshot for exactly the selected days', () => {
    const { sheet, d1 } = buildMultiDaySheet();
    const onSend = resolvedSend();
    render(<EmailSchedulesPanel sheet={sheet} activeDay={d1} onSend={onSend} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('day-option-d3'));
    const button = screen.getByTestId('send-schedules-button');
    fireEvent.click(button);
    fireEvent.click(button);

    // Unselected day two must be absent: the server requires an entry for every
    // selected day and rejects a partial map (SE-41).
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ expectedDayVersions: { d1: 3, d3: 7 } })
    );
  });

  it('SEP-16: the PDF attachment defaults on and can be turned off independently', () => {
    const { sheet, d1 } = buildMultiDaySheet();
    const onSend = resolvedSend();
    render(<EmailSchedulesPanel sheet={sheet} activeDay={d1} onSend={onSend} onClose={vi.fn()} />);

    expect(screen.getByTestId('include-pdf')).toBeChecked();
    fireEvent.click(screen.getByTestId('include-pdf'));

    const button = screen.getByTestId('send-schedules-button');
    fireEvent.click(button);
    fireEvent.click(button);
    // The calendar file is a separate decision and stays on.
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ includePdf: false, includeCalendar: true })
    );
  });

  // ───────────────────── editable subject line ─────────────────────
  // Every recipient of one send shares a subject, and it used to be derived
  // purely from scope — so two sends from the same workbook were
  // indistinguishable in an inbox. It is now prefilled and editable.

  it('SEP-17: the subject is prefilled from the template and follows the day selection', () => {
    const { sheet, d1 } = buildMultiDaySheet();
    render(<EmailSchedulesPanel sheet={sheet} activeDay={d1} onSend={vi.fn()} onClose={vi.fn()} />);

    // One day is named by its own date, as a single-day send always has been.
    expect(screen.getByTestId('email-subject-input')).toHaveValue(
      'Your assignments for Saturday, September 11, 2027'
    );

    // Adding a day changes the subject, which is the whole point: a subset send
    // must not look identical to any other send from this workbook.
    fireEvent.click(screen.getByTestId('day-option-d3'));
    expect(screen.getByTestId('email-subject-input')).toHaveValue(
      'Your assignments for 2027 High Holy Days — Sep 11 & Sep 20'
    );
  });

  // Failures used to print the raw Graph payload as the row text — a wall of
  // red JSON that also crushed the address to an ellipsis. The row now carries
  // a phrase keyed on the server's reason code; the payload goes to the console.
  it('SEP-20: a failed row keeps its address, says why in words, and sends the raw error to the console', async () => {
    const { sheet, d1 } = buildMultiDaySheet();
    const raw = 'Graph API error: 429 - {"error":{"code":"ApplicationThrottled","message":"Application is over its MailboxConcurrency limit."}}';
    const onSend = vi.fn().mockResolvedValue({
      sent: 0,
      failed: 1,
      results: [{ email: 'sarah@x.org', success: false, reason: 'throttled', error: raw }],
      skippedPlaceholders: [],
    });
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    render(<EmailSchedulesPanel sheet={sheet} activeDay={d1} onSend={onSend} onClose={vi.fn()} />);

    const button = screen.getByTestId('send-schedules-button');
    fireEvent.click(button);
    fireEvent.click(button);

    const row = within(await screen.findByTestId('send-results')).getByTestId('result-sarah@x.org');
    expect(row).toHaveTextContent('sarah@x.org');
    expect(row).toHaveTextContent(/Mail server was too busy/);
    expect(row).not.toHaveTextContent(/ApplicationThrottled/);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warnSpy.mock.calls[0])).toContain('ApplicationThrottled');
    warnSpy.mockRestore();
  });

  it('SEP-21: the summary groups failures by reason instead of listing payloads', async () => {
    const { sheet, d3 } = buildMultiDaySheet();
    const onSend = vi.fn().mockResolvedValue({
      sent: 0,
      failed: 2,
      results: [
        { email: 'sarah@x.org', success: false, reason: 'throttled', error: 'x' },
        { email: 'ben@x.org', success: false, reason: 'rejected', error: 'y' },
      ],
      skippedPlaceholders: [],
    });
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    render(<EmailSchedulesPanel sheet={sheet} activeDay={d3} onSend={onSend} onClose={vi.fn()} />);
    const button = screen.getByTestId('send-schedules-button');
    fireEvent.click(button);
    fireEvent.click(button);

    const summary = within(await screen.findByTestId('send-results')).getByTestId('failure-summary');
    expect(summary).toHaveTextContent(/mail server too busy \(1\)/i);
    expect(summary).toHaveTextContent(/address rejected \(1\)/i);
  });

  it('SEP-22: "try again" pre-selects exactly the failed people and returns to the form', async () => {
    const { sheet, d3 } = buildMultiDaySheet();
    const onSend = vi.fn().mockResolvedValue({
      sent: 1,
      failed: 1,
      results: [
        { email: 'sarah@x.org', success: true },
        { email: 'ben@x.org', success: false, reason: 'throttled', error: 'x' },
      ],
      skippedPlaceholders: [],
    });
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    render(<EmailSchedulesPanel sheet={sheet} activeDay={d3} onSend={onSend} onClose={vi.fn()} />);
    const button = screen.getByTestId('send-schedules-button');
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByTestId('send-results');

    fireEvent.click(screen.getByTestId('retry-failed-button'));
    // Back on the form, with only Ben selected.
    expect(screen.queryByTestId('send-results')).toBeNull();
    expect(screen.getByTestId('email-schedules-panel')).toHaveTextContent(/1 of 2 selected/);

    const again = screen.getByTestId('send-schedules-button');
    expect(again).toHaveTextContent('Email 1 person');
    fireEvent.click(again);
    fireEvent.click(again);
    expect(onSend).toHaveBeenLastCalledWith(expect.objectContaining({ recipients: ['ben@x.org'] }));
  });

  it('SEP-18: an edited subject survives a day change and is what gets sent', () => {
    const { sheet, d1 } = buildMultiDaySheet();
    const onSend = resolvedSend();
    render(<EmailSchedulesPanel sheet={sheet} activeDay={d1} onSend={onSend} onClose={vi.fn()} />);

    const input = screen.getByTestId('email-subject-input');
    fireEvent.change(input, { target: { value: 'Erev RH posts - please confirm' } });

    // Deliberate wording must not be silently overwritten by a recomputed
    // default the moment the selection changes.
    fireEvent.click(screen.getByTestId('day-option-d3'));
    expect(input).toHaveValue('Erev RH posts - please confirm');

    const button = screen.getByTestId('send-schedules-button');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Erev RH posts - please confirm' })
    );
  });

  it('SEP-19: clearing the subject blocks the send, and editing it re-arms the confirm', () => {
    const { sheet, d1 } = buildMultiDaySheet();
    const onSend = resolvedSend();
    render(<EmailSchedulesPanel sheet={sheet} activeDay={d1} onSend={onSend} onClose={vi.fn()} />);

    const button = screen.getByTestId('send-schedules-button');
    fireEvent.click(button);
    expect(button).toHaveTextContent(/confirm/i);

    // The armed button described a send whose subject has since changed.
    const input = screen.getByTestId('email-subject-input');
    fireEvent.change(input, { target: { value: 'Something else' } });
    expect(button).not.toHaveTextContent(/confirm/i);

    // An empty subject is not a subject; sending an empty header is worse than
    // refusing to send.
    fireEvent.change(input, { target: { value: '   ' } });
    expect(button).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });
});
