import bcrypt from 'bcryptjs';
import express from 'express';
import request from 'supertest';
import { UniqueConstraintError } from 'sequelize';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { User, RefreshToken, EmailVerificationToken } from '../../src/db/models/index.js';
import redis from '../../src/lib/redis.js';
import { enqueueEmail } from '../../src/jobs/queues.js';
import { record } from '../../src/modules/audit/service.js';
import { hashToken, signAccessToken } from '../../src/lib/tokens.js';
import { authenticate, authorize } from '../../src/middleware/auth.js';
import { errorHandler } from '../../src/middleware/error.js';
import { createApp } from '../../src/app.js';

// vi.mock is hoisted above the imports.
vi.mock('../../src/db/models/index.js', () => ({
  sequelize: { transaction: vi.fn((fn) => fn({})) },
  User: { create: vi.fn(), findOne: vi.fn(), findByPk: vi.fn() },
  RefreshToken: { create: vi.fn(), findOne: vi.fn(), update: vi.fn() },
  EmailVerificationToken: { create: vi.fn(), findOne: vi.fn(), update: vi.fn() },
}));
vi.mock('../../src/lib/redis.js', () => ({ default: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
vi.mock('../../src/jobs/queues.js', () => ({ enqueueEmail: vi.fn() }));
vi.mock('../../src/modules/audit/service.js', () => ({ record: vi.fn() }));

const app = createApp();
const PASSWORD = 'secret#123';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

function makeUser(overrides = {}) {
  return {
    id: 7,
    email: 'ada@example.com',
    role: 'student',
    status: 'active',
    passwordHash: PASSWORD_HASH,
    emailVerifiedAt: new Date(),
    update: vi.fn(),
    save: vi.fn(),
    toJSON() {
      const { passwordHash, update, save, toJSON, ...rest } = this; // eslint-disable-line no-unused-vars
      return rest;
    },
    ...overrides,
  };
}

const refreshCookie = (res) => res.headers['set-cookie']?.find((c) => c.startsWith('refresh_token='));

beforeEach(() => {
  vi.clearAllMocks();
  redis.get.mockResolvedValue(null);
  redis.set.mockResolvedValue('OK');
  RefreshToken.create.mockResolvedValue({});
  RefreshToken.update.mockResolvedValue([1]);
  EmailVerificationToken.create.mockResolvedValue({});
  EmailVerificationToken.update.mockResolvedValue([1]);
  enqueueEmail.mockResolvedValue({});
});

describe('POST /api/v1/auth/register (US-01)', () => {
  const body = { fullName: 'Ada Lovelace', email: 'Ada@Example.com', password: PASSWORD, phone: '+233241234567', role: 'student' };

  it('creates a pending account, returns an access token and sets the refresh cookie', async () => {
    User.create.mockImplementation(async (values) => makeUser({ ...values, emailVerifiedAt: null }));

    const res = await request(app).post('/api/v1/auth/register').send(body);

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: 'ada@example.com', status: 'pending', phoneE164: '+233241234567' });
    expect(res.body.user).not.toHaveProperty('passwordHash');

    const created = User.create.mock.calls[0][0];
    expect(await bcrypt.compare(PASSWORD, created.passwordHash)).toBe(true);

    const cookie = refreshCookie(res);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    const raw = cookie.split(';')[0].split('=')[1];
    expect(RefreshToken.create.mock.calls[0][0].tokenHash).toBe(hashToken(raw));

    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.register' }), expect.anything());
  });

  it('US-01: queues a verification email whose link matches the stored token hash', async () => {
    User.create.mockImplementation(async (values) => makeUser({ ...values, emailVerifiedAt: null }));

    await request(app).post('/api/v1/auth/register').send(body);

    expect(enqueueEmail).toHaveBeenCalledWith('verifyEmail', 'ada@example.com', {
      url: expect.stringMatching(/^http:\/\/localhost:5173\/api\/v1\/auth\/verify-email\/[\w-]+$/),
      expiresInHours: 24,
    });
    const token = enqueueEmail.mock.calls[0][2].url.split('/').pop();
    expect(EmailVerificationToken.create.mock.calls[0][0]).toMatchObject({ userId: 7, tokenHash: hashToken(token) });
  });

  it('still registers when the email queue is down', async () => {
    User.create.mockImplementation(async (values) => makeUser({ ...values, emailVerifiedAt: null }));
    enqueueEmail.mockRejectedValue(new Error('timed out'));

    expect((await request(app).post('/api/v1/auth/register').send(body)).status).toBe(201);
  });

  it('rejects a duplicate email with 409 EMAIL_TAKEN', async () => {
    User.create.mockRejectedValue(new UniqueConstraintError({}));

    const res = await request(app).post('/api/v1/auth/register').send(body);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('returns 422 with every invalid field', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'nope', password: 'short', phone: '123', role: 'admin' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['email', 'fullName', 'password', 'phone', 'role']);
    expect(User.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/auth/login', () => {
  const login = (password = PASSWORD) =>
    request(app).post('/api/v1/auth/login').send({ email: 'ada@example.com', password });

  it('signs in a verified account and records the login', async () => {
    const user = makeUser();
    User.findOne.mockResolvedValue(user);

    const res = await login();

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(refreshCookie(res)).toBeDefined();
    expect(user.update).toHaveBeenCalledWith({ lastLoginAt: expect.any(Date), retentionWarnedAt: null }, expect.anything());
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login', actor: user }), expect.anything());
  });

  it('rejects a wrong password with 401 and audits the failure', async () => {
    User.findOne.mockResolvedValue(makeUser());

    const res = await login('wrong#pass1');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login_failed' }));
  });

  it('gives an unknown email the same 401', async () => {
    User.findOne.mockResolvedValue(null);

    const res = await login();

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a Google-only account (no password) with 401', async () => {
    User.findOne.mockResolvedValue(makeUser({ passwordHash: null }));

    expect((await login()).status).toBe(401);
  });

  it('US-01: blocks an unverified email with 403 EMAIL_NOT_VERIFIED', async () => {
    User.findOne.mockResolvedValue(makeUser({ emailVerifiedAt: null }));

    const res = await login();

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(RefreshToken.create).not.toHaveBeenCalled();
  });

  it('US-12: blocks a suspended account with 403', async () => {
    User.findOne.mockResolvedValue(makeUser({ status: 'suspended' }));

    const res = await login();

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });
});

describe('POST /api/v1/auth/refresh', () => {
  const refresh = (token = 'old-token') => request(app).post('/api/v1/auth/refresh').set('Cookie', `refresh_token=${token}`);
  const stored = (overrides = {}) => ({
    id: 1,
    userId: 7,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  });

  it('rotates the token: revokes the old one and issues a new pair', async () => {
    RefreshToken.findOne.mockResolvedValue(stored());
    User.findByPk.mockResolvedValue(makeUser());

    const res = await refresh();

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(RefreshToken.findOne).toHaveBeenCalledWith({ where: { tokenHash: hashToken('old-token') } });
    expect(RefreshToken.update).toHaveBeenCalledWith(
      { revokedAt: expect.any(Date) },
      { where: { id: 1, revokedAt: null } },
    );
    const newToken = refreshCookie(res).split(';')[0].split('=')[1];
    expect(newToken).not.toBe('old-token');
  });

  it('treats reuse of a rotated token as theft: revokes every session', async () => {
    RefreshToken.findOne.mockResolvedValue(stored({ revokedAt: new Date() }));
    User.findByPk.mockResolvedValue(makeUser());

    const res = await refresh();

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    expect(RefreshToken.update).toHaveBeenCalledWith(
      { revokedAt: expect.any(Date) },
      { where: { userId: 7, revokedAt: null } },
    );
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.refresh_reuse' }));
    expect(refreshCookie(res)).toMatch(/refresh_token=;/);
  });

  it('treats losing a concurrent rotation as reuse', async () => {
    RefreshToken.findOne.mockResolvedValue(stored());
    User.findByPk.mockResolvedValue(makeUser());
    RefreshToken.update.mockResolvedValueOnce([0]);

    const res = await refresh();

    expect(res.status).toBe(401);
    expect(RefreshToken.create).not.toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    RefreshToken.findOne.mockResolvedValue(stored({ expiresAt: new Date(Date.now() - 1000) }));
    User.findByPk.mockResolvedValue(makeUser());

    expect((await refresh()).status).toBe(401);
  });

  it('returns 401 without a cookie', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');

    expect(res.status).toBe(401);
    expect(RefreshToken.findOne).not.toHaveBeenCalled();
  });

  it('US-12: refuses a suspended account', async () => {
    RefreshToken.findOne.mockResolvedValue(stored());
    User.findByPk.mockResolvedValue(makeUser({ status: 'suspended' }));

    const res = await refresh();

    expect(res.status).toBe(403);
    expect(RefreshToken.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('revokes the token, clears the cookie and records the logout', async () => {
    const row = { userId: 7, revokedAt: null, update: vi.fn() };
    RefreshToken.findOne.mockResolvedValue(row);
    User.findByPk.mockResolvedValue(makeUser());

    const res = await request(app).post('/api/v1/auth/logout').set('Cookie', 'refresh_token=abc');

    expect(res.status).toBe(204);
    expect(row.update).toHaveBeenCalledWith({ revokedAt: expect.any(Date) });
    expect(refreshCookie(res)).toMatch(/refresh_token=;/);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.logout' }));
  });

  it('succeeds without a cookie', async () => {
    expect((await request(app).post('/api/v1/auth/logout')).status).toBe(204);
  });
});

describe('GET /api/v1/auth/me (authenticate)', () => {
  const bearer = `Bearer ${signAccessToken({ id: 7, role: 'student' })}`;

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/v1/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 for a malformed token', async () => {
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer nope')).status).toBe(401);
  });

  it('returns the user and caches the status for 30 s', async () => {
    User.findByPk.mockResolvedValue(makeUser());

    const res = await request(app).get('/api/v1/auth/me').set('Authorization', bearer);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 7, email: 'ada@example.com' });
    expect(redis.set).toHaveBeenCalledWith('user:status:7', 'active', 'EX', 30);
  });

  it('US-12: rejects a suspended account from the cache with 403', async () => {
    redis.get.mockResolvedValue('suspended');

    const res = await request(app).get('/api/v1/auth/me').set('Authorization', bearer);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect(User.findByPk).not.toHaveBeenCalled();
  });

  it('falls back to the database when Redis is down', async () => {
    redis.get.mockRejectedValue(new Error('ECONNREFUSED'));
    redis.set.mockRejectedValue(new Error('ECONNREFUSED'));
    User.findByPk.mockResolvedValue(makeUser());

    const res = await request(app).get('/api/v1/auth/me').set('Authorization', bearer);

    expect(res.status).toBe(200);
  });

  it('returns 401 when the account no longer exists', async () => {
    User.findByPk.mockResolvedValue(null);

    expect((await request(app).get('/api/v1/auth/me').set('Authorization', bearer)).status).toBe(401);
  });
});

describe('GET /api/v1/auth/verify-email/:token (US-01)', () => {
  const verify = () => request(app).get('/api/v1/auth/verify-email/the-token');
  const stored = (overrides = {}) => ({
    id: 3,
    userId: 7,
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  });

  it('marks the email verified, uses up the token and redirects to login', async () => {
    const user = makeUser({ emailVerifiedAt: null, status: 'pending' });
    EmailVerificationToken.findOne.mockResolvedValue(stored());
    User.findByPk.mockResolvedValue(user);

    const res = await verify();

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173/login?emailVerified=1');
    expect(EmailVerificationToken.findOne).toHaveBeenCalledWith({ where: { tokenHash: hashToken('the-token') } });
    expect(EmailVerificationToken.update).toHaveBeenCalledWith(
      { usedAt: expect.any(Date) },
      expect.objectContaining({ where: { id: 3, usedAt: null } }),
    );
    expect(user.emailVerifiedAt).toEqual(expect.any(Date));
    expect(user.save).toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.email_verified' }), expect.anything());
  });

  it('activates the account: verifying the email is the last step (SMS dropped)', async () => {
    const user = makeUser({ emailVerifiedAt: null, status: 'pending' });
    EmailVerificationToken.findOne.mockResolvedValue(stored());
    User.findByPk.mockResolvedValue(user);

    await verify();

    expect(user.status).toBe('active');
    expect(redis.del).toHaveBeenCalledWith('user:status:7');
  });

  it('redirects with email_link_expired for an old link', async () => {
    EmailVerificationToken.findOne.mockResolvedValue(stored({ expiresAt: new Date(Date.now() - 1000) }));
    User.findByPk.mockResolvedValue(makeUser({ emailVerifiedAt: null }));

    const res = await verify();

    expect(res.headers.location).toBe('http://localhost:5173/login?error=email_link_expired');
    expect(EmailVerificationToken.update).not.toHaveBeenCalled();
  });

  it('redirects with email_link_invalid for an unknown token', async () => {
    EmailVerificationToken.findOne.mockResolvedValue(null);

    expect((await verify()).headers.location).toBe('http://localhost:5173/login?error=email_link_invalid');
  });

  it('treats a second click as success once the email is verified', async () => {
    EmailVerificationToken.findOne.mockResolvedValue(stored({ usedAt: new Date() }));
    User.findByPk.mockResolvedValue(makeUser());

    expect((await verify()).headers.location).toBe('http://localhost:5173/login?emailVerified=1');
  });
});

describe('POST /api/v1/auth/verify-email/resend (US-01)', () => {
  const resend = (email = 'ada@example.com') =>
    request(app).post('/api/v1/auth/verify-email/resend').send({ email });

  it('sends a new link to an unverified account', async () => {
    User.findOne.mockResolvedValue(makeUser({ emailVerifiedAt: null }));
    EmailVerificationToken.findOne.mockResolvedValue(null);

    const res = await resend();

    expect(res.status).toBe(202);
    expect(EmailVerificationToken.create).toHaveBeenCalled();
    expect(enqueueEmail).toHaveBeenCalledWith('verifyEmail', 'ada@example.com', expect.any(Object));
  });

  it('sends nothing within a minute of the last link', async () => {
    User.findOne.mockResolvedValue(makeUser({ emailVerifiedAt: null }));
    EmailVerificationToken.findOne.mockResolvedValue({ id: 1 });

    expect((await resend()).status).toBe(202);
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it('gives the same answer for an unknown or already verified email', async () => {
    User.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(makeUser());

    expect((await resend('nobody@example.com')).status).toBe(202);
    expect((await resend()).status).toBe(202);
    expect(enqueueEmail).not.toHaveBeenCalled();
  });
});

describe('authorize()', () => {
  const guarded = express()
    .get('/admin-only', authenticate, authorize('admin'), (req, res) => res.json({ ok: true }))
    .use(errorHandler);

  it('returns 403 FORBIDDEN for another role', async () => {
    redis.get.mockResolvedValue('active');
    const token = signAccessToken({ id: 7, role: 'student' });

    const res = await request(guarded).get('/admin-only').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('lets the named role through', async () => {
    redis.get.mockResolvedValue('active');
    const token = signAccessToken({ id: 1, role: 'admin' });

    const res = await request(guarded).get('/admin-only').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});
