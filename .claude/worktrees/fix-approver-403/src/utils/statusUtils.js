/**
 * Status display utilities shared across reservation views.
 */

/**
 * Get status badge label and CSS class for a reservation.
 * Handles all statuses including sub-states (edit requested, cancellation requested).
 *
 * @param {Object} reservation - Flat reservation object
 * @returns {{ label: string, className: string }}
 */
export function getStatusBadgeInfo(reservation) {
  if (reservation.status === 'draft') {
    return { label: 'Draft', className: 'status-draft' };
  }
  if (reservation.status === 'pending' || reservation.status === 'room-reservation-request') {
    return { label: 'Pending', className: 'status-pending' };
  }
  if (reservation.status === 'published' && reservation.pendingEditRequest?.status === 'pending') {
    return { label: 'Edit Requested', className: 'status-published-edit' };
  }
  if (reservation.status === 'published' && reservation.pendingCancellationRequest?.status === 'pending') {
    return { label: 'Cancellation Requested', className: 'status-published-edit' };
  }
  if (reservation.status === 'published') {
    return { label: 'Published', className: 'status-published' };
  }
  if (reservation.status === 'rejected') {
    return { label: 'Rejected', className: 'status-rejected' };
  }
  if (reservation.status === 'deleted') {
    return { label: 'Deleted', className: 'status-deleted' };
  }
  return { label: reservation.status, className: 'status-pending' };
}
