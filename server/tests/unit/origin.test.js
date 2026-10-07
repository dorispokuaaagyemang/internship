import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { requireOrigin } from '../../src/middleware/origin.js';

const SECRET = 'v'.repeat(40);

function app() {
  const a = express();
  a.set('trust proxy', 1);
  a.use(requireOrigin(SECRET));
  a.get('/api/v1/health', (req, res) => res.json({ ok: true }));
  a.get('/api/v1/whoami', (req, res) => res.json({ ip: req.ip }));
  a.use((err, req, res, next) => res.status(err.status).json({ code: err.code })); // eslint-disable-line no-unused-vars
  return a;
}

describe('requireOrigin (Vercel in front of Render)', () => {
  it('refuses a request that went around the proxy', async () => {
    const res = await request(app()).get('/api/v1/whoami').set('x-forwarded-for', '1.2.3.4');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DIRECT_ACCESS_FORBIDDEN');
  });

  it('refuses a wrong secret', async () => {
    const res = await request(app()).get('/api/v1/whoami').set('x-origin-secret', 'w'.repeat(40));
    expect(res.status).toBe(403);
  });

  it('takes the client IP from X-Real-IP when the secret matches', async () => {
    const res = await request(app())
      .get('/api/v1/whoami')
      .set('x-origin-secret', SECRET)
      .set('x-real-ip', '41.66.200.7')
      .set('x-forwarded-for', '41.66.200.7, 76.76.21.21');
    expect(res.status).toBe(200);
    expect(res.body.ip).toBe('41.66.200.7');
  });

  it('leaves the health check open for the host', async () => {
    const res = await request(app()).get('/api/v1/health');
    expect(res.status).toBe(200);
  });
});
