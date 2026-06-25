// RoomReservationForm — marker advisory wiring.
//
// Regression test: the soft warnOnReservation advisory must appear in the
// NEW-REQUEST creation form (RoomReservationForm), not only in the review/edit
// modal (UnifiedEventForm). Previously the advisory was wired only into
// UnifiedEventForm, so a requester booking a room on a holiday/closure day saw
// no warning.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { withQueryClient } from '../../__helpers__/queryClientWrapper';

vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));
vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ token: undefined }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null }),
}));
vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({ accounts: [] }),
}));
vi.mock('../../../components/shared/DraftSaveDialog', () => ({
  default: () => null,
}));

// Stub the heavy base form: expose a button that simulates the user picking a
// date by firing onDataChange with the selected startDate (the same contract
// the real base form uses).
vi.mock('../../../components/RoomReservationFormBase', () => ({
  default: ({ onDataChange, onFormDataRef }) => {
    if (onFormDataRef) onFormDataRef(() => ({ requestedRooms: [], eventTitle: '' }));
    return (
      <button
        type="button"
        data-testid="pick-holiday-date"
        onClick={() => onDataChange && onDataChange({ startDate: '2026-12-25' })}
      >
        pick date
      </button>
    );
  },
}));

const warnMarker = {
  _id: 'w1', type: 'officeClosed', name: 'Office Closed',
  startDate: '2026-12-24', endDate: '2026-12-26', warnOnReservation: true,
};

const mockMarkers = (markers) => {
  global.fetch = vi.fn(async (url) => {
    if (typeof url === 'string' && url.endsWith('/calendar-markers')) {
      return { ok: true, json: async () => markers };
    }
    return { ok: true, json: async () => [] };
  });
};

import RoomReservationForm from '../../../components/RoomReservationForm';

describe('RoomReservationForm — marker advisory', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the warnOnReservation advisory after the user selects a flagged date', async () => {
    mockMarkers([warnMarker]);
    render(<RoomReservationForm apiToken="tok" isPublic={false} />, { wrapper: withQueryClient() });

    // No advisory before a date is chosen.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('pick-holiday-date'));

    const advisory = await screen.findByRole('status');
    expect(advisory).toHaveTextContent(/Office Closed: Office Closed/);
    expect(advisory).toHaveTextContent(/can still submit/i);
  });
});
