/** Display-only labels on a person's scheduling sheet chip. */
function formatDetails(details) {
  if (!Array.isArray(details)) return '';
  return details
    .map((detail) => detail?.type === 'text' ? detail.text : detail?.type === 'location' ? detail.name : '')
    .filter(Boolean)
    .join(' · ');
}

module.exports = { formatDetails };
