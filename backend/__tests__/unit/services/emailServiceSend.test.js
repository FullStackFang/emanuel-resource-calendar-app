/**
 * emailService.sendEmail transport contract (ES-1 to ES-3)
 *
 * The scheduling-sheet fan-out wraps sendEmail in withGraphRetry, whose
 * predicate reads `err.status`. A bare `new Error('Graph API error: 429 ...')`
 * would never match, so a throttled send would be reported as a permanent
 * failure. These tests pin the error SHAPE (status + Retry-After) and the
 * token cache's in-flight de-duplication under a cold start.
 */

process.env.EMAIL_ENABLED = 'true';
process.env.EMAIL_CLIENT_SECRET = 'test-secret';

const mockAcquireToken = jest.fn();
jest.mock('@azure/msal-node', () => ({
  ConfidentialClientApplication: jest.fn(() => ({ acquireTokenByClientCredential: mockAcquireToken })),
}));

jest.mock('../../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const emailService = require('../../../services/emailService');
const { isRetryableGraphError } = require('../../../utils/graphRetry');

function graphResponse(status, { retryAfter } = {}) {
  const headers = new Map();
  if (retryAfter !== undefined) headers.set('retry-after', String(retryAfter));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
    text: async () => JSON.stringify({ error: { code: 'ApplicationThrottled', message: `status ${status}` } }),
  };
}

describe('emailService.sendEmail transport contract', () => {
  let fetchSpy;

  beforeEach(() => {
    emailService._resetTokenCacheForTest();
    mockAcquireToken.mockReset();
    mockAcquireToken.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { accessToken: 'tok', expiresOn: new Date(Date.now() + 3600000) };
    });
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test('ES-1 a 429 throws an error carrying status and Retry-After in ms, and it is retryable', async () => {
    fetchSpy.mockResolvedValue(graphResponse(429, { retryAfter: 7 }));

    let caught;
    try {
      await emailService.sendEmail('a@x.org', 'S', '<p>b</p>');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    expect(caught.status).toBe(429);
    expect(caught.retryAfterMs).toBe(7000);
    expect(isRetryableGraphError(caught)).toBe(true);
  });

  test('ES-2 a 400 carries its status and is NOT retryable', async () => {
    fetchSpy.mockResolvedValue(graphResponse(400));

    let caught;
    try {
      await emailService.sendEmail('a@x.org', 'S', '<p>b</p>');
    } catch (e) {
      caught = e;
    }

    expect(caught.status).toBe(400);
    expect(caught.retryAfterMs).toBeUndefined();
    expect(isRetryableGraphError(caught)).toBe(false);
  });

  test('ES-3 concurrent sends on a cold token cache acquire ONE token, not one per send', async () => {
    fetchSpy.mockResolvedValue(graphResponse(202));

    await Promise.all(
      Array.from({ length: 8 }, (_, i) => emailService.sendEmail(`p${i}@x.org`, 'S', '<p>b</p>'))
    );

    expect(mockAcquireToken).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(8);
  });
});
