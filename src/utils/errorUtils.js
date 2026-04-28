// src/utils/errorUtils.js

/**
 * True for the DOMException thrown when an in-flight fetch is aborted via
 * AbortController.abort(). Use in catch blocks to silently swallow superseded
 * requests without classifying them as real errors.
 */
export const isAbortError = (err) => err?.name === 'AbortError';
