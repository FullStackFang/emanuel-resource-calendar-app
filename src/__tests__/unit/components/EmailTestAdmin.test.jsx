import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import EmailTestAdmin from '../../../components/EmailTestAdmin';

vi.mock('react-quill-new', () => ({ default: ({ value, onChange }) => <textarea aria-label="Email body" value={value} onChange={e => onChange(e.target.value)} /> }));
vi.mock('../../../context/NotificationContext', () => ({ useNotification: () => ({ showSuccess: vi.fn(), showWarning: vi.fn() }) }));
const templates = [
  { id: 'submission-confirmation', name: 'Submission Confirmation', description: 'Sent after a new reservation', subject: 'Received', body: 'Original', variables: ['eventTitle'] },
  { id: 'admin-new-request', name: 'Admin New Request Alert', description: 'Sent to administrators', subject: 'New request', body: 'Admin body', isCustomized: true },
  { id: 'assignment-schedule', name: 'Scheduling Sheet Assignments', description: 'Personal itinerary', subject: 'Schedule', body: 'Schedule body' },
];
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async url => ({ ok: true, json: async () => url.endsWith('/templates') ? { templates } : {} }))));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function openTemplates() {
  render(<EmailTestAdmin apiToken="test" />);
  fireEvent.click(screen.getByRole('button', { name: 'Email Templates', exact: true }));
  await screen.findByRole('button', { name: 'Submission Confirmation', exact: true });
}
describe('Email template sidebar', () => {
  it('searches descriptions and combines workflow and customized filters', async () => {
    await openTemplates();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'itinerary' } });
    expect(screen.getByRole('button', { name: 'Scheduling Sheet Assignments' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submission Confirmation' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Workflow'), { target: { value: 'Reservations' } });
    fireEvent.click(screen.getByLabelText('Customized only'));
    expect(screen.getByRole('button', { name: /Admin New Request Alert/ })).toBeInTheDocument();
    expect(screen.getByText('1 of 3 templates')).toBeInTheDocument();
  });
  it('keeps the editor and draft when filters hide the selection, with clear-filter recovery', async () => {
    await openTemplates();
    fireEvent.click(screen.getByRole('button', { name: 'Submission Confirmation' }));
    fireEvent.change(screen.getByLabelText('Subject Line'), { target: { value: 'My draft' } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no match' } });
    expect(screen.getByLabelText('Subject Line')).toHaveValue('My draft');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('3 of 3 templates')).toBeInTheDocument();
    expect(screen.getByLabelText('Subject Line')).toHaveValue('My draft');
  });
  it('retains drafts across template selection and resets confirmation for a different template', async () => {
    await openTemplates();
    fireEvent.click(screen.getByRole('button', { name: /Admin New Request Alert/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Default' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submission Confirmation' }));
    expect(screen.queryByRole('button', { name: 'Confirm?' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Subject Line'), { target: { value: 'My draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Scheduling Sheet Assignments' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submission Confirmation' }));
    expect(screen.getByLabelText('Subject Line')).toHaveValue('My draft');
  });
});

