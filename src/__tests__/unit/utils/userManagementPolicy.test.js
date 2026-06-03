// src/__tests__/unit/utils/userManagementPolicy.test.js
//
// Locks the frontend user-management cap (mirror of backend ROLE_MAX_ASSIGNABLE).
// These shape the role selector and row-locking in UserAdmin so the UI never
// offers an action the backend would reject with USER_MANAGEMENT_FORBIDDEN.
import { describe, it, expect } from 'vitest';
import {
  getAssignableRoles,
  canManageTarget,
  ROLE_MAX_ASSIGNABLE,
} from '../../../utils/userManagementPolicy';

describe('userManagementPolicy', () => {
  describe('getAssignableRoles', () => {
    it('caps approvers at viewer/requester', () => {
      expect(getAssignableRoles('approver')).toEqual(['viewer', 'requester']);
    });

    it('lets admins assign every role', () => {
      expect(getAssignableRoles('admin')).toEqual(['viewer', 'requester', 'approver', 'admin']);
    });

    it('returns no assignable roles for viewer/requester (cannot manage users)', () => {
      expect(getAssignableRoles('viewer')).toEqual([]);
      expect(getAssignableRoles('requester')).toEqual([]);
      expect(getAssignableRoles(undefined)).toEqual([]);
    });
  });

  describe('canManageTarget', () => {
    it('approver can manage viewer/requester targets only', () => {
      expect(canManageTarget('approver', 'viewer')).toBe(true);
      expect(canManageTarget('approver', 'requester')).toBe(true);
      expect(canManageTarget('approver', 'approver')).toBe(false);
      expect(canManageTarget('approver', 'admin')).toBe(false);
    });

    it('admin can manage any target', () => {
      expect(canManageTarget('admin', 'viewer')).toBe(true);
      expect(canManageTarget('admin', 'approver')).toBe(true);
      expect(canManageTarget('admin', 'admin')).toBe(true);
    });

    it('viewer/requester can manage nobody', () => {
      expect(canManageTarget('viewer', 'viewer')).toBe(false);
      expect(canManageTarget('requester', 'viewer')).toBe(false);
    });

    it('treats an unknown target role as the lowest level', () => {
      expect(canManageTarget('approver', undefined)).toBe(true);
      expect(canManageTarget('approver', 'bogus')).toBe(true);
    });
  });

  it('exposes the cap map for parity assertions', () => {
    expect(ROLE_MAX_ASSIGNABLE).toEqual({ approver: 'requester', admin: 'admin' });
  });
});
