/**
 * Test constants and terminology mapping
 *
 * Maps spec terminology to database values for clarity in tests.
 */

// Event status values as stored in the database
const STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  DELETED: 'deleted',
  PUBLISHED: 'published',
};

// Spec terminology mapping (for documentation clarity)
// PUBLISHED = approved event without pendingEditRequest
// PUBLISHED_EDIT = approved event WITH pendingEditRequest
const SPEC_STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending',
  PUBLISHED: 'approved',      // No pendingEditRequest
  PUBLISHED_EDIT: 'approved', // Has pendingEditRequest field
  REJECTED: 'rejected',
  DELETED: 'deleted',
};

// Role hierarchy levels
const ROLES = {
  VIEWER: 'viewer',
  REQUESTER: 'requester',
  APPROVER: 'approver',
  ADMIN: 'admin',
};

// Role hierarchy levels (numeric)
const ROLE_LEVELS = {
  viewer: 0,
  requester: 1,
  approver: 2,
  admin: 3,
};

// Collection names
const COLLECTIONS = {
  USERS: 'templeEvents__Users',
  EVENTS: 'templeEvents__Events',
  LOCATIONS: 'templeEvents__Locations',
  CALENDAR_DELTAS: 'templeEvents__CalendarDeltas',
  RESERVATION_TOKENS: 'templeEvents__ReservationTokens',
  AUDIT_HISTORY: 'templeEvents__EventAuditHistory',
};

// API endpoints
const ENDPOINTS = {
  // Draft endpoints
  CREATE_DRAFT: '/api/room-reservations/draft',
  UPDATE_DRAFT: (id) => `/api/room-reservations/draft/${id}`,
  SUBMIT_DRAFT: (id) => `/api/room-reservations/draft/${id}/submit`,
  DELETE_DRAFT: (id) => `/api/room-reservations/draft/${id}`,

  // Admin event endpoints
  GET_EVENTS: '/api/admin/events',
  GET_EVENT: (id) => `/api/admin/events/${id}`,
  UPDATE_EVENT: (id) => `/api/admin/events/${id}`,
  DELETE_EVENT: (id) => `/api/admin/events/${id}`,
  APPROVE_EVENT: (id) => `/api/admin/events/${id}/approve`,
  REJECT_EVENT: (id) => `/api/admin/events/${id}/reject`,
  RESTORE_EVENT: (id) => `/api/admin/events/${id}/restore`,

  // Edit request endpoints
  REQUEST_EDIT: (id) => `/api/events/${id}/request-edit`,
  APPROVE_EDIT: (id) => `/api/admin/events/${id}/approve-edit`,
  REJECT_EDIT: (id) => `/api/admin/events/${id}/reject-edit`,

  // Room reservation endpoints
  OWNER_RESTORE_RESERVATION: (id) => `/api/room-reservations/${id}/restore`,
  RESUBMIT_RESERVATION: (id) => `/api/room-reservations/${id}/resubmit`,

  // Calendar load endpoint
  LOAD_EVENTS: '/api/events/calendar-load',

  // User endpoints
  GET_USER: '/api/users/me',
  GET_RESERVATIONS: '/api/reservations/my',
};

// Test user emails
const TEST_EMAILS = {
  VIEWER: 'viewer@external.com',
  REQUESTER: 'requester@external.com',
  APPROVER: 'approver@external.com',
  ADMIN: 'admin@emanuelnyc.org',
  DOMAIN_ADMIN: 'staff@emanuelnyc.org',
  OTHER_REQUESTER: 'other.requester@external.com',
};

// Default test calendar owner
const TEST_CALENDAR_OWNER = 'templeeventssandbox@emanuelnyc.org';
const TEST_CALENDAR_ID = 'test-calendar-id';

module.exports = {
  STATUS,
  SPEC_STATUS,
  ROLES,
  ROLE_LEVELS,
  COLLECTIONS,
  ENDPOINTS,
  TEST_EMAILS,
  TEST_CALENDAR_OWNER,
  TEST_CALENDAR_ID,
};
