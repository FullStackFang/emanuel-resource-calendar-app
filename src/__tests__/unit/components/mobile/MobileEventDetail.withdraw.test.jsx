// src/__tests__/unit/components/mobile/MobileEventDetail.withdraw.test.jsx
//
// The detail sheet's first (and only) mutating action: withdrawing your own
// pending reservation request.
//
// Two things are load-bearing here and are asserted rather than assumed:
//  1. The gate. Withdraw exists for exactly one combination — viewer is the
//     requester AND status is pending — and for no other. A destructive action
//     that leaks one status sideways is the whole risk of adding it.
//  2. The 409. A version conflict on a phone is one sentence and a refetch,
//     deliberately NOT the desktop ConflictDialog's field-level diff.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { __resetBackDismissForTests } from '../../../../hooks/useBackDismiss';

vi.mock('../../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

vi.mock('../../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), log: vi.fn() },
}));

vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: 'tok' }),
}));

vi.mock('../../../../hooks/useScrollLock', () => ({ default: vi.fn() }));
vi.mock('../../../../hooks/useFloorPlan', () => ({
  default: () => ({ floorPlanUrl: null, fileName: '' }),
}));

let currentAccounts = [{ username: 'requester@test.com' }];
vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({ accounts: currentAccounts }),
}));

const showSuccess = vi.fn();
const showError = vi.fn();
const showWarning = vi.fn();
vi.mock('../../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess, showError, showWarning }),
}));

let currentAuthFetch = vi.fn();
vi.mock('../../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => currentAuthFetch,
}));

import MobileEventDetail from '../../../../components/mobile/MobileEventDetail';

const pendingRequest = {
  _id: 'mongo-1',
  eventId: 'evt-1',
  eventTitle: 'Board Meeting',
  status: 'pending',
  startDate: '2026-08-04',
  requesterEmail: 'requester@test.com',
  _version: 3,
  statusHistory: [],
};

const WITHDRAW_BUTTON = /withdraw request/i;
const CONFIRM_BUTTON = /confirm withdrawal\?/i;

function renderSheet(event, props = {}) {
  return render(
    <MobileEventDetail
      event={event}
      onClose={() => {}}
      showReservationContext
      {...props}
    />
  );
}

// useBackDismiss keeps module-level bookkeeping and retires its history marker
// asynchronously (see MobileEventDetail.test.jsx).
beforeEach(() => {
  vi.clearAllMocks();
  __resetBackDismissForTests();
  currentAccounts = [{ username: 'requester@test.com' }];
  currentAuthFetch = vi.fn();
});
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
});

describe('MobileEventDetail — withdraw gate', () => {
  // MW-1: the one case that earns the action.
  it('MW-1: offers Withdraw for the viewer’s own pending request', () => {
    renderSheet(pendingRequest);
    expect(screen.getByRole('button', { name: WITHDRAW_BUTTON })).toBeInTheDocument();
  });

  // MW-2: every other status. A withdrawn-then-published request must not
  // remain withdrawable, and a rejected one is already resolved.
  it.each(['published', 'rejected', 'draft', 'deleted'])(
    'MW-2: offers no Withdraw when status is %s',
    (status) => {
      renderSheet({ ...pendingRequest, status });
      expect(screen.queryByRole('button', { name: WITHDRAW_BUTTON })).not.toBeInTheDocument();
    }
  );

  // MW-3: someone else's pending request. The endpoint would 403 anyway; the
  // UI must not offer a button the server will refuse.
  it('MW-3: offers no Withdraw on another user’s pending request', () => {
    renderSheet({ ...pendingRequest, requesterEmail: 'someone.else@test.com' });
    expect(screen.queryByRole('button', { name: WITHDRAW_BUTTON })).not.toBeInTheDocument();
  });

  // MW-4: the agenda entry point renders the same component without
  // reservation context, and stays entirely read-only.
  it('MW-4: offers no Withdraw without showReservationContext', () => {
    render(<MobileEventDetail event={pendingRequest} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: WITHDRAW_BUTTON })).not.toBeInTheDocument();
  });
});

describe('MobileEventDetail — withdraw flow', () => {
  // MW-5: first tap arms, it does not submit. No window.confirm anywhere.
  it('MW-5: first tap arms the confirm state without calling the API', () => {
    renderSheet(pendingRequest);

    fireEvent.click(screen.getByRole('button', { name: WITHDRAW_BUTTON }));

    expect(screen.getByRole('button', { name: CONFIRM_BUTTON })).toBeInTheDocument();
    expect(currentAuthFetch).not.toHaveBeenCalled();
    // Armed but unusable until a reason is given — the approver needs to know why.
    expect(screen.getByRole('button', { name: CONFIRM_BUTTON })).toBeDisabled();
  });

  // MW-6: the happy path — DELETE with reason + _version, success toast, and
  // the owner is told to close and refetch.
  it('MW-6: second tap submits, shows a success toast, and notifies the owner', async () => {
    currentAuthFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) });
    const onWithdrawn = vi.fn();
    renderSheet(pendingRequest, { onWithdrawn });

    fireEvent.click(screen.getByRole('button', { name: WITHDRAW_BUTTON }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'No longer needed' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: CONFIRM_BUTTON }));
    });

    expect(currentAuthFetch).toHaveBeenCalledTimes(1);
    const [url, options] = currentAuthFetch.mock.calls[0];
    expect(url).toContain('/admin/events/mongo-1');
    expect(options.method).toBe('DELETE');
    expect(JSON.parse(options.body)).toEqual({ reason: 'No longer needed', _version: 3 });

    expect(showSuccess).toHaveBeenCalledWith('Request withdrawn');
    expect(onWithdrawn).toHaveBeenCalledTimes(1);
  });

  // MW-7: the button is disabled while the call is in flight, so a double-tap
  // cannot fire two DELETEs.
  it('MW-7: the button reads "Withdrawing..." and is disabled during the call', async () => {
    let release;
    currentAuthFetch = vi.fn().mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ ok: true, status: 200, json: async () => ({}) }); })
    );
    renderSheet(pendingRequest, { onWithdrawn: vi.fn() });

    fireEvent.click(screen.getByRole('button', { name: WITHDRAW_BUTTON }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Changed plans' } });
    fireEvent.click(screen.getByRole('button', { name: CONFIRM_BUTTON }));

    const button = await screen.findByRole('button', { name: /withdrawing\.\.\./i });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(currentAuthFetch).toHaveBeenCalledTimes(1);

    await act(async () => { release(); });
  });

  // MW-8: a version conflict is reported as a plain outcome. No diff, no
  // multi-mode dialog — the list refetch shows the new truth.
  it('MW-8: a 409 VERSION_CONFLICT reports "already handled" without a diff view', async () => {
    currentAuthFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'VersionConflict',
        details: { code: 'VERSION_CONFLICT', currentStatus: 'published', currentVersion: 4 },
      }),
    });
    const onWithdrawn = vi.fn();
    renderSheet(pendingRequest, { onWithdrawn });

    fireEvent.click(screen.getByRole('button', { name: WITHDRAW_BUTTON }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Not needed' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: CONFIRM_BUTTON }));
    });

    expect(showWarning).toHaveBeenCalledWith(expect.stringMatching(/already handled/i));
    expect(showError).not.toHaveBeenCalled();
    // The sheet closes and the list refetches via the owner.
    expect(onWithdrawn).toHaveBeenCalledTimes(1);
    // Nothing resembling the desktop conflict dialog is rendered.
    expect(screen.queryByText(/current version/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // MW-9: any other failure returns the button to idle so the user can retry,
  // rather than stranding it in a confirm or loading state.
  it('MW-9: a non-conflict failure shows an error toast and returns to idle', async () => {
    currentAuthFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const onWithdrawn = vi.fn();
    renderSheet(pendingRequest, { onWithdrawn });

    fireEvent.click(screen.getByRole('button', { name: WITHDRAW_BUTTON }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Oops' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: CONFIRM_BUTTON }));
    });

    expect(showError).toHaveBeenCalled();
    expect(onWithdrawn).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: WITHDRAW_BUTTON })).toBeEnabled();
    });
  });

  // MW-10: the confirm state must not survive into a different event. A
  // recycled sheet reopening armed would point a destructive action at a
  // request the user never looked at.
  it('MW-10: switching events clears a primed confirm state', async () => {
    const { rerender } = renderSheet(pendingRequest);
    fireEvent.click(screen.getByRole('button', { name: WITHDRAW_BUTTON }));
    expect(screen.getByRole('button', { name: CONFIRM_BUTTON })).toBeInTheDocument();

    rerender(
      <MobileEventDetail
        event={{ ...pendingRequest, _id: 'mongo-2', eventId: 'evt-2', eventTitle: 'Other Request' }}
        onClose={() => {}}
        showReservationContext
      />
    );

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: CONFIRM_BUTTON })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: WITHDRAW_BUTTON })).toBeInTheDocument();
  });
});

describe('MobileEventDetail — reservation context', () => {
  // MW-11: the timeline is the piece that is genuinely better on a phone than
  // in the desktop modal, which buries statusHistory.
  it('MW-11: renders statusHistory as a chronological timeline with actor and time', () => {
    renderSheet({
      ...pendingRequest,
      statusHistory: [
        { status: 'pending', changedAt: '2026-08-01T15:30:00Z', changedByEmail: 'requester@test.com', reason: 'Submitted' },
        { status: 'draft', changedAt: '2026-07-30T12:00:00Z', changedByEmail: 'requester@test.com', reason: 'Draft created' },
      ],
    });

    expect(screen.getByText('Review History')).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByText('Draft created')).toBeInTheDocument();

    // Oldest first — a timeline is read downward in time.
    const entries = screen.getAllByRole('listitem');
    expect(entries[0]).toHaveTextContent('Draft');
    expect(entries[1]).toHaveTextContent('Pending');
  });

  // MW-12: rejection reason is the first thing in the body, above timing.
  it('MW-12: surfaces the rejection reason for a rejected request', () => {
    renderSheet({
      ...pendingRequest,
      status: 'rejected',
      reviewNotes: 'Room already booked for the gala',
      setupTime: '09:00',
    });

    expect(screen.getByText('Reason for rejection')).toBeInTheDocument();
    const reason = screen.getByText('Room already booked for the gala');
    const timing = screen.getByText('Timing');
    // Node.DOCUMENT_POSITION_FOLLOWING === 4: `timing` comes after `reason`.
    expect(reason.compareDocumentPosition(timing) & 4).toBeTruthy();
  });

  // MW-13: no reservation context leaks into the agenda's read-only sheet.
  it('MW-13: renders no timeline without showReservationContext', () => {
    render(
      <MobileEventDetail
        event={{ ...pendingRequest, statusHistory: [{ status: 'pending', changedAt: '2026-08-01T15:30:00Z' }] }}
        onClose={() => {}}
      />
    );
    expect(screen.queryByText('Review History')).not.toBeInTheDocument();
  });
});
