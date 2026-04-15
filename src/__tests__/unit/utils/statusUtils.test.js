/**
 * Tests for statusUtils.js
 *
 * Validates getStatusBadgeInfo, including occurrence-scoped edit request badges.
 */

import { describe, it, expect } from 'vitest';
import { getStatusBadgeInfo } from '../../../utils/statusUtils';

describe('getStatusBadgeInfo', () => {
  it('returns Draft badge for draft status', () => {
    const result = getStatusBadgeInfo({ status: 'draft' });
    expect(result).toEqual({ label: 'Draft', className: 'status-draft' });
  });

  it('returns Pending badge for pending status', () => {
    const result = getStatusBadgeInfo({ status: 'pending' });
    expect(result).toEqual({ label: 'Pending', className: 'status-pending' });
  });

  it('returns Published badge for published status without pending requests', () => {
    const result = getStatusBadgeInfo({ status: 'published' });
    expect(result).toEqual({ label: 'Published', className: 'status-published' });
  });

  it('returns generic Edit Requested badge for series-level edit request', () => {
    const result = getStatusBadgeInfo({
      status: 'published',
      pendingEditRequest: {
        status: 'pending',
        editScope: 'allEvents',
        occurrenceDate: null,
      },
    });
    expect(result).toEqual({ label: 'Edit Requested', className: 'status-published-edit' });
  });

  it('returns generic Edit Requested badge when editScope is null (legacy)', () => {
    const result = getStatusBadgeInfo({
      status: 'published',
      pendingEditRequest: {
        status: 'pending',
        editScope: null,
        occurrenceDate: null,
      },
    });
    expect(result).toEqual({ label: 'Edit Requested', className: 'status-published-edit' });
  });

  it('returns occurrence-scoped Edit Requested badge with date for thisEvent scope', () => {
    const result = getStatusBadgeInfo({
      status: 'published',
      pendingEditRequest: {
        status: 'pending',
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-17',
      },
    });
    // Badge should include the occurrence date
    expect(result.className).toBe('status-published-edit');
    expect(result.label).toContain('Edit Requested');
    expect(result.label).toContain('Mar');
    expect(result.label).toContain('17');
  });

  it('returns Cancellation Requested badge for pending cancellation', () => {
    const result = getStatusBadgeInfo({
      status: 'published',
      pendingCancellationRequest: { status: 'pending' },
    });
    expect(result).toEqual({ label: 'Cancellation Requested', className: 'status-published-edit' });
  });

  it('returns Rejected badge for rejected status', () => {
    const result = getStatusBadgeInfo({ status: 'rejected' });
    expect(result).toEqual({ label: 'Rejected', className: 'status-rejected' });
  });

  it('returns Deleted badge for deleted status', () => {
    const result = getStatusBadgeInfo({ status: 'deleted' });
    expect(result).toEqual({ label: 'Deleted', className: 'status-deleted' });
  });
});
