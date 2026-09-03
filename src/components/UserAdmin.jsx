// src/components/UserAdmin.jsx
//
// The user directory at /admin/users. Renders one row per account under a
// single header strip (see openspec/changes/user-admin-roster, D1), filtered
// and sorted client-side because GET /api/users returns the whole collection
// with no query params.
//
// Three structural rules this file must keep:
//  1. The editor holds a DRAFT copy (D5). Nothing outside it is written until
//     a save resolves, so Cancel has nothing to revert.
//  2. Loading gates come from deriveListLoadingState (never query.isLoading),
//     so the empty state cannot flash during the pending && idle tick.
//  3. Role math lives in userManagementPolicy.js and userFilterUtils.js, not
//     here — the tab counts and the row badges must agree by construction.
import React, { useState, useMemo, useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import LoadingSpinner from './shared/LoadingSpinner';
import EmptyStateRefreshButton from './shared/EmptyStateRefreshButton';
import APP_CONFIG from '../config/config';
import useDepartments from '../hooks/useDepartments';
import useRoleTypes from '../hooks/useRoleTypes';
import { usePermissions } from '../hooks/usePermissions';
import { useNotification } from '../context/NotificationContext';
import { getAssignableRoles, canManageTarget } from '../utils/userManagementPolicy';
import { deriveListLoadingState } from '../utils/listLoadingState';
import keys from '../queries/keys';
import {
  deriveRole,
  filterUsers,
  sortUsers,
  splitOnMatch,
  FILTER_NONE,
} from '../utils/userFilterUtils';
import { logger } from '../utils/logger';
import './shared/FilterBar.css';
import './UserAdmin.css';

const API_BASE_URL = APP_CONFIG.API_BASE_URL;

// Role definitions matching backend permissionUtils.js
const ROLES = {
  viewer: { name: 'Viewer', description: 'View calendar only' },
  requester: { name: 'Requester', description: 'Submit & manage own requests' },
  approver: { name: 'Approver', description: 'Manage all events & requests' },
  admin: { name: 'Admin', description: 'Full system access' }
};

// Role tabs, in directory-authority order. `all` carries the total.
const ROLE_TABS = [
  { key: 'all', label: 'Everyone' },
  { key: 'admin', label: 'Administrators' },
  { key: 'approver', label: 'Approvers' },
  { key: 'requester', label: 'Requesters' },
  { key: 'viewer', label: 'Viewers' },
];

const DEFAULT_SORT = 'role_name';

const EMPTY_NEW_USER = {
  displayName: '',
  email: '',
  role: 'viewer',
  department: '',
  roleType: '',
  title: '',
  preferences: {
    startOfWeek: 'Sunday',
    defaultView: 'week',
    defaultGroupBy: 'categories',
    preferredZoomLevel: 100
  }
};

// Get initials from user name
const getInitials = (name) => {
  if (!name) return '?';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Last activity reads as a relative phrase, because "3 weeks ago" answers the
// administrator's actual question and a raw timestamp does not. The absolute
// date stays available on hover. Never-signed-in is its own phrase, not a
// very old date — a provisioned-but-unused account is a different problem.
function formatActivity(lastLogin) {
  if (!lastLogin) return { text: 'Never signed in', never: true, exact: null };
  const t = Date.parse(lastLogin);
  if (Number.isNaN(t)) return { text: 'Never signed in', never: true, exact: null };

  const exact = new Date(t).toLocaleString();
  const days = Math.floor((Date.now() - t) / DAY_MS);

  if (days < 0) return { text: 'Just now', never: false, exact };
  if (days === 0) return { text: 'Today', never: false, exact };
  if (days === 1) return { text: 'Yesterday', never: false, exact };
  if (days < 7) return { text: `${days} days ago`, never: false, exact };
  if (days < 31) {
    const weeks = Math.floor(days / 7);
    return { text: `${weeks} week${weeks === 1 ? '' : 's'} ago`, never: false, exact };
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return { text: `${months} month${months === 1 ? '' : 's'} ago`, never: false, exact };
  }
  const years = Math.floor(days / 365);
  return { text: `${years} year${years === 1 ? '' : 's'} ago`, never: false, exact };
}

// Renders `text` with the searched substring marked. Splitting is done by
// indexOf in userFilterUtils, so a term full of regex metacharacters (every
// email has a '.') is handled literally with no escaping needed.
function Highlight({ text, term }) {
  const value = text || '';
  if (!term?.trim()) return <>{value}</>;
  return (
    <>
      {splitOnMatch(value, term).map((seg, i) =>
        seg.match ? <mark key={i} className="ua-mark">{seg.text}</mark> : <span key={i}>{seg.text}</span>
      )}
    </>
  );
}

// Placeholder for an optional field the account has not set. Rendering an
// explicit dash rather than blank space distinguishes "unset" from "the cell
// failed to render".
const Unset = ({ label = 'Not set' }) => <span className="ua-unset">{label}</span>;

export default function UserAdmin({ apiToken }) {
  const { accounts } = useMsal();
  const { departments: departmentsList } = useDepartments();
  const { roleTypes: roleTypesList } = useRoleTypes();
  const { showSuccess, showError } = useNotification();
  const queryClient = useQueryClient();

  // Caller's effective role drives the role cap: approvers may only assign/manage
  // up to requester. The backend is authoritative; this only shapes the UI so the
  // user never sees an action the server would reject.
  const { role: callerRole } = usePermissions();
  const assignableRoles = useMemo(() => getAssignableRoles(callerRole), [callerRole]);
  const roleOptionEntries = useMemo(
    () => Object.entries(ROLES).filter(([key]) => assignableRoles.includes(key)),
    [assignableRoles]
  );

  // Build a lookup map keyed by department key for easy access
  const DEPARTMENTS = useMemo(() => {
    const map = {};
    for (const dept of departmentsList) {
      map[dept.key] = { name: dept.name, description: dept.description };
    }
    return map;
  }, [departmentsList]);

  // Build a lookup map keyed by role type key
  const ROLE_TYPES = useMemo(() => {
    const map = {};
    for (const rt of roleTypesList) {
      map[rt.key] = { name: rt.name, description: rt.description };
    }
    return map;
  }, [roleTypesList]);

  // The filter selects offer only the real keys — the '' entry from these
  // hooks means "None" in an editor, but '' already means "all" in a filter.
  const departmentOptions = useMemo(() => departmentsList.filter((d) => d.key), [departmentsList]);
  const roleTypeOptions = useMemo(() => roleTypesList.filter((r) => r.key), [roleTypesList]);

  // ─── Filter state ────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [roleTypeFilter, setRoleTypeFilter] = useState('');
  const [activityFilter, setActivityFilter] = useState('');
  const [sortBy, setSortBy] = useState(DEFAULT_SORT);

  // ─── Row state ───────────────────────────────────────────────────────────
  // One editor at a time (D5): a single id, not a map. Two open drafts over a
  // shared cache is a merge problem with no user-visible benefit.
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState(EMPTY_NEW_USER);

  // ─── Data ────────────────────────────────────────────────────────────────
  const usersQuery = useQuery({
    queryKey: keys.users.list(),
    enabled: !!apiToken,
    queryFn: async () => {
      const response = await fetch(`${API_BASE_URL}/users`, {
        headers: { Authorization: `Bearer ${apiToken}` }
      });
      if (!response.ok) {
        throw new Error(`Error fetching users: ${response.statusText}`);
      }
      return response.json();
    }
  });

  // No countsQuery and no `enabled` override (D6): there is no tab or filter
  // that intentionally skips this fetch, so passing a real `enabled` would
  // risk a perpetual spinner for no gain.
  const { isFirstLoad, isSilentRefreshing } = deriveListLoadingState(usersQuery);
  const loading = isFirstLoad;

  const users = useMemo(() => usersQuery.data || [], [usersQuery.data]);

  const invalidateUsers = useCallback(
    () => queryClient.invalidateQueries({ queryKey: keys.users.list() }),
    [queryClient]
  );

  // Depend on `refetch`, not on `usersQuery` — the query result object is a
  // new reference every render, which would recreate this callback each time.
  const { refetch: refetchUsers } = usersQuery;
  const handleManualRefresh = useCallback(() => {
    refetchUsers();
  }, [refetchUsers]);

  // ─── Derived views ───────────────────────────────────────────────────────
  // Counts describe the DIRECTORY, not the filtered view (D2). A count that
  // shrinks as you type tells you nothing the result count does not already,
  // and makes the tabs useless as a navigation aid.
  const tabCounts = useMemo(() => {
    const counts = { all: users.length, admin: 0, approver: 0, requester: 0, viewer: 0 };
    for (const user of users) {
      const role = deriveRole(user);
      if (counts[role] !== undefined) counts[role] += 1;
    }
    return counts;
  }, [users]);

  const visibleUsers = useMemo(() => {
    const filtered = filterUsers(users, {
      searchTerm,
      role: activeTab,
      department: departmentFilter,
      roleType: roleTypeFilter,
      activity: activityFilter,
    });
    return sortUsers(filtered, sortBy);
  }, [users, searchTerm, activeTab, departmentFilter, roleTypeFilter, activityFilter, sortBy]);

  const hasActiveFilters =
    !!searchTerm ||
    activeTab !== 'all' ||
    !!departmentFilter ||
    !!roleTypeFilter ||
    !!activityFilter ||
    sortBy !== DEFAULT_SORT;

  const clearFilters = useCallback(() => {
    setSearchTerm('');
    setActiveTab('all');
    setDepartmentFilter('');
    setRoleTypeFilter('');
    setActivityFilter('');
    setSortBy(DEFAULT_SORT);
  }, []);

  const currentUserEmail = accounts.length > 0 ? accounts[0].username : '';

  // ─── Editing (draft copy — D5) ───────────────────────────────────────────
  const openEditor = useCallback((user) => {
    setConfirmDeleteId(null);
    setEditingId(user._id);
    // A shallow clone plus a fresh preferences object. The draft is the only
    // thing the inputs write to; `users` (the query cache) is never touched.
    setDraft({
      displayName: user.displayName || '',
      email: user.email || '',
      role: user.role || deriveRole(user),
      department: user.department || '',
      roleType: user.roleType || '',
      title: user.title || '',
      preferences: { ...(user.preferences || {}) },
    });
  }, []);

  const closeEditor = useCallback(() => {
    setEditingId(null);
    setDraft(null);
  }, []);

  const updateDraft = useCallback((field, value) => {
    setDraft((prev) => {
      if (!prev) return prev;
      if (field.includes('.')) {
        const [parent, child] = field.split('.');
        return { ...prev, [parent]: { ...prev[parent], [child]: value } };
      }
      return { ...prev, [field]: value };
    });
  }, []);

  const updateMutation = useMutation({
    mutationFn: async ({ userId, values }) => {
      const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`
        },
        body: JSON.stringify({
          displayName: values.displayName,
          email: values.email,
          role: values.role,
          department: values.department || null,
          roleType: values.roleType || null,
          title: values.title || null,
          preferences: values.preferences
        })
      });
      if (!response.ok) {
        let errorMessage = 'Error updating user';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || `${errorMessage}: ${response.statusText}`;
        } catch {
          errorMessage = `${errorMessage}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }
      return response.json();
    }
  });

  const saveDraft = useCallback(async (userId) => {
    if (!draft) return;
    setSavingId(userId);
    try {
      const updated = await updateMutation.mutateAsync({ userId, values: draft });
      await invalidateUsers();
      closeEditor();
      showSuccess(`User ${updated.displayName || draft.displayName} updated successfully.`);
    } catch (err) {
      logger.error('Error updating user:', err);
      // The editor stays open with the entered values intact — the draft was
      // never cleared, so nothing the administrator typed is lost.
      showError(`Failed to update user: ${err.message}`);
    } finally {
      setSavingId(null);
    }
  }, [draft, updateMutation, invalidateUsers, closeEditor, showSuccess, showError]);

  // ─── Create ──────────────────────────────────────────────────────────────
  const handleNewUserInputChange = (field, value) => {
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      setNewUser((prev) => ({ ...prev, [parent]: { ...prev[parent], [child]: value } }));
    } else {
      setNewUser((prev) => ({ ...prev, [field]: value }));
    }
  };

  const createMutation = useMutation({
    mutationFn: async (userToCreate) => {
      const response = await fetch(`${API_BASE_URL}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`
        },
        body: JSON.stringify(userToCreate)
      });
      if (!response.ok) {
        let errorMessage = 'Error creating user';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || `${errorMessage}: ${response.statusText}`;
        } catch {
          errorMessage = `${errorMessage}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }
      return response.json();
    }
  });

  const createUser = async () => {
    if (!newUser.email || !newUser.displayName) {
      showError('Email and Display Name are required fields.');
      return;
    }

    setCreating(true);
    try {
      const createdUser = await createMutation.mutateAsync({
        email: newUser.email,
        displayName: newUser.displayName,
        userId: newUser.email.split('@')[0] + Date.now(),
        role: newUser.role || 'viewer',
        department: newUser.department || null,
        roleType: newUser.roleType || null,
        title: newUser.title || null,
        preferences: {
          startOfWeek: newUser.preferences.startOfWeek || 'Sunday',
          defaultView: newUser.preferences.defaultView || 'week',
          defaultGroupBy: newUser.preferences.defaultGroupBy || 'categories',
          preferredZoomLevel: newUser.preferences.preferredZoomLevel || 100
        },
        createdAt: new Date().toISOString()
      });
      await invalidateUsers();
      setNewUser(EMPTY_NEW_USER);
      setShowModal(false);
      showSuccess(`User ${createdUser.displayName} created successfully.`);
    } catch (err) {
      logger.error('Error creating user:', err);
      showError(`Failed to create user: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  // ─── Delete (two-step in-button confirmation) ────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async (userId) => {
      const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiToken}` }
      });
      if (!response.ok) {
        throw new Error(`Error deleting user: ${response.statusText}`);
      }
      return userId;
    }
  });

  const handleDelete = async (userId) => {
    setDeletingId(userId);
    setConfirmDeleteId(null);
    try {
      await deleteMutation.mutateAsync(userId);
      await invalidateUsers();
      showSuccess('User deleted successfully.');
    } catch (err) {
      logger.error('Error deleting user:', err);
      showError('Failed to delete user. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };

  // First click arms; the armed state persists until the administrator acts.
  // No timer resets it.
  const handleDeleteClick = (userId) => {
    if (confirmDeleteId === userId) {
      handleDelete(userId);
    } else {
      setConfirmDeleteId(userId);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  // The empty-state split (D7). `isFirstLoad` never reaches an empty state,
  // and a query error is never reported as an empty directory.
  const settled = !isFirstLoad && !isSilentRefreshing;
  const showFailureState = !isFirstLoad && usersQuery.isError;
  const showEmptyDirectory = settled && !usersQuery.isError && users.length === 0;
  const showNoMatches = settled && !usersQuery.isError && users.length > 0 && visibleUsers.length === 0;
  const showRoster = !isFirstLoad && !usersQuery.isError && visibleUsers.length > 0;

  // First load: a spinner, never an empty state.
  if (loading) {
    return (
      <div className="loading-veil-host">
        <LoadingSpinner variant="overlay" className="visible initial" text="Loading users..." />
      </div>
    );
  }

  return (
    <div className="user-admin">
      {/* Page Header */}
      <div className="user-admin-header">
        <div className="user-admin-header-content">
          <h2>User Management</h2>
          <p className="user-admin-header-subtitle">
            Manage user accounts and permissions
          </p>
        </div>
        <button onClick={() => setShowModal(true)} className="add-user-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add User
        </button>
      </div>

      {/* Role tabs — the counts the three stat cards used to carry, attached
          to a control that also filters (D2). Styled on EventManagement's
          underline recipe, but with ua-* class names defined in UserAdmin.css:
          .em-tabs lives in EventManagement.css, which this screen does not
          import, so borrowing those names would make the tabs render correctly
          only when another screen happened to have mounted first. */}
      <div className="ua-tabs" role="tablist">
        {ROLE_TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`ua-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            <span className="ua-tab-count">{tabCounts[tab.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Filter toolbar — built against the shared FilterBar.css rr-* classes,
          exactly as MyReservations and ReservationRequests do. */}
      <div className="rr-filter-bar">
        <div className="rr-search-container">
          <svg className="rr-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="rr-search-input"
            placeholder="Search by name, email, or title..."
            aria-label="Search users"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button className="rr-search-clear" onClick={() => setSearchTerm('')} title="Clear search">
              &times;
            </button>
          )}
        </div>

        <div className="rr-secondary-filters">
          <div className={`rr-status-filter${departmentFilter ? ' active' : ''}`}>
            <label htmlFor="ua-department-filter">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M9 13h1M14 9h1M14 13h1" />
              </svg>
              Department
            </label>
            <select
              id="ua-department-filter"
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
            >
              <option value="">All Departments</option>
              <option value={FILTER_NONE}>No Department</option>
              {departmentOptions.map((dept) => (
                <option key={dept.key} value={dept.key}>{dept.name}</option>
              ))}
            </select>
          </div>

          <div className={`rr-status-filter${roleTypeFilter ? ' active' : ''}`}>
            <label htmlFor="ua-roletype-filter">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              Org Role
            </label>
            <select
              id="ua-roletype-filter"
              value={roleTypeFilter}
              onChange={(e) => setRoleTypeFilter(e.target.value)}
            >
              <option value="">All Org Roles</option>
              <option value={FILTER_NONE}>No Org Role</option>
              {roleTypeOptions.map((rt) => (
                <option key={rt.key} value={rt.key}>{rt.name}</option>
              ))}
            </select>
          </div>

          <div className={`rr-status-filter${activityFilter ? ' active' : ''}`}>
            <label htmlFor="ua-activity-filter">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              Activity
            </label>
            <select
              id="ua-activity-filter"
              value={activityFilter}
              onChange={(e) => setActivityFilter(e.target.value)}
            >
              <option value="">Any Activity</option>
              <option value="active">Active (30 days)</option>
              <option value="dormant">Dormant (90+ days)</option>
              <option value="never">Never signed in</option>
            </select>
          </div>

          <div className={`rr-sort-filter${sortBy !== DEFAULT_SORT ? ' active' : ''}`}>
            <label htmlFor="ua-sort">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <polyline points="19 12 12 19 5 12" />
              </svg>
              Sort
            </label>
            <select id="ua-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="role_name">Role, then name</option>
              <option value="name_asc">Name (A to Z)</option>
              <option value="name_desc">Name (Z to A)</option>
              <option value="activity">Recently active</option>
            </select>
          </div>

          {/* Reserved space: `.hidden` keeps the box laid out so engaging a
              filter does not shift the controls beside it. */}
          <div className={`rr-filter-actions${hasActiveFilters ? '' : ' hidden'}`}>
            <button className="rr-clear-filters" onClick={clearFilters}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              Clear
            </button>
            <span className="rr-filter-results">
              {visibleUsers.length} of {users.length}
            </span>
          </div>
        </div>
      </div>

      {/* A failed load is stated plainly. It must never borrow the
          empty-directory message — that is the defect this replaces. */}
      {showFailureState && (
        <div className="ua-state ua-state-error">
          <div className="ua-state-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          </div>
          <h3>Could not load the user directory</h3>
          <p>The request to the server failed. This does not mean there are no accounts.</p>
          <EmptyStateRefreshButton
            onClick={handleManualRefresh}
            isRefreshing={usersQuery.isFetching}
            label="Try Again"
          />
        </div>
      )}

      {showEmptyDirectory && (
        <div className="ua-state">
          <div className="ua-state-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <h3>No users yet</h3>
          <p>Create your first user to get started</p>
          <div className="ua-state-actions">
            <button onClick={() => setShowModal(true)} className="add-user-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add Your First User
            </button>
            <EmptyStateRefreshButton
              onClick={handleManualRefresh}
              isRefreshing={usersQuery.isFetching}
            />
          </div>
        </div>
      )}

      {/* Filtered to nothing: the recovery action is clearing the filters, not
          refetching. Refetching is not what excluded these rows. */}
      {showNoMatches && (
        <div className="ua-state">
          <div className="ua-state-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <h3>No accounts match these filters</h3>
          <p>{users.length} accounts are in the directory. None of them match every filter you have set.</p>
          <button className="ua-clear-filters-btn" onClick={clearFilters}>
            Clear all filters
          </button>
        </div>
      )}

      {/* Roster */}
      {showRoster && (
        <div className={`ua-roster${isSilentRefreshing ? ' is-refreshing' : ''}`}>
          {/* Column labels print once, not on every row (D1). */}
          <div className="ua-roster-head ua-row-grid" aria-hidden="true">
            <span>Person</span>
            <span>Role</span>
            <span>Department</span>
            <span className="ua-col-orgrole">Org Role</span>
            <span className="ua-col-title">Title</span>
            <span>Last Activity</span>
            <span className="ua-col-actions">Actions</span>
          </div>

          {visibleUsers.map((user) => {
            const isCurrentUser = user.email === currentUserEmail;
            const isEditing = editingId === user._id;
            // Lock rows the caller may not manage (e.g. approver viewing an
            // approver/admin row). Backend enforces this too; this just hides
            // controls that would 403.
            const targetRole = deriveRole(user);
            const canManageThis = canManageTarget(callerRole, targetRole);
            const activity = formatActivity(user.lastLogin);

            return (
              <div
                key={user._id}
                className={`ua-entry${isEditing ? ' editing' : ''}${isCurrentUser ? ' current-user' : ''}${!canManageThis ? ' locked' : ''}`}
              >
                <div className="ua-row ua-row-grid">
                  <div className="ua-cell ua-cell-person">
                    <div className="ua-avatar">{getInitials(user.displayName)}</div>
                    <div className="ua-person-text">
                      <span className="ua-name">
                        <Highlight text={user.displayName || 'Unnamed User'} term={searchTerm} />
                        {isCurrentUser && <span className="ua-you-badge">You</span>}
                      </span>
                      <span className="ua-email">
                        <Highlight text={user.email} term={searchTerm} />
                      </span>
                    </div>
                  </div>

                  <div className="ua-cell">
                    <span className={`ua-role-badge role-${targetRole}`}>
                      {ROLES[targetRole]?.name || 'Viewer'}
                    </span>
                  </div>

                  <div className="ua-cell">
                    {user.department ? (
                      <span className={`ua-tag department-${user.department}`}>
                        {DEPARTMENTS[user.department]?.name || user.department}
                      </span>
                    ) : (
                      <Unset label="No department" />
                    )}
                  </div>

                  <div className="ua-cell ua-col-orgrole">
                    {user.roleType ? (
                      <span className={`ua-tag role-type-${user.roleType}`}>
                        {ROLE_TYPES[user.roleType]?.name || user.roleType}
                      </span>
                    ) : (
                      <Unset label="No org role" />
                    )}
                  </div>

                  <div className="ua-cell ua-col-title">
                    {user.title ? (
                      <span className="ua-title-text" title={user.title}>
                        <Highlight text={user.title} term={searchTerm} />
                      </span>
                    ) : (
                      <Unset label="No title" />
                    )}
                  </div>

                  <div className="ua-cell">
                    <span
                      className={`ua-activity${activity.never ? ' never' : ''}`}
                      title={activity.exact || 'This account has never signed in'}
                    >
                      {activity.text}
                    </span>
                  </div>

                  <div className="ua-cell ua-cell-actions ua-col-actions">
                    {!canManageThis ? (
                      <span className="ua-locked-note" title="Only an administrator can manage this user">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        Admin only
                      </span>
                    ) : (
                      <>
                        <button
                          className="edit-btn"
                          onClick={() => (isEditing ? closeEditor() : openEditor(user))}
                          disabled={confirmDeleteId === user._id}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                          Edit
                        </button>
                        {!isCurrentUser && (
                          <div className="confirm-button-group">
                            <button
                              className={`delete-btn ${confirmDeleteId === user._id ? 'confirming' : ''}`}
                              onClick={() => handleDeleteClick(user._id)}
                              disabled={deletingId === user._id}
                            >
                              {deletingId === user._id ? (
                                <>
                                  <span className="btn-spinner" />
                                  Deleting...
                                </>
                              ) : confirmDeleteId === user._id ? (
                                'Confirm?'
                              ) : (
                                <>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  </svg>
                                  Delete
                                </>
                              )}
                            </button>
                            {confirmDeleteId === user._id && (
                              <button
                                className="cancel-confirm-x"
                                aria-label="Cancel delete"
                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Editor expands BENEATH its own row so the surrounding rows
                    and the engaged filters stay visible (D5). It writes only
                    to `draft`; the row above it is untouched until a save
                    resolves and the query refetches. */}
                {isEditing && draft && (
                  <div className="ua-editor">
                    <div className="ua-editor-grid">
                      <div className="ua-field">
                        <label htmlFor={`ua-name-${user._id}`}>Display Name</label>
                        <input
                          id={`ua-name-${user._id}`}
                          type="text"
                          value={draft.displayName}
                          onChange={(e) => updateDraft('displayName', e.target.value)}
                          placeholder="Display Name"
                        />
                      </div>
                      <div className="ua-field">
                        <label htmlFor={`ua-email-${user._id}`}>Email</label>
                        <input
                          id={`ua-email-${user._id}`}
                          type="email"
                          value={draft.email}
                          onChange={(e) => updateDraft('email', e.target.value)}
                          placeholder="Email"
                        />
                      </div>
                      <div className="ua-field">
                        <label htmlFor={`ua-role-${user._id}`}>Role</label>
                        <select
                          id={`ua-role-${user._id}`}
                          value={draft.role}
                          onChange={(e) => updateDraft('role', e.target.value)}
                        >
                          {roleOptionEntries.map(([key, { name, description }]) => (
                            <option key={key} value={key} title={description}>
                              {name}
                            </option>
                          ))}
                        </select>
                        <span className="ua-field-hint">{ROLES[draft.role]?.description}</span>
                      </div>
                      <div className="ua-field">
                        <label htmlFor={`ua-dept-${user._id}`}>Department</label>
                        <select
                          id={`ua-dept-${user._id}`}
                          value={draft.department}
                          onChange={(e) => updateDraft('department', e.target.value)}
                        >
                          {Object.entries(DEPARTMENTS).map(([key, { name, description }]) => (
                            <option key={key} value={key} title={description}>
                              {name}
                            </option>
                          ))}
                        </select>
                        <span className="ua-field-hint">{DEPARTMENTS[draft.department]?.description}</span>
                      </div>
                      <div className="ua-field">
                        <label htmlFor={`ua-roletype-${user._id}`}>Organizational Role</label>
                        <select
                          id={`ua-roletype-${user._id}`}
                          value={draft.roleType}
                          onChange={(e) => updateDraft('roleType', e.target.value)}
                        >
                          {Object.entries(ROLE_TYPES).map(([key, { name, description }]) => (
                            <option key={key} value={key} title={description}>
                              {name}
                            </option>
                          ))}
                        </select>
                        <span className="ua-field-hint">{ROLE_TYPES[draft.roleType]?.description}</span>
                      </div>
                      <div className="ua-field">
                        <label htmlFor={`ua-title-${user._id}`}>Title</label>
                        <input
                          id={`ua-title-${user._id}`}
                          type="text"
                          value={draft.title}
                          onChange={(e) => updateDraft('title', e.target.value)}
                          placeholder="e.g., Senior Rabbi"
                        />
                      </div>
                    </div>

                    {/* The listed account's OWN calendar preferences. Never the
                        reason an administrator opens this page, so they sit
                        below a subheading rather than in the roster row. */}
                    <div className="ua-editor-secondary">
                      <h5 className="ua-editor-subheading">This user&apos;s calendar preferences</h5>
                      <div className="ua-editor-grid">
                        <div className="ua-field">
                          <label htmlFor={`ua-view-${user._id}`}>Default View</label>
                          <select
                            id={`ua-view-${user._id}`}
                            value={draft.preferences?.defaultView || 'week'}
                            onChange={(e) => updateDraft('preferences.defaultView', e.target.value)}
                          >
                            <option value="day">Day</option>
                            <option value="week">Week</option>
                            <option value="month">Month</option>
                          </select>
                        </div>
                        <div className="ua-field">
                          <label htmlFor={`ua-week-${user._id}`}>Week Starts On</label>
                          <select
                            id={`ua-week-${user._id}`}
                            value={draft.preferences?.startOfWeek || 'Sunday'}
                            onChange={(e) => updateDraft('preferences.startOfWeek', e.target.value)}
                          >
                            <option value="Sunday">Sunday</option>
                            <option value="Monday">Monday</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="ua-editor-actions">
                      <button
                        className="save-btn"
                        onClick={() => saveDraft(user._id)}
                        disabled={savingId === user._id}
                      >
                        {savingId === user._id ? 'Saving...' : 'Save'}
                      </button>
                      <button className="cancel-btn" onClick={closeEditor} disabled={savingId === user._id}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add User Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create New User</h3>
            </div>

            <div className="modal-body">
              <div className="form-section">
                <h4 className="form-section-title">User Information</h4>
                <div className="form-row">
                  <div className="form-group">
                    <label>
                      Display Name <span className="required">*</span>
                    </label>
                    <input
                      type="text"
                      value={newUser.displayName}
                      onChange={(e) => handleNewUserInputChange('displayName', e.target.value)}
                      placeholder="John Smith"
                    />
                  </div>
                  <div className="form-group">
                    <label>
                      Email <span className="required">*</span>
                    </label>
                    <input
                      type="email"
                      value={newUser.email}
                      onChange={(e) => handleNewUserInputChange('email', e.target.value)}
                      placeholder="john@example.com"
                    />
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h4 className="form-section-title">Preferences</h4>
                <div className="form-row">
                  <div className="form-group">
                    <label>Default View</label>
                    <select
                      value={newUser.preferences.defaultView}
                      onChange={(e) => handleNewUserInputChange('preferences.defaultView', e.target.value)}
                    >
                      <option value="day">Day</option>
                      <option value="week">Week</option>
                      <option value="month">Month</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Week Starts On</label>
                    <select
                      value={newUser.preferences.startOfWeek}
                      onChange={(e) => handleNewUserInputChange('preferences.startOfWeek', e.target.value)}
                    >
                      <option value="Sunday">Sunday</option>
                      <option value="Monday">Monday</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h4 className="form-section-title">Role</h4>
                <div className="role-selection">
                  <select
                    value={newUser.role}
                    onChange={(e) => handleNewUserInputChange('role', e.target.value)}
                    className="role-select-modal"
                  >
                    {roleOptionEntries.map(([key, { name }]) => (
                      <option key={key} value={key}>{name}</option>
                    ))}
                  </select>
                  <p className="role-description-text">
                    {ROLES[newUser.role]?.description}
                  </p>
                  <div className="role-capabilities">
                    <h5>Role capabilities:</h5>
                    <ul>
                      {newUser.role === 'viewer' && (
                        <li>View calendar events</li>
                      )}
                      {newUser.role === 'requester' && (
                        <>
                          <li>View calendar events</li>
                          <li>Submit and manage own reservation requests</li>
                        </>
                      )}
                      {newUser.role === 'approver' && (
                        <>
                          <li>View calendar events</li>
                          <li>Submit and manage own reservation requests</li>
                          <li>Approve/reject all reservations</li>
                          <li>Create, edit, and delete published events</li>
                        </>
                      )}
                      {newUser.role === 'admin' && (
                        <>
                          <li>All approver capabilities</li>
                          <li>Access Admin modules (Users, Categories, Locations)</li>
                          <li>Full system configuration access</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h4 className="form-section-title">Department (Optional)</h4>
                <div className="department-selection">
                  <select
                    value={newUser.department || ''}
                    onChange={(e) => handleNewUserInputChange('department', e.target.value || null)}
                    className="department-select-modal"
                  >
                    {Object.entries(DEPARTMENTS).map(([key, { name }]) => (
                      <option key={key} value={key}>{name}</option>
                    ))}
                  </select>
                  <p className="department-description-text">
                    {DEPARTMENTS[newUser.department || '']?.description}
                  </p>
                  {newUser.department && (
                    <div className="department-capabilities">
                      <h5>Department can edit:</h5>
                      <ul>
                        {newUser.department === 'security' && (
                          <>
                            <li>Door open time</li>
                            <li>Door close time</li>
                            <li>Door notes</li>
                          </>
                        )}
                        {newUser.department === 'maintenance' && (
                          <>
                            <li>Setup time</li>
                            <li>Teardown time</li>
                            <li>Setup notes</li>
                            <li>Event notes</li>
                          </>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              <div className="form-section">
                <h4 className="form-section-title">Organizational Role (Optional)</h4>
                <div className="role-type-selection">
                  <select
                    value={newUser.roleType || ''}
                    onChange={(e) => handleNewUserInputChange('roleType', e.target.value || null)}
                    className="role-type-select-modal"
                  >
                    {Object.entries(ROLE_TYPES).map(([key, { name }]) => (
                      <option key={key} value={key}>{name}</option>
                    ))}
                  </select>
                  <p className="role-type-description-text">
                    {ROLE_TYPES[newUser.roleType || '']?.description}
                  </p>
                </div>
              </div>

              <div className="form-section">
                <h4 className="form-section-title">Title (Optional)</h4>
                <div className="form-group full-width">
                  <input
                    type="text"
                    value={newUser.title || ''}
                    onChange={(e) => handleNewUserInputChange('title', e.target.value)}
                    placeholder="e.g., Senior Rabbi, Associate Cantor"
                  />
                  <p className="title-description-text">
                    Free-text display title for this user
                  </p>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <div className="modal-actions">
                <button
                  className="cancel-btn"
                  onClick={() => setShowModal(false)}
                  disabled={creating}
                >
                  Cancel
                </button>
                <button
                  className="save-btn"
                  onClick={createUser}
                  disabled={creating}
                >
                  {creating ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
