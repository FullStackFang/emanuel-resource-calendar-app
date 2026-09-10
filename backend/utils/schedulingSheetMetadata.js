const METADATA_ROLE_BY_LEGACY_LABEL = Object.freeze({
  location: 'location',
  'call time': 'callTime',
  'doors open': 'doorsOpen',
  begins: 'begins',
  ends: 'ends',
});

const VALID_METADATA_ROLES = new Set(Object.values(METADATA_ROLE_BY_LEGACY_LABEL));

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function legacyMetadataRole(label) {
  if (typeof label !== 'string') return null;
  return METADATA_ROLE_BY_LEGACY_LABEL[label.trim().toLowerCase()] || null;
}

function validateExplicitMetadataRoles(rows) {
  const owners = new Set();
  for (const row of rows || []) {
    if (!hasOwn(row, 'metadataRole')) continue;
    const role = row.metadataRole;
    if (role !== null && !VALID_METADATA_ROLES.has(role)) {
      return 'metadata role must be location, callTime, doorsOpen, begins, ends, or null';
    }
    if (role !== null) {
      if (owners.has(role)) return `metadata role '${role}' may only be assigned once`;
      owners.add(role);
    }
  }
  return null;
}

function resolveMetadataRows(rows) {
  const resolved = {};
  const explicitRoles = new Set();
  for (const row of rows || []) {
    if (VALID_METADATA_ROLES.has(row.metadataRole)) {
      resolved[row.metadataRole] = row;
      explicitRoles.add(row.metadataRole);
    }
  }
  for (const row of rows || []) {
    if (hasOwn(row, 'metadataRole')) continue;
    const role = legacyMetadataRole(row.label);
    if (role && !explicitRoles.has(role)) resolved[role] = row;
  }
  return resolved;
}

function normalizeSheetRows(rows, persistedRows = []) {
  const persistedById = new Map((persistedRows || []).map((row) => [row.id, row]));
  const merged = rows.map((row) => {
    if (hasOwn(row, 'metadataRole')) return { ...row };
    const persisted = persistedById.get(row.id);
    if (persisted && hasOwn(persisted, 'metadataRole')) {
      return { ...row, metadataRole: persisted.metadataRole };
    }
    return { ...row };
  });

  const explicitError = validateExplicitMetadataRoles(merged);
  if (explicitError) return { error: explicitError, rows: null };

  const explicitRoles = new Set(
    merged
      .filter((row) => hasOwn(row, 'metadataRole') && row.metadataRole !== null)
      .map((row) => row.metadataRole)
  );
  const legacyWinnerByRole = new Map();
  merged.forEach((row, index) => {
    if (hasOwn(row, 'metadataRole')) return;
    const role = legacyMetadataRole(row.label);
    if (role && !explicitRoles.has(role)) legacyWinnerByRole.set(role, index);
  });

  return {
    error: null,
    rows: merged.map((row, index) => {
      if (hasOwn(row, 'metadataRole')) return row;
      const role = legacyMetadataRole(row.label);
      return {
        ...row,
        metadataRole: role && legacyWinnerByRole.get(role) === index ? role : null,
      };
    }),
  };
}

module.exports = {
  VALID_METADATA_ROLES,
  legacyMetadataRole,
  validateExplicitMetadataRoles,
  resolveMetadataRows,
  normalizeSheetRows,
};
