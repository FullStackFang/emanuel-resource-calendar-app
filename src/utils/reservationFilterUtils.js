/**
 * Shared filter and sort utilities for reservation list views.
 * Used by MyReservations and ReservationRequests.
 */

/**
 * Filter reservations by full-text search and date range.
 * Searches across 7 fields: title, requester name, department, location, description.
 *
 * @param {Array} items - Flat reservation objects
 * @param {Object} filters
 * @param {string} filters.searchTerm - Full-text search string
 * @param {string} filters.dateFrom - Start date filter (YYYY-MM-DD, inclusive)
 * @param {string} filters.dateTo - End date filter (YYYY-MM-DD, inclusive)
 * @returns {Array} Filtered items
 */
export function filterBySearchAndDate(items, { searchTerm, dateFrom, dateTo }) {
  let results = items;

  if (searchTerm?.trim()) {
    const term = searchTerm.trim().toLowerCase();
    results = results.filter(r => {
      const rawTitle = (r.eventTitle || '');
      const displayTitle = (r.isHold && !rawTitle.startsWith('[Hold]'))
        ? `[Hold] ${rawTitle}`
        : rawTitle;
      return displayTitle.toLowerCase().includes(term) ||
        (r.requesterName || '').toLowerCase().includes(term) ||
        (r.roomReservationData?.requestedBy?.name || '').toLowerCase().includes(term) ||
        (r.locationDisplayNames || '').toLowerCase().includes(term) ||
        (r.eventDescription || '').toLowerCase().includes(term);
    });
  }

  if (dateFrom) {
    results = results.filter(r => r.startDate >= dateFrom);
  }
  if (dateTo) {
    results = results.filter(r => r.startDate <= dateTo);
  }

  return results;
}

/**
 * Sort reservations by the given sort key.
 *
 * @param {Array} items - Reservation objects with startDate and submittedAt fields
 * @param {string} sortBy - One of: 'date_desc', 'date_asc', 'submitted_desc', 'submitted_asc'
 * @returns {Array} New sorted array
 */
export function sortReservations(items, sortBy) {
  const sorted = [...items];
  sorted.sort((a, b) => {
    switch (sortBy) {
      case 'date_asc':
        return (a.startDate || '').localeCompare(b.startDate || '');
      case 'submitted_desc':
        return (b.submittedAt || '').localeCompare(a.submittedAt || '');
      case 'submitted_asc':
        return (a.submittedAt || '').localeCompare(b.submittedAt || '');
      case 'date_desc':
      default:
        return (b.startDate || '').localeCompare(a.startDate || '');
    }
  });
  return sorted;
}
