/**
 * EmailTemplateEditor (ETE-1..10) — the ONE template editor, shared by Email
 * Management and the Email Schedules panel.
 * openspec/changes/schedule-email-template-editing (D4, D9).
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import EmailTemplateEditor from '../../../../components/shared/EmailTemplateEditor';

vi.mock('react-quill-new', () => ({
  default: ({ value, onChange }) => (
    <textarea aria-label="Email body" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
const showSuccess = vi.fn();
const showError = vi.fn();
vi.mock('../../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess, showError, showWarning: vi.fn() }),
}));

const TEMPLATE = {
  id: 'assignment-schedule',
  name: 'Scheduling Sheet Assignments',
  description: 'Personal itinerary',
  subject: 'Your schedule',
  body: '<p>Hello {{recipientName}}</p>',
  variables: ['recipientName', 'assignmentsTable'],
  isCustomized: true,
  updatedAt: '2026-09-01T10:00:00.000Z',
  updatedBy: 'approver@x.org',
};

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  showSuccess.mockReset();
  showError.mockReset();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const renderEditor = (props = {}) =>
  render(<EmailTemplateEditor apiToken="tok" template={TEMPLATE} {...props} />);

describe('EmailTemplateEditor', () => {
  it('ETE-1 read-only mode renders the message with no editor controls', () => {
    renderEditor({ readOnly: true });
    expect(screen.queryByLabelText('Subject Line')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Email body')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reset/ })).not.toBeInTheDocument();
    const frame = screen.getByTitle('Email message');
    expect(frame.getAttribute('srcdoc')).toContain('Hello {{recipientName}}');
    // No scripts, opaque origin: approver-authored HTML never runs in the app.
    expect(frame.getAttribute('sandbox')).toBe('');
  });

  it('ETE-2 reports dirty on a user edit and clean again when reverted', () => {
    const onDirtyChange = vi.fn();
    renderEditor({ onDirtyChange });
    fireEvent.change(screen.getByLabelText('Email body'), { target: { value: '<p>Changed</p>' } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.change(screen.getByLabelText('Email body'), { target: { value: TEMPLATE.body } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('ETE-3 Save is two-step and sends expectedUpdatedAt', async () => {
    const onSaved = vi.fn();
    fetchMock.mockResolvedValue(json(200, { template: { ...TEMPLATE, body: '<p>Changed</p>', updatedAt: '2026-09-02T00:00:00.000Z' } }));
    renderEditor({ onSaved });
    fireEvent.change(screen.getByLabelText('Email body'), { target: { value: '<p>Changed</p>' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm?' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/admin\/email\/templates\/assignment-schedule$/);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({
      subject: 'Your schedule', body: '<p>Changed</p>', expectedUpdatedAt: TEMPLATE.updatedAt,
    });
    expect(showSuccess).toHaveBeenCalled();
  });

  it('ETE-4 an uncustomized template saves with expectedUpdatedAt null', async () => {
    fetchMock.mockResolvedValue(json(200, { template: TEMPLATE }));
    renderEditor({ template: { ...TEMPLATE, isCustomized: false, updatedAt: undefined } });
    fireEvent.change(screen.getByLabelText('Email body'), { target: { value: '<p>Changed</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm?' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).expectedUpdatedAt).toBeNull();
  });

  it('ETE-5 409 TEMPLATE_CHANGED keeps the draft, names who saved, and offers reload', async () => {
    const onSaved = vi.fn();
    const theirs = { ...TEMPLATE, body: '<p>Theirs</p>', updatedAt: '2026-09-03T00:00:00.000Z', updatedBy: 'other@x.org' };
    fetchMock
      .mockResolvedValueOnce(json(409, {
        code: 'TEMPLATE_CHANGED',
        current: { subject: 'Your schedule', body: '<p>Theirs</p>', updatedAt: theirs.updatedAt, updatedBy: 'other@x.org' },
      }))
      .mockResolvedValueOnce(json(200, { template: theirs }));
    renderEditor({ onSaved });

    fireEvent.change(screen.getByLabelText('Email body'), { target: { value: '<p>Mine</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm?' }));

    expect(await screen.findByText(/other@x\.org saved a newer version/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email body')).toHaveValue('<p>Mine</p>');
    expect(onSaved).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Load their version' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(theirs));
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/admin\/email\/templates\/assignment-schedule$/);
  });

  it('ETE-6 Reset to default is two-step and disabled for an uncustomized template', async () => {
    const onSaved = vi.fn();
    fetchMock.mockResolvedValue(json(200, { template: { ...TEMPLATE, isCustomized: false } }));
    renderEditor({ onSaved });
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Default' }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm?' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/reset$/);
    cleanup();

    renderEditor({ template: { ...TEMPLATE, isCustomized: false } });
    expect(screen.getByRole('button', { name: 'Reset to Default' })).toBeDisabled();
  });

  it('ETE-7 showSubject=false hides the subject and saves the stored subject unchanged', async () => {
    fetchMock.mockResolvedValue(json(200, { template: TEMPLATE }));
    renderEditor({ showSubject: false });
    expect(screen.queryByLabelText('Subject Line')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Email body'), { target: { value: '<p>Changed</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm?' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).subject).toBe('Your schedule');
  });

  it('ETE-8 a restored draft starts dirty and reports draft changes', () => {
    const onDraftChange = vi.fn();
    const onDirtyChange = vi.fn();
    renderEditor({ draft: { subject: 'Draft subject', body: TEMPLATE.body }, onDraftChange, onDirtyChange });
    expect(screen.getByLabelText('Subject Line')).toHaveValue('Draft subject');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.change(screen.getByLabelText('Subject Line'), { target: { value: 'Newer' } });
    expect(onDraftChange).toHaveBeenLastCalledWith({ subject: 'Newer', body: TEMPLATE.body });
  });

  it('ETE-9 with loadPreview it previews the unsaved text; without it there is no Preview tab', async () => {
    const loadPreview = vi.fn().mockResolvedValue('<p>rendered</p>');
    renderEditor({ loadPreview });
    fireEvent.change(screen.getByLabelText('Email body'), { target: { value: '<p>Unsaved</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(screen.getByTitle('Email Preview').getAttribute('srcdoc')).toBe('<p>rendered</p>'));
    expect(loadPreview).toHaveBeenCalledWith({ subject: 'Your schedule', body: '<p>Unsaved</p>' });
    cleanup();

    renderEditor();
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
  });

  it('ETE-10 a failed save keeps the draft and toasts the error', async () => {
    fetchMock.mockResolvedValue(json(500, { error: 'boom' }));
    renderEditor();
    fireEvent.change(screen.getByLabelText('Email body'), { target: { value: '<p>Mine</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm?' }));
    await waitFor(() => expect(showError).toHaveBeenCalled());
    expect(screen.getByLabelText('Email body')).toHaveValue('<p>Mine</p>');
  });
});
