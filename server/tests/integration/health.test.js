import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sequelize } from '../../src/db/index.js';
import redis from '../../src/lib/redis.js';
import s3 from '../../src/lib/s3.js';
import { createApp } from '../../src/app.js';

// vi.mock is hoisted above the imports.
vi.mock('../../src/db/index.js', () => ({ sequelize: { authenticate: vi.fn() } }));
vi.mock('../../src/lib/redis.js', () => ({ default: { ping: vi.fn() } }));
vi.mock('../../src/lib/s3.js', () => ({ default: { send: vi.fn() } }));
// The auth routes load the models; they are unused here.
vi.mock('../../src/db/models/index.js', () => ({ sequelize: {}, User: {}, RefreshToken: {}, AuditLog: {} }));

const app = createApp();

beforeEach(() => {
  sequelize.authenticate.mockResolvedValue();
  redis.ping.mockResolvedValue('PONG');
  s3.send.mockResolvedValue({ Buckets: [] });
});

describe('GET /api/v1/health', () => {
  it('returns 200 when every dependency is up', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.map((c) => c.name)).toEqual(['mysql', 'redis', 'storage']);
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('returns 503 and names the failing dependency', async () => {
    redis.ping.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.find((c) => c.name === 'redis')).toMatchObject({
      status: 'down',
      error: 'ECONNREFUSED',
    });
  });

  it('reports storage down when the S3 call is rejected', async () => {
    s3.send.mockRejectedValue(new Error('InvalidAccessKeyId'));

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(503);
    expect(res.body.checks.find((c) => c.name === 'storage')).toMatchObject({
      status: 'down',
      error: 'InvalidAccessKeyId',
    });
  });
});

describe('error responses', () => {
  it('uses the standard shape for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route GET /api/v1/nope not found' } });
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"bad":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});
