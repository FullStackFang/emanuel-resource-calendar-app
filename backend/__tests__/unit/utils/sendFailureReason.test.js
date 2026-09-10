/**
 * sendFailureReason (SFR-1 to SFR-6)
 *
 * Turns a per-recipient send failure into one of four reason codes the panel
 * can phrase for a human. The raw error text still travels beside it; this is
 * the classification, not a replacement. Only the server sees the HTTP
 * status, which is why the mapping lives here and not in the client.
 */

const { sendFailureReason } = require('../../../utils/sendFailureReason');
const { graphError, graphNetworkError } = require('../../__helpers__/graphApiMock');

describe('sendFailureReason', () => {
  test('SFR-1 a 429 is throttled', () => {
    expect(sendFailureReason(graphError(429, 'Application is over its MailboxConcurrency limit.'))).toBe('throttled');
  });

  test('SFR-2 any other 4xx is rejected (the mail server refused this message)', () => {
    expect(sendFailureReason(graphError(400, 'Invalid recipient'))).toBe('rejected');
    expect(sendFailureReason(graphError(404, 'Mailbox not found'))).toBe('rejected');
    expect(sendFailureReason(graphError(413, 'Too large'))).toBe('rejected');
  });

  test('SFR-3 a 5xx is unavailable', () => {
    expect(sendFailureReason(graphError(503, 'Service Unavailable'))).toBe('unavailable');
    expect(sendFailureReason(graphError(500, 'Internal'))).toBe('unavailable');
  });

  test('SFR-4 a network failure, the way undici reports it, is unavailable', () => {
    expect(sendFailureReason(graphNetworkError('ECONNRESET'))).toBe('unavailable');
    expect(sendFailureReason(graphNetworkError('ENOTFOUND'))).toBe('unavailable');
  });

  test('SFR-5 an open Graph circuit breaker is unavailable, not unknown', () => {
    const err = new Error('Circuit breaker open — Graph under sustained pressure');
    err.code = 'CIRCUIT_BREAKER_OPEN';
    expect(sendFailureReason(err)).toBe('unavailable');
  });

  test('SFR-6 anything else, including nothing at all, is unknown', () => {
    expect(sendFailureReason(new Error('No valid email recipients'))).toBe('unknown');
    expect(sendFailureReason(null)).toBe('unknown');
    expect(sendFailureReason(undefined)).toBe('unknown');
  });
});
