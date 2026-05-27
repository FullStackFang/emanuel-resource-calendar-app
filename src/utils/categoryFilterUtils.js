// Map selected category NAMES to registered category ObjectId strings.
// Names with no registered match are omitted (the backend's transitional name
// fallback still matches them). 'Uncategorized' is never an id.
export function selectedNamesToCategoryIds(selectedNames, baseCategories) {
  const byName = new Map(
    (baseCategories || [])
      .filter(c => c && c.name)
      .map(c => [c.name.trim().toLowerCase(), c._id])
  );
  return (selectedNames || [])
    .filter(n => n && n !== 'Uncategorized')
    .map(n => byName.get(n.trim().toLowerCase()))
    .filter(Boolean)
    .map(String);
}
