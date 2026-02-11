/**
 * Unit tests for permissionUtils
 *
 * Tests the core permission logic without database dependencies.
 */

const {
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS,
  DEPARTMENT_EDITABLE_FIELDS,
  getEffectiveRole,
  hasRole,
  getPermissions,
  getValidRoles,
  isValidRole,
  getDepartmentEditableFields,
  canEditField,
  DEFAULT_ADMIN_DOMAIN,
} = require('../../../utils/permissionUtils');

describe('permissionUtils', () => {
  describe('ROLE_HIERARCHY', () => {
    it('should have correct hierarchy levels', () => {
      expect(ROLE_HIERARCHY.viewer).toBe(0);
      expect(ROLE_HIERARCHY.requester).toBe(1);
      expect(ROLE_HIERARCHY.approver).toBe(2);
      expect(ROLE_HIERARCHY.admin).toBe(3);
    });

    it('should have exactly 4 roles', () => {
      expect(Object.keys(ROLE_HIERARCHY)).toHaveLength(4);
    });

    it('should have increasing hierarchy values', () => {
      const levels = Object.values(ROLE_HIERARCHY);
      for (let i = 1; i < levels.length; i++) {
        expect(levels[i]).toBeGreaterThan(levels[i - 1]);
      }
    });
  });

  describe('ROLE_PERMISSIONS', () => {
    it('should define permissions for all roles', () => {
      expect(ROLE_PERMISSIONS.viewer).toBeDefined();
      expect(ROLE_PERMISSIONS.requester).toBeDefined();
      expect(ROLE_PERMISSIONS.approver).toBeDefined();
      expect(ROLE_PERMISSIONS.admin).toBeDefined();
    });

    it('should have viewer with minimal permissions', () => {
      const perms = ROLE_PERMISSIONS.viewer;
      expect(perms.canViewCalendar).toBe(true);
      expect(perms.canSubmitReservation).toBe(false);
      expect(perms.canCreateEvents).toBe(false);
      expect(perms.canEditEvents).toBe(false);
      expect(perms.canDeleteEvents).toBe(false);
      expect(perms.canApproveReservations).toBe(false);
      expect(perms.canViewAllReservations).toBe(false);
      expect(perms.canGenerateReservationTokens).toBe(false);
      expect(perms.isAdmin).toBe(false);
    });

    it('should have requester with submission permission', () => {
      const perms = ROLE_PERMISSIONS.requester;
      expect(perms.canViewCalendar).toBe(true);
      expect(perms.canSubmitReservation).toBe(true);
      expect(perms.canApproveReservations).toBe(false);
      expect(perms.isAdmin).toBe(false);
    });

    it('should have approver with approval permissions', () => {
      const perms = ROLE_PERMISSIONS.approver;
      expect(perms.canViewCalendar).toBe(true);
      expect(perms.canSubmitReservation).toBe(true);
      expect(perms.canCreateEvents).toBe(true);
      expect(perms.canEditEvents).toBe(true);
      expect(perms.canDeleteEvents).toBe(true);
      expect(perms.canApproveReservations).toBe(true);
      expect(perms.canViewAllReservations).toBe(true);
      expect(perms.canGenerateReservationTokens).toBe(true);
      expect(perms.isAdmin).toBe(false);
    });

    it('should have admin with full permissions', () => {
      const perms = ROLE_PERMISSIONS.admin;
      expect(perms.canViewCalendar).toBe(true);
      expect(perms.canSubmitReservation).toBe(true);
      expect(perms.canCreateEvents).toBe(true);
      expect(perms.canEditEvents).toBe(true);
      expect(perms.canDeleteEvents).toBe(true);
      expect(perms.canApproveReservations).toBe(true);
      expect(perms.canViewAllReservations).toBe(true);
      expect(perms.canGenerateReservationTokens).toBe(true);
      expect(perms.isAdmin).toBe(true);
    });
  });

  describe('DEPARTMENT_EDITABLE_FIELDS', () => {
    it('should define security department fields', () => {
      expect(DEPARTMENT_EDITABLE_FIELDS.security).toContain('doorOpenTime');
      expect(DEPARTMENT_EDITABLE_FIELDS.security).toContain('doorCloseTime');
      expect(DEPARTMENT_EDITABLE_FIELDS.security).toContain('doorNotes');
    });

    it('should define maintenance department fields', () => {
      expect(DEPARTMENT_EDITABLE_FIELDS.maintenance).toContain('setupTime');
      expect(DEPARTMENT_EDITABLE_FIELDS.maintenance).toContain('teardownTime');
      expect(DEPARTMENT_EDITABLE_FIELDS.maintenance).toContain('setupNotes');
    });
  });

  describe('getEffectiveRole', () => {
    describe('Priority 1: New role field', () => {
      it('should use role field when set', () => {
        const user = { role: 'approver' };
        expect(getEffectiveRole(user, 'user@external.com')).toBe('approver');
      });

      it('should use role field even for domain admin email', () => {
        const user = { role: 'requester' };
        expect(getEffectiveRole(user, 'staff@emanuelnyc.org')).toBe('requester');
      });

      it('should ignore invalid role values and fall through', () => {
        const user = { role: 'invalid_role' };
        expect(getEffectiveRole(user, 'staff@emanuelnyc.org')).toBe('viewer');
      });
    });

    describe('No domain-based admin fallback', () => {
      it('should NOT grant admin for emanuelnyc.org domain without a DB role', () => {
        expect(getEffectiveRole(null, 'staff@emanuelnyc.org')).toBe('viewer');
        expect(getEffectiveRole({}, 'anyone@emanuelnyc.org')).toBe('viewer');
      });

      it('should NOT grant admin for any domain email variant', () => {
        expect(getEffectiveRole(null, 'staff@EMANUELNYC.ORG')).toBe('viewer');
        expect(getEffectiveRole(null, 'staff@EmanuelNYC.Org')).toBe('viewer');
      });

      it('should respect explicit DB role for domain users', () => {
        expect(getEffectiveRole({ role: 'requester' }, 'staff@emanuelnyc.org')).toBe('requester');
        expect(getEffectiveRole({ role: 'admin' }, 'staff@emanuelnyc.org')).toBe('admin');
      });
    });

    describe('Priority 2: Legacy isAdmin flag', () => {
      it('should grant admin for isAdmin true', () => {
        const user = { isAdmin: true };
        expect(getEffectiveRole(user, 'user@external.com')).toBe('admin');
      });

      it('should not grant admin for isAdmin false', () => {
        const user = { isAdmin: false };
        expect(getEffectiveRole(user, 'user@external.com')).toBe('viewer');
      });
    });

    describe('Priority 3: Legacy granular permissions', () => {
      it('should grant approver for canViewAllReservations', () => {
        const user = { permissions: { canViewAllReservations: true } };
        expect(getEffectiveRole(user, 'user@external.com')).toBe('approver');
      });

      it('should grant approver for canGenerateReservationTokens', () => {
        const user = { permissions: { canGenerateReservationTokens: true } };
        expect(getEffectiveRole(user, 'user@external.com')).toBe('approver');
      });
    });

    describe('Priority 4: Default to viewer', () => {
      it('should default to viewer for null user', () => {
        expect(getEffectiveRole(null, 'user@external.com')).toBe('viewer');
      });

      it('should default to viewer for empty user', () => {
        expect(getEffectiveRole({}, 'user@external.com')).toBe('viewer');
      });

      it('should default to viewer for undefined email', () => {
        expect(getEffectiveRole(null, undefined)).toBe('viewer');
      });
    });
  });

  describe('hasRole', () => {
    it('should return true when user has exact role', () => {
      const user = { role: 'approver' };
      expect(hasRole(user, 'user@external.com', 'approver')).toBe(true);
    });

    it('should return true when user has higher role', () => {
      const user = { role: 'admin' };
      expect(hasRole(user, 'user@external.com', 'viewer')).toBe(true);
      expect(hasRole(user, 'user@external.com', 'requester')).toBe(true);
      expect(hasRole(user, 'user@external.com', 'approver')).toBe(true);
    });

    it('should return false when user has lower role', () => {
      const user = { role: 'requester' };
      expect(hasRole(user, 'user@external.com', 'approver')).toBe(false);
      expect(hasRole(user, 'user@external.com', 'admin')).toBe(false);
    });

    it('should handle viewer checking for viewer', () => {
      expect(hasRole(null, 'user@external.com', 'viewer')).toBe(true);
    });
  });

  describe('getPermissions', () => {
    it('should return full permission object for admin', () => {
      const perms = getPermissions({ role: 'admin' }, 'admin@test.com');
      expect(perms.role).toBe('admin');
      expect(perms.isAdmin).toBe(true);
      expect(perms.canApproveReservations).toBe(true);
    });

    it('should return limited permissions for viewer', () => {
      const perms = getPermissions(null, 'viewer@external.com');
      expect(perms.role).toBe('viewer');
      expect(perms.isAdmin).toBe(false);
      expect(perms.canApproveReservations).toBe(false);
    });

    it('should include department info', () => {
      const user = { role: 'requester', department: 'security' };
      const perms = getPermissions(user, 'user@external.com');
      expect(perms.department).toBe('security');
      expect(perms.departmentEditableFields).toContain('doorOpenTime');
      expect(perms.canEditDepartmentFields).toBe(true);
    });

    it('should handle user without department', () => {
      const perms = getPermissions({ role: 'requester' }, 'user@external.com');
      expect(perms.department).toBeNull();
      expect(perms.departmentEditableFields).toEqual([]);
      expect(perms.canEditDepartmentFields).toBe(false);
    });
  });

  describe('getValidRoles', () => {
    it('should return all valid role names', () => {
      const roles = getValidRoles();
      expect(roles).toContain('viewer');
      expect(roles).toContain('requester');
      expect(roles).toContain('approver');
      expect(roles).toContain('admin');
      expect(roles).toHaveLength(4);
    });
  });

  describe('isValidRole', () => {
    it('should return true for valid roles', () => {
      expect(isValidRole('viewer')).toBe(true);
      expect(isValidRole('requester')).toBe(true);
      expect(isValidRole('approver')).toBe(true);
      expect(isValidRole('admin')).toBe(true);
    });

    it('should return false for invalid roles', () => {
      expect(isValidRole('superuser')).toBe(false);
      expect(isValidRole('ADMIN')).toBe(false);
      expect(isValidRole('')).toBe(false);
      expect(isValidRole(null)).toBe(false);
    });
  });

  describe('getDepartmentEditableFields', () => {
    it('should return security fields for security department', () => {
      const fields = getDepartmentEditableFields({ department: 'security' });
      expect(fields).toContain('doorOpenTime');
      expect(fields).toContain('doorCloseTime');
    });

    it('should return maintenance fields for maintenance department', () => {
      const fields = getDepartmentEditableFields({ department: 'maintenance' });
      expect(fields).toContain('setupTime');
      expect(fields).toContain('teardownTime');
    });

    it('should return empty array for no department', () => {
      expect(getDepartmentEditableFields({})).toEqual([]);
      expect(getDepartmentEditableFields(null)).toEqual([]);
      expect(getDepartmentEditableFields({ department: null })).toEqual([]);
    });

    it('should return empty array for unknown department', () => {
      expect(getDepartmentEditableFields({ department: 'unknown' })).toEqual([]);
    });
  });

  describe('canEditField', () => {
    it('should allow approvers to edit any field', () => {
      const user = { role: 'approver' };
      expect(canEditField(user, 'user@test.com', 'doorOpenTime')).toBe(true);
      expect(canEditField(user, 'user@test.com', 'setupTime')).toBe(true);
      expect(canEditField(user, 'user@test.com', 'anyField')).toBe(true);
    });

    it('should allow admins to edit any field', () => {
      const user = { role: 'admin' };
      expect(canEditField(user, 'user@test.com', 'doorOpenTime')).toBe(true);
      expect(canEditField(user, 'user@test.com', 'anyField')).toBe(true);
    });

    it('should allow security to edit only door fields', () => {
      const user = { role: 'requester', department: 'security' };
      expect(canEditField(user, 'user@external.com', 'doorOpenTime')).toBe(true);
      expect(canEditField(user, 'user@external.com', 'doorCloseTime')).toBe(true);
      expect(canEditField(user, 'user@external.com', 'setupTime')).toBe(false);
    });

    it('should allow maintenance to edit only setup fields', () => {
      const user = { role: 'requester', department: 'maintenance' };
      expect(canEditField(user, 'user@external.com', 'setupTime')).toBe(true);
      expect(canEditField(user, 'user@external.com', 'teardownTime')).toBe(true);
      expect(canEditField(user, 'user@external.com', 'doorOpenTime')).toBe(false);
    });

    it('should deny viewers from editing any field', () => {
      expect(canEditField(null, 'user@external.com', 'doorOpenTime')).toBe(false);
      expect(canEditField({}, 'user@external.com', 'setupTime')).toBe(false);
    });
  });

  describe('DEFAULT_ADMIN_DOMAIN', () => {
    it('should be set to emanuelnyc.org', () => {
      expect(DEFAULT_ADMIN_DOMAIN).toBe('@emanuelnyc.org');
    });
  });
});
