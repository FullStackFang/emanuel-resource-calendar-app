// backend/utils/concurrencyRules.js
//
// The single definition of whether two events sharing a room and an
// overlapping time window actually constitute a conflict.
//
// This logic used to live inside the `actualConflicts` filter closure in
// checkRoomConflicts() (api-server.js), with a hand-copied second instance in
// the pending-edit loop directly beneath it. Both now call this function.
//
// WHY EXTRACT RATHER THAN COPY: the conflict report answers the same question
// across the whole calendar. A second copy of these rules would drift, and
// drift here means the report tells an approver to fix something publish
// considers legal — which destroys the report's credibility on first contact.
// This codebase has already been bitten by exactly that: the admin-save
// recurring gate checked `totalHardConflicts`, a field that never existed, so
// a check that read correctly did nothing at all for months.
//
// This is a PURE MOVE. The branch order and every verdict are identical to the
// code it replaces, including its asymmetry (see the note on the per-event
// fallback below). Rule changes belong in their own change, where they can be
// reasoned about against the publish path they would alter.
//
// Pure: no I/O, no logger, no database. The category map is resolved by the
// caller (getCachedCategories()).

/**
 * Collect the distinct id strings of the categories a side carries.
 * A name with no document in the map contributes nothing — legacy events carry
 * category names that no longer exist, and those must not throw.
 * @param {string[]} names
 * @param {Map<string, {_id: any, allowedConcurrentCategories?: any[]}>} categoryMap
 * @returns {string[]}
 */
function resolveCategoryIds(names, categoryMap) {
  const ids = [];
  for (const name of names) {
    const id = categoryMap?.get?.(name)?._id;
    if (!id) continue;
    const str = id.toString();
    if (!ids.includes(str)) ids.push(str);
  }
  return ids;
}

/**
 * Collect the id strings every category on a side grants concurrency to.
 * @param {string[]} names
 * @param {Map<string, {_id: any, allowedConcurrentCategories?: any[]}>} categoryMap
 * @returns {string[]}
 */
function resolveGrantedCategoryIds(names, categoryMap) {
  const granted = [];
  for (const name of names) {
    const doc = categoryMap?.get?.(name);
    for (const allowedId of doc?.allowedConcurrentCategories || []) {
      const str = allowedId.toString();
      if (!granted.includes(str)) granted.push(str);
    }
  }
  return granted;
}

/**
 * Read a side's category names, tolerating both the flat and the nested shape.
 * Conflict-projection documents carry `calendarData.categories`; constructed
 * reservation literals carry `categories`.
 * @param {Object} side
 * @returns {string[]}
 */
function categoriesOf(side) {
  return side?.categories || side?.calendarData?.categories || [];
}

/**
 * Decide whether an overlapping pair in a shared room is a real conflict.
 *
 * Evaluation order — preserved exactly from checkRoomConflicts():
 *   1. A's categories grant B's        -> not a conflict
 *   2. B's categories grant A's        -> not a conflict
 *   3. neither side allows concurrency -> conflict
 *   4. B allows concurrency            -> its restriction list decides
 *   5. A allows concurrency            -> not a conflict
 *
 * ASYMMETRY, DELIBERATELY PRESERVED (pinned by CRU-12): step 5 does not
 * consult side A's restriction list, because step 4 has already returned when
 * B allows concurrency. So an A that allows concurrency restricted to
 * categories B does not carry is still permissive. That is what the
 * publish-time check does today; changing it here would change what the system
 * lets people book, which is not this function's job.
 *
 * @param {Object} sideA - { categories | calendarData.categories, isAllowedConcurrent, allowedConcurrentCategories }
 * @param {Object} sideB - same shape
 * @param {Map<string, Object>} categoryMap - category name -> category document
 * @returns {boolean} true when the pair is a genuine conflict
 */
function isRealConflict(sideA, sideB, categoryMap) {
  const aCategories = categoriesOf(sideA);
  const bCategories = categoriesOf(sideB);

  const aCategoryIds = resolveCategoryIds(aCategories, categoryMap);
  const bCategoryIds = resolveCategoryIds(bCategories, categoryMap);

  // --- Category-level bilateral check ---
  const aGrantedIds = resolveGrantedCategoryIds(aCategories, categoryMap);
  if (bCategoryIds.some((id) => aGrantedIds.includes(id))) return false; // NOT a conflict

  const bGrantedIds = resolveGrantedCategoryIds(bCategories, categoryMap);
  if (aCategoryIds.some((id) => bGrantedIds.includes(id))) return false; // NOT a conflict

  // --- Per-event fallback (legacy) ---
  const aAllowsConcurrent = sideA?.isAllowedConcurrent ?? false;
  const bAllowsConcurrent = sideB?.isAllowedConcurrent ?? false;

  if (!aAllowsConcurrent && !bAllowsConcurrent) {
    return true; // IS a conflict
  }

  if (bAllowsConcurrent) {
    const allowedCategories = sideB?.allowedConcurrentCategories || [];
    if (allowedCategories.length === 0) {
      return false; // NOT a conflict (no restrictions)
    }
    const allowedCategoryStrings = allowedCategories.map((id) => id.toString());
    const hasMatchingCategory = aCategoryIds.some((catId) => allowedCategoryStrings.includes(catId));
    return !hasMatchingCategory;
  }

  if (aAllowsConcurrent) {
    return false; // NOT a conflict
  }

  return false; // NOT a conflict
}

module.exports = {
  isRealConflict,
};
