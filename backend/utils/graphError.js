// backend/utils/graphError.js
//
// The ONE constructor for "a Microsoft Graph call failed" errors.
//
// This lives in its own module so the production service and the test mock can
// share it without either requiring the other. graphApiService re-exports
// buildGraphError; __tests__/__helpers__/graphApiMock imports it directly.
//
// Why it exists at all: graphApiService throws errors carrying `status`, but
// every outer retry predicate in the codebase was written against `statusCode`,
// so Graph 429s never matched and the retries were dead code. That survived
// review because graphApiMock hand-rolled its own error objects with whatever
// property the test author happened to pick. Sharing the constructor makes
// mock/production drift structurally impossible rather than merely discouraged.

/**
 * Build the error graphApiService throws for a non-OK Graph response.
 *
 * @param {number} status - HTTP status from the Graph response
 * @param {string} [message] - Graph's error message, if it sent one
 * @param {object} [graphError] - the raw `error` object from the Graph payload
 * @returns {Error} error with `status` and `graphError` attached
 */
function buildGraphError(status, message, graphError) {
  const error = new Error(message || `Graph API error: ${status}`);
  error.status = status;
  error.graphError = graphError;
  return error;
}

module.exports = { buildGraphError };
