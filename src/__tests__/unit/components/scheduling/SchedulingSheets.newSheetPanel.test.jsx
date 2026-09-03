// SchedulingSheets.newSheetPanel.test.jsx
//
// The New Scheduling Sheet panel's seed-date affordance. It was a stack of
// <input type="date"> plus '+ Add another date'; it is now SeedDatePicker — two
// months side by side (holiday spans straddle a month boundary) with the picked
// days rendered below as the day-tab pills they become.
//
// The non-obvious property here is ORDER. The old stacked inputs were
// top-to-bottom chronological by construction; a calendar is not, and
// `copyFromSheetId` copies the source workbook's columns onto the seeded dates
// IN ORDER. So the sent payload must be sorted, or a copied workbook lands its
// day tabs against the wrong dates (SSNP-3).
//
// Test IDs: SSNP-1 to SSNP-5

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { withQueryClient } from '../../../__helpers__/queryClientWrapper';

vi.mock('../../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api', CALENDAR_CONFIG: { DEFAULT_MODE: 'sandbox', SANDBOX_CALENDAR: 'sandbox@x.org', PRODUCTION_CALENDAR: 'prod@x.org' } },
}));
vi.mock('../../../../utils/logger', () => ({
  logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../../../utils/logger.js', () => ({
  logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: 'token' }),
}));
vi.mock('../../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess: vi.fn(), showWarning: vi.fn(), showError: vi.fn() }),
}));
vi.mock('../../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ isAdmin: true, canManageAssignments: true }),
}));
vi.mock('../../../../hooks/useLocationsQuery', () => ({
  useLocationsQuery: () => ({ data: [] }),
}));
vi.mock('../../../../components/shared/LoadingSpinner', () => ({
  default: () => <div data-testid="loading-spinner" />,
}));

const noopMutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
let createSheetMutation;
vi.mock('../../../../hooks/useSchedulingSheets', () => ({
  useSchedulingSheetList: () => ({ data: [], isPending: false, isFetching: false, isError: false, refetch: vi.fn() }),
  useSchedulingSheet: () => ({ data: null, isPending: false, isFetching: false, refetch: vi.fn() }),
  useSheetUserLookup: () => ({ data: [] }),
  useSchedulingSheetMutations: () => ({
    createSheet: createSheetMutation,
    renameSheet: noopMutation(),
    deleteSheet: noopMutation(),
    createDay: noopMutation(),
    deleteDay: noopMutation(),
    updateStructure: noopMutation(),
    updateCell: noopMutation(),
    sendSchedules: noopMutation(),
  }),
}));

import SchedulingSheets from '../../../../components/scheduling/SchedulingSheets';

// An empty workbook list auto-opens the creation panel (design D8 #7), so the
// panel is on screen without any extra interaction.
function renderPanel() {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  return render(
    <MemoryRouter>
      <SchedulingSheets />
    </MemoryRouter>,
    { wrapper: withQueryClient() }
  );
}

// react-datepicker opens on the current month when nothing is selected, so a
// day-of-month class is stable regardless of when the suite runs. The
// :not(--outside-month) qualifier matters: the leading/trailing weeks of the
// grid carry the neighbouring months' day numbers under the same classes.
// Two months render, so a day-of-month class matches twice. The first match is
// the left (current) month; :not(--outside-month) drops the padding days the
// neighbouring months contribute under the same classes.
const dayCell = (container, dom) =>
  container.querySelector(`.react-datepicker__day--${dom}:not(.react-datepicker__day--outside-month)`);

function fillName(name = '2099 High Holy Days') {
  fireEvent.change(screen.getByTestId('new-sheet-name'), { target: { value: name } });
}

describe('SchedulingSheets — New Scheduling Sheet panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSheetMutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
  });

  it('SSNP-1: seed dates are picked on a two-month calendar, not a stack of date inputs', () => {
    const { container } = renderPanel();

    const panel = screen.getByTestId('new-sheet-panel');
    expect(screen.getByTestId('seed-date-picker')).toBeInTheDocument();
    // Two months so a holiday span crossing a month boundary needs no paging.
    expect(container.querySelectorAll('.react-datepicker__month-container')).toHaveLength(2);
    expect(panel.querySelectorAll('input[type="date"]')).toHaveLength(0);
    expect(screen.queryByText(/Add another date/i)).not.toBeInTheDocument();
  });

  it('SSNP-2: clicking a day selects it and clicking it again toggles it back off', () => {
    const { container } = renderPanel();

    fireEvent.click(dayCell(container, '012'));
    expect(screen.getByText(/1 day tab/)).toBeInTheDocument();
    expect(screen.getByTestId('seed-date-strip').children).toHaveLength(1);

    fireEvent.click(dayCell(container, '012'));
    expect(screen.queryByTestId('seed-date-strip')).not.toBeInTheDocument();
  });

  it('SSNP-5: a picked day renders as a day-tab pill that removes itself when clicked', () => {
    const { container } = renderPanel();

    fireEvent.click(dayCell(container, '012'));
    fireEvent.click(dayCell(container, '020'));
    expect(screen.getByText(/2 day tabs/)).toBeInTheDocument();

    const [firstPill] = screen.getByTestId('seed-date-strip').children;
    // The pill is the workbook's own day-tab chrome, so the preview and the
    // thing being previewed cannot drift apart.
    expect(firstPill).toHaveClass('ss-tab');
    fireEvent.click(firstPill);

    expect(screen.getByText(/1 day tab/)).toBeInTheDocument();
    expect(screen.getByTestId('seed-date-strip').children).toHaveLength(1);
  });

  it('SSNP-3: seed dates are sent chronologically even when picked out of order', () => {
    const { container } = renderPanel();

    fillName();
    fireEvent.click(dayCell(container, '020'));
    fireEvent.click(dayCell(container, '005'));
    fireEvent.click(dayCell(container, '012'));
    expect(screen.getByText(/3 day tabs/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('create-sheet-button'));

    const [payload] = createSheetMutation.mutate.mock.calls[0];
    expect(payload.name).toBe('2099 High Holy Days');
    expect(payload.seedDates).toHaveLength(3);
    expect(payload.seedDates).toEqual([...payload.seedDates].sort());
    expect(payload.seedDates.map((d) => d.slice(-2))).toEqual(['05', '12', '20']);
  });

  it('SSNP-4: creating with no day picked sends an empty seedDates array', () => {
    renderPanel();

    fillName('Blank workbook');
    fireEvent.click(screen.getByTestId('create-sheet-button'));

    const [payload] = createSheetMutation.mutate.mock.calls[0];
    expect(payload.seedDates).toEqual([]);
  });
});
