/**
 * Authentication helpers for integration tests
 *
 * Generates mock JWT tokens for testing with real key pairs.
 * This exercises the actual auth middleware path with test-controlled keys.
 */

const jose = require('jose');

let privateKey;
let publicKey;
let publicKeyJwk;
let initialized = false;

/**
 * Initialize RSA key pair for signing test tokens
 * Call this once before tests that need authentication
 */
async function initTestKeys() {
  if (initialized) return;

  const keys = await jose.generateKeyPair('RS256', { extractable: true });
  privateKey = keys.privateKey;
  publicKey = keys.publicKey;

  // Export public key as JWK for JWKS endpoint mock
  publicKeyJwk = await jose.exportJWK(publicKey);
  publicKeyJwk.kid = 'test-key-id';
  publicKeyJwk.alg = 'RS256';
  publicKeyJwk.use = 'sig';

  initialized = true;
}

/**
 * Get the JWKS (JSON Web Key Set) for mocking the JWKS endpoint
 * @returns {Object} JWKS object
 */
function getTestJwks() {
  if (!initialized) {
    throw new Error('Test keys not initialized. Call initTestKeys() first.');
  }
  return {
    keys: [publicKeyJwk],
  };
}

/**
 * Create a mock JWT token for a user
 * @param {Object} user - User object with email, displayName, etc.
 * @param {Object} options - Token options
 * @returns {Promise<string>} Signed JWT token
 */
async function createMockToken(user, options = {}) {
  if (!initialized) {
    await initTestKeys();
  }

  const now = Math.floor(Date.now() / 1000);

  const payload = {
    // Standard claims
    iss: options.issuer || 'https://login.microsoftonline.com/test-tenant-id/v2.0',
    sub: user.odataId || user.email,
    aud: options.audience || 'api://test-client-id',
    iat: now,
    nbf: now,
    exp: now + (options.expiresIn || 3600),

    // Azure AD specific claims
    oid: user.odataId || `oid-${user.email}`,
    preferred_username: user.email,
    name: user.displayName || user.email,
    tid: options.tenantId || 'test-tenant-id',
    azp: options.azp || 'test-client-id',
    ver: '2.0',

    // Optional role claims
    roles: user.roles || [],

    // Custom claims
    ...options.claims,
  };

  const token = await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-id' })
    .sign(privateKey);

  return token;
}

/**
 * Create an expired token for testing token validation
 * @param {Object} user - User object
 * @returns {Promise<string>} Expired JWT token
 */
async function createExpiredToken(user) {
  return createMockToken(user, {
    expiresIn: -3600, // Expired 1 hour ago
  });
}

/**
 * Create a token with invalid signature (for testing signature validation)
 * @param {Object} user - User object
 * @returns {Promise<string>} Token with invalid signature
 */
async function createInvalidSignatureToken(user) {
  const validToken = await createMockToken(user);
  // Corrupt the signature by changing the last character
  return validToken.slice(0, -1) + (validToken.slice(-1) === 'a' ? 'b' : 'a');
}

/**
 * Create authorization header value
 * @param {Object} user - User object
 * @returns {Promise<string>} Bearer token header value
 */
async function createAuthHeader(user) {
  const token = await createMockToken(user);
  return `Bearer ${token}`;
}

/**
 * Get test user info from token payload
 * @param {string} token - JWT token
 * @returns {Object} Decoded payload (without verification)
 */
function decodeToken(token) {
  const payload = jose.decodeJwt(token);
  return payload;
}

/**
 * Reset test keys (call if you need fresh keys)
 */
function resetTestKeys() {
  privateKey = null;
  publicKey = null;
  publicKeyJwk = null;
  initialized = false;
}

/**
 * Check if keys are initialized
 * @returns {boolean} True if keys are ready
 */
function isInitialized() {
  return initialized;
}

module.exports = {
  initTestKeys,
  getTestJwks,
  createMockToken,
  createExpiredToken,
  createInvalidSignatureToken,
  createAuthHeader,
  decodeToken,
  resetTestKeys,
  isInitialized,
};
