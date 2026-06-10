import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import MonthView from '../../../components/MonthView';
import { TimezoneProvider } from '../../../context/TimezoneContext';
import { buildMarkersByDate } from '../../../utils/calendarMarkers';

// A fixed week: Sun 2026-09-13 .. Sat 2026-09-19 (so we can place markers on
// known cells). One of these is "today" only if the test clock matches, so we
// assert the today-highlight separately using an injected today cell.
const WEEK = [
  '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19',
].map((iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return { date: new Date(y, m - 1, d), isCurrentMonth: true };
});

const noop = () => {};
const baseProps = {
  getMonthWeeks: () => [WEEK],
  getWeekdayHeaders: () => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  filteredEvents: [],
  getCategoryColor: () => '#3b6eb8',
  getLocationColor: () => '#3b6eb8',
  formatEventTime: () => '',
  handleEventClick: noop,
  handleDayCellClick: noop,
  canAddEvent: false,
  selectedDay: null,
  onDaySelect: noop,
};

const renderMonth = (markers) =>
  render(
    <TimezoneProvider>
      <MonthView {...baseProps} markersByDate={buildMarkersByDate(markers)} />
    </TimezoneProvider>
  );

describe('MonthView marker ribbon', () => {
  it('renders a gold holiday ribbon with the marker name', () => {
    renderMonth([{ _id: 'h', type: 'holiday', name: 'Sukkot', startDate: '2026-09-14', endDate: '2026-09-14' }]);
    const ribbon = screen.getByText('Sukkot').closest('.marker-ribbon');
    expect(ribbon).toBeInTheDocument();
    expect(ribbon).toHaveClass('marker-ribbon--holiday');
  });

  it('renders a red office-closed ribbon', () => {
    renderMonth([{ _id: 'c', type: 'officeClosed', name: 'Closed', startDate: '2026-09-15', endDate: '2026-09-15' }]);
    const ribbon = screen.getByText('Closed').closest('.marker-ribbon');
    expect(ribbon).toHaveClass('marker-ribbon--closed');
  });

  it('repeats the ribbon across every day of a multi-day span', () => {
    renderMonth([{ _id: 'm', type: 'holiday', name: 'Festival', startDate: '2026-09-14', endDate: '2026-09-16' }]);
    // 3 days in the span → 3 ribbons
    expect(screen.getAllByText('Festival')).toHaveLength(3);
  });

  it('renders both ribbons when a day carries two markers', () => {
    renderMonth([
      { _id: 'h', type: 'holiday', name: 'Holiday A', startDate: '2026-09-17', endDate: '2026-09-17' },
      { _id: 'c', type: 'officeClosed', name: 'Closure B', startDate: '2026-09-17', endDate: '2026-09-17' },
    ]);
    expect(screen.getByText('Holiday A')).toBeInTheDocument();
    expect(screen.getByText('Closure B')).toBeInTheDocument();
  });

  it('preserves the "today" highlight on a marked day', () => {
    // Build a week whose middle cell is actually today, then mark that day.
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const iso = `${y}-${m}-${d}`;
    const todayWeek = [{ date: new Date(y, today.getMonth(), today.getDate()), isCurrentMonth: true }];

    render(
      <TimezoneProvider>
        <MonthView
          {...baseProps}
          getMonthWeeks={() => [todayWeek]}
          markersByDate={buildMarkersByDate([{ _id: 't', type: 'holiday', name: 'MarkedToday', startDate: iso, endDate: iso }])}
        />
      </TimezoneProvider>
    );

    const ribbon = screen.getByText('MarkedToday').closest('.marker-ribbon');
    const cell = ribbon.closest('.day-cell');
    expect(cell).toHaveClass('current-day'); // today highlight intact
    expect(within(cell).getByText('MarkedToday')).toBeInTheDocument();
  });

  it('renders the ribbon as the first child of the day cell (above the date)', () => {
    renderMonth([{ _id: 'h', type: 'holiday', name: 'TopRibbon', startDate: '2026-09-14', endDate: '2026-09-14' }]);
    const cell = screen.getByText('TopRibbon').closest('.day-cell');
    expect(cell.firstElementChild).toHaveClass('marker-ribbon-stack');
  });
});
