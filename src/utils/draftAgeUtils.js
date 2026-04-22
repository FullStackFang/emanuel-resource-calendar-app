const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function formatDraftAge(ts, now = Date.now()) {
  if (!ts) return null;
  const then = new Date(ts).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((now - then) / MS_PER_DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day old';
  return `${days} days old`;
}
