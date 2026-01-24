/**
 * Tests for errorLoggingService.js
 *
 * Tests the pure functions in the error logging service.
 * MongoDB-dependent functions are tested separately with mongodb-memory-server.
 */

const {
  generateFingerprint,
  sanitizeData,
  determineSeverity
} = require('../../../services/errorLoggingService');

describe('errorLoggingService', () => {
  describe('generateFingerprint', () => {
    it('generates consistent fingerprint for same error', () => {
      const errorData = {
        message: 'Connection timeout',
        stack: 'Error: Connection timeout\n    at connect (file.js:10)\n    at main (file.js:20)',
        source: 'backend',
        endpoint: '/api/events'
      };

      const fingerprint1 = generateFingerprint(errorData);
      const fingerprint2 = generateFingerprint(errorData);

      expect(fingerprint1).toBe(fingerprint2);
      expect(fingerprint1).toMatch(/^[a-f0-9]{32}$/); // MD5 hash format
    });

    it('generates different fingerprints for different errors', () => {
      const error1 = {
        message: 'Connection timeout',
        source: 'backend'
      };
      const error2 = {
        message: 'Authentication failed',
        source: 'backend'
      };

      const fingerprint1 = generateFingerprint(error1);
      const fingerprint2 = generateFingerprint(error2);

      expect(fingerprint1).not.toBe(fingerprint2);
    });

    it('uses only first 3 lines of stack trace', () => {
      const error1 = {
        message: 'Error',
        stack: 'Error\n    at line1\n    at line2\n    at line3\n    at line4\n    at line5',
        source: 'backend'
      };
      const error2 = {
        message: 'Error',
        stack: 'Error\n    at line1\n    at line2\n    at line3\n    at different4\n    at different5',
        source: 'backend'
      };

      const fingerprint1 = generateFingerprint(error1);
      const fingerprint2 = generateFingerprint(error2);

      // Should be same because only first 3 lines matter
      expect(fingerprint1).toBe(fingerprint2);
    });

    it('handles missing fields gracefully', () => {
      const minimalError = { message: 'Error' };
      const emptyError = {};

      expect(() => generateFingerprint(minimalError)).not.toThrow();
      expect(() => generateFingerprint(emptyError)).not.toThrow();

      const fingerprint1 = generateFingerprint(minimalError);
      const fingerprint2 = generateFingerprint(emptyError);

      expect(fingerprint1).toMatch(/^[a-f0-9]{32}$/);
      expect(fingerprint2).toMatch(/^[a-f0-9]{32}$/);
    });

    it('includes endpoint in fingerprint calculation', () => {
      const error1 = {
        message: 'Error',
        source: 'backend',
        endpoint: '/api/events'
      };
      const error2 = {
        message: 'Error',
        source: 'backend',
        endpoint: '/api/users'
      };

      const fingerprint1 = generateFingerprint(error1);
      const fingerprint2 = generateFingerprint(error2);

      expect(fingerprint1).not.toBe(fingerprint2);
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

  describe('determineSeverity', () => {
    describe('critical severity', () => {
      it('returns critical for 500+ status codes', () => {
        expect(determineSeverity(500, 'error')).toBe('critical');
        expect(determineSeverity(502, 'error')).toBe('critical');
        expect(determineSeverity(503, 'error')).toBe('critical');
      });

      it('returns critical for unhandledRejection', () => {
        expect(determineSeverity(null, 'unhandledRejection')).toBe('critical');
        expect(determineSeverity(200, 'unhandledRejection')).toBe('critical');
      });

      it('returns critical for uncaughtException', () => {
        expect(determineSeverity(null, 'uncaughtException')).toBe('critical');
        expect(determineSeverity(200, 'uncaughtException')).toBe('critical');
      });
    });

    describe('medium severity', () => {
      it('returns medium for 401 Unauthorized', () => {
        expect(determineSeverity(401, 'error')).toBe('medium');
      });

      it('returns medium for 403 Forbidden', () => {
        expect(determineSeverity(403, 'error')).toBe('medium');
      });
    });

    describe('low severity', () => {
      it('returns low for 400 Bad Request', () => {
        expect(determineSeverity(400, 'error')).toBe('low');
      });

      it('returns low for 404 Not Found', () => {
        expect(determineSeverity(404, 'error')).toBe('low');
      });

      it('returns low for 422 Unprocessable Entity', () => {
        expect(determineSeverity(422, 'error')).toBe('low');
      });

      it('returns low for other 4xx errors', () => {
        expect(determineSeverity(409, 'error')).toBe('low');
        expect(determineSeverity(429, 'error')).toBe('low');
      });
    });

    describe('high severity (default)', () => {
      it('returns high for unknown status codes', () => {
        expect(determineSeverity(null, 'error')).toBe('high');
        expect(determineSeverity(undefined, 'error')).toBe('high');
      });

      it('returns high for non-standard codes', () => {
        expect(determineSeverity(0, 'error')).toBe('high');
        expect(determineSeverity(200, 'error')).toBe('high'); // Success code shouldn't be logged as error
      });
    });
  });
});
