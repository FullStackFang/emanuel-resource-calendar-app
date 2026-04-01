// src/utils/textUtils.js

/**
 * Extract plain text from HTML content (e.g., from Microsoft Graph API)
 * Preserves paragraph structure by converting block elements to newlines
 * @param {string} htmlContent - HTML content from Microsoft Graph API
 * @returns {string} - Clean plain text with preserved paragraph breaks
 */
export const extractTextFromHtml = (htmlContent) => {
  if (!htmlContent || typeof htmlContent !== 'string') {
    return '';
  }

  let content = htmlContent;

  // First, decode HTML entities to restore actual HTML tags
  content = content
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Convert block-level elements to newlines BEFORE removing tags
  content = content
    .replace(/<br\s*\/?>/gi, '\n')           // <br> to newline
    .replace(/<\/div>/gi, '\n')               // </div> to newline
    .replace(/<\/p>/gi, '\n\n')               // </p> to double newline
    .replace(/<\/li>/gi, '\n')                // </li> to newline
    .replace(/<\/tr>/gi, '\n');               // </tr> to newline

  // Remove all remaining HTML tags
  content = content.replace(/<[^>]*>/g, '');

  // Replace &nbsp; with spaces
  content = content.replace(/&nbsp;/g, ' ');

  // Clean up whitespace while preserving newlines
  content = content
    .replace(/[^\S\n]+/g, ' ')                // Collapse spaces (not newlines)
    .replace(/\n\s+/g, '\n')                  // Remove leading spaces after newlines
    .replace(/\s+\n/g, '\n')                  // Remove trailing spaces before newlines
    .replace(/\n{3,}/g, '\n\n')               // Max 2 consecutive newlines
    .trim();

  // Handle double-encoded content (recursive call)
  if (content.includes('&lt;') || content.includes('&gt;')) {
    return extractTextFromHtml(content);
  }

  return content || '';
};
