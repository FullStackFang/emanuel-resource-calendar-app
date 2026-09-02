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
import { render, screen, fireEvent, within } from '@testing-library/react';

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

  const renderGrid = ({ day = buildDay(), live } = {}) => {
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
        publishedEvents={[]}
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
