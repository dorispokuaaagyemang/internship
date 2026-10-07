import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { config } from '../../src/config/index.js';
import { createApp } from '../../src/app.js';

// Own file so the exhausted in-memory limit doesn't leak into the auth tests.
vi.mock('../../src/db/models/index.js', () => ({ sequelize: {}, User: {}, RefreshToken: {} }));
vi.mock('../../src/lib/redis.js', () => ({ default: {} }));
vi.mock('../../src/modules/audit/service.js', () => ({ record: vi.fn() }));

describe('auth rate limit (ARCHITECTURE.md §4.2)', () => {
  it('returns 429 once one IP uses up the limit', async () => {
    const app = createApp();
    // An empty body fails validation (422), which still counts towards the limit.
    for (let i = 0; i < config.auth.rateLimit; i += 1) {
      expect((await request(app).post('/api/v1/auth/login').send({})).status).toBe(422);
    }

    const res = await request(app).post('/api/v1/auth/login').send({});

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
  });
});

describe('general API rate limit', () => {
  it('sends the standard RateLimit headers on API routes but not on the health check', async () => {
    const app = createApp();

    const api = await request(app).get('/api/v1/postings/abc');
    expect(api.headers.ratelimit).toMatch(/"10000-in-5min"/);

    // The health check answers (up or down) without counting towards the limit.
    const health = await request(app).get('/api/v1/health');
    expect(health.headers.ratelimit).toBeUndefined();
  });
});
