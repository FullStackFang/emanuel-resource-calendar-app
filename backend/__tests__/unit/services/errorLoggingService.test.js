/**
 * Tests for errorLoggingService.js
 *
 * Tests the pure functions in the error logging service.
 * MongoDB-dependent functions are tested separately with mongodb-memory-server.
 *
 * Note: This service was simplified - Sentry now handles automatic error capture.
 * This module only handles user-submitted reports stored in MongoDB.
 */

const {
  generateCorrelationId,
  sanitizeData,
} = require('../../../services/errorLoggingService');

describe('errorLoggingService', () => {
  describe('generateCorrelationId', () => {
    it('generates unique IDs', () => {
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();

      expect(id1).not.toBe(id2);
    });

    it('generates IDs with expected format', () => {
      const id = generateCorrelationId();

      // Format: rpt-{timestamp}-{random}
      expect(id).toMatch(/^rpt-\d+-[a-z0-9]+$/);
    });

    it('includes timestamp component', () => {
      const before = Date.now();
      const id = generateCorrelationId();
      const after = Date.now();

      // Extract timestamp from ID
      const parts = id.split('-');
      const timestamp = parseInt(parts[1], 10);

      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('sanitizeData', () => {
    it('redacts password fields', () => {
      const data = {
        username: 'john',
        password: 'secret123',
        email: 'john@example.com'
      };

      const sanitized = sanitizeData(data);

      expect(sanitized.username).toBe('john');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.email).toBe('john@example.com');
    });

    it('redacts various token fields', () => {
      const data = {
        accessToken: 'eyJhbGciOiJIUzI1...',
        access_token: 'eyJhbGciOiJIUzI1...',
        refreshToken: 'refresh-token-value',
        refresh_token: 'refresh-token-value',
        apiKey: 'sk-1234567890',
        api_key: 'sk-1234567890'
      };

      const sanitized = sanitizeData(data);

      expect(sanitized.accessToken).toBe('[REDACTED]');
      expect(sanitized.access_token).toBe('[REDACTED]');
      expect(sanitized.refreshToken).toBe('[REDACTED]');
      expect(sanitized.refresh_token).toBe('[REDACTED]');
      expect(sanitized.apiKey).toBe('[REDACTED]');
      expect(sanitized.api_key).toBe('[REDACTED]');
    });

    it('redacts authorization headers', () => {
      const data = {
        headers: {
          authorization: 'Bearer eyJhbGciOiJIUzI1...',
          'x-graph-token': 'graph-token-value',
          'Content-Type': 'application/json'
        }
      };

      const sanitized = sanitizeData(data);

      expect(sanitized.headers.authorization).toBe('[REDACTED]');
      expect(sanitized.headers['x-graph-token']).toBe('[REDACTED]');
      expect(sanitized.headers['Content-Type']).toBe('application/json');
    });

    it('recursively sanitizes nested objects', () => {
      const data = {
        user: {
          name: 'John',
          config: {
            password: 'secret',
            apiKey: 'key123'
          }
        }
      };

      const sanitized = sanitizeData(data);

      expect(sanitized.user.name).toBe('John');
      expect(sanitized.user.config.password).toBe('[REDACTED]');
      expect(sanitized.user.config.apiKey).toBe('[REDACTED]');
    });

    it('redacts entire object when key contains sensitive word', () => {
      // 'credentials' contains 'credential' which is a sensitive keyword
      const data = {
        credentials: {
          password: 'secret'
        }
      };

      const sanitized = sanitizeData(data);

      // The entire credentials object is redacted because the key contains 'credential'
      expect(sanitized.credentials).toBe('[REDACTED]');
    });

    it('handles null and undefined', () => {
      expect(sanitizeData(null)).toBeNull();
      expect(sanitizeData(undefined)).toBeUndefined();
    });

    it('does not mutate original object', () => {
      const original = {
        password: 'secret',
        name: 'John'
      };
      const originalPassword = original.password;

      sanitizeData(original);

      expect(original.password).toBe(originalPassword);
    });

    it('handles case-insensitive matching', () => {
      const data = {
        PASSWORD: 'secret',
        ApiKey: 'key123',
        Authorization: 'Bearer token'
      };

      const sanitized = sanitizeData(data);

      expect(sanitized.PASSWORD).toBe('[REDACTED]');
      expect(sanitized.ApiKey).toBe('[REDACTED]');
      expect(sanitized.Authorization).toBe('[REDACTED]');
    });

    it('redacts fields containing sensitive keywords', () => {
      const data = {
        userPassword: 'secret',
        authToken: 'token123',
        privateKey: 'key-value',
        clientSecret: 'secret-value'
      };

      const sanitized = sanitizeData(data);

      expect(sanitized.userPassword).toBe('[REDACTED]');
      expect(sanitized.authToken).toBe('[REDACTED]');
      expect(sanitized.privateKey).toBe('[REDACTED]');
      expect(sanitized.clientSecret).toBe('[REDACTED]');
    });
  });
});
