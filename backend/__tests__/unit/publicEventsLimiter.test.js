/**
 * Public events rate limiter (PEL)
 *
 * The guest calendar gets its own limiter because mobile carriers share one CGNAT
 * IP across many subscribers — publicLimiter's 100/15min would throttle real guests.
 * These tests lock the two things that matter: the deliberate (loose) default size,
 * and that exceeding the limit yields a 429 with a JSON body rather than an HTML error.
 *
 * The default (600) is asserted rather than exercised: driving 601 requests through
 * supertest would add seconds to the suite for no extra coverage. The 429 path is
 * exercised through the same factory with a tiny max.
 */

const express = require('express');
const request = require('supertest');

const { publicEventsLimiter, createPublicEventsLimiter } = require('../../middleware/rateLimiter');

function appWithLimiter(limiter) {
  const app = express();
  app.set('trust proxy', false);
  app.use('/api/public/events', limiter);
  app.get('/api/public/events', (req, res) => res.status(200).json({ events: [] }));
  return app;
}

describe('Public events rate limiter (PEL)', () => {
  it('PEL-1: default limit is sized for shared carrier IPs, not publicLimiter (100)', async () => {
    const app = appWithLimiter(publicEventsLimiter);

    const res = await request(app).get('/api/public/events').expect(200);

    expect(Number(res.headers['ratelimit-limit'])).toBe(600);
  });

  it('PEL-2: responds 429 with a JSON body once the limit is exceeded', async () => {
    const app = appWithLimiter(createPublicEventsLimiter({ max: 2 }));

    await request(app).get('/api/public/events').expect(200);
    await request(app).get('/api/public/events').expect(200);

    const res = await request(app).get('/api/public/events').expect(429);

    expect(res.body).toMatchObject({
      error: 'Too many requests',
      retryAfter: '15 minutes',
    });
    expect(res.body.message).toMatch(/public calendar/i);
  });
});
