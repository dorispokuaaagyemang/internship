import request from 'supertest';
import { UniqueConstraintError } from 'sequelize';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { User, RefreshToken } from '../../src/db/models/index.js';
import { buildAuthUrl, exchangeCode, isGoogleConfigured } from '../../src/integrations/google.js';
import { record } from '../../src/modules/audit/service.js';
import { createApp } from '../../src/app.js';

// vi.mock is hoisted above the imports.
vi.mock('../../src/db/models/index.js', () => ({
  sequelize: { transaction: vi.fn((fn) => fn({})) },
  User: { create: vi.fn(), findOne: vi.fn(), findByPk: vi.fn() },
  RefreshToken: { create: vi.fn(), update: vi.fn() },
  EmailVerificationToken: {},
}));
vi.mock('../../src/lib/redis.js', () => ({ default: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
vi.mock('../../src/modules/audit/service.js', () => ({ record: vi.fn() }));
vi.mock('../../src/jobs/queues.js', () => ({ enqueueEmail: vi.fn() }));
vi.mock('../../src/integrations/google.js', () => ({
  isGoogleConfigured: vi.fn(),
  buildAuthUrl: vi.fn((state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(state)}`),
  exchangeCode: vi.fn(),
}));

const app = createApp();
const LOGIN = 'http://localhost:5173/login';

const profile = (overrides = {}) => ({
  googleId: 'g-123',
  email: 'ada@example.com',
  emailVerified: true,
  name: 'Ada',
  ...overrides,
});

function makeUser(overrides = {}) {
  return {
    id: 7,
    email: 'ada@example.com',
    role: 'student',
    status: 'pending',
    googleId: null,
    passwordHash: 'hash',
    emailVerifiedAt: new Date(),
    update: vi.fn(),
    save: vi.fn(),
    ...overrides,
  };
}

const cookieValue = (res, name) =>
  res.headers['set-cookie']?.find((c) => c.startsWith(`${name}=`))?.split(';')[0].split('=')[1];

// Runs GET /auth/google and returns what the browser carries back to the callback.
async function start(intent = 'student') {
  const res = await request(app).get(`/api/v1/auth/google?intent=${intent}`);
  const state = new URL(res.headers.location).searchParams.get('state');
  return { res, state, nonce: cookieValue(res, 'google_oauth_nonce') };
}

function callback({ state, nonce, code = 'the-code', error }) {
  const query = new URLSearchParams(error ? { error, state } : { code, state });
  const req = request(app).get(`/api/v1/auth/google/callback?${query}`);
  return nonce ? req.set('Cookie', `google_oauth_nonce=${nonce}`) : req;
}

beforeEach(() => {
  vi.clearAllMocks();
  isGoogleConfigured.mockReturnValue(true);
  exchangeCode.mockResolvedValue(profile());
  User.findOne.mockResolvedValue(null);
  RefreshToken.create.mockResolvedValue({});
  RefreshToken.update.mockResolvedValue([0]);
});

describe('GET /api/v1/auth/google (US-00A)', () => {
  it('redirects to the Google consent screen and sets a nonce cookie', async () => {
    const { res, nonce } = await start();

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(nonce).toEqual(expect.any(String));
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('google_oauth_nonce='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it('redirects back to login when Google sign-in is not configured', async () => {
    isGoogleConfigured.mockReturnValue(false);

    const res = await request(app).get('/api/v1/auth/google');

    expect(res.headers.location).toBe(`${LOGIN}?error=google_unavailable`);
    expect(buildAuthUrl).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/auth/google/callback (US-00A)', () => {
  it('creates a new account with the intended role, email verified and active at once', async () => {
    User.create.mockImplementation(async (values) => makeUser({ id: 9, ...values, passwordHash: null }));
    const { state, nonce } = await start('company_rep');

    const res = await callback({ state, nonce });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173/auth/complete');
    expect(User.create).toHaveBeenCalledWith({
      email: 'ada@example.com',
      googleId: 'g-123',
      displayName: 'Ada',
      role: 'company_rep',
      status: 'active',
      emailVerifiedAt: expect.any(Date),
    });
    expect(cookieValue(res, 'refresh_token')).toEqual(expect.any(String));
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.google_signin', metadata: { outcome: 'created' } }),
      expect.anything(),
    );
  });

  it('falls back to the student role for an unknown intent', async () => {
    User.create.mockImplementation(async (values) => makeUser(values));
    const { state, nonce } = await start('admin');

    await callback({ state, nonce });

    expect(User.create.mock.calls[0][0].role).toBe('student');
  });

  it('signs in an account already linked to this Google id', async () => {
    const user = makeUser({ googleId: 'g-123', status: 'active' });
    User.findOne.mockImplementation(async ({ where }) => (where.googleId ? user : null));
    const { state, nonce } = await start();

    const res = await callback({ state, nonce });

    expect(res.headers.location).toBe('http://localhost:5173/auth/complete');
    expect(User.create).not.toHaveBeenCalled();
    expect(user.update).toHaveBeenCalledWith({ lastLoginAt: expect.any(Date), retentionWarnedAt: null }, expect.anything());
  });

  it('links to an existing account with the same email instead of creating a duplicate', async () => {
    const user = makeUser({ role: 'company_rep' });
    User.findOne.mockImplementation(async ({ where }) => (where.email ? user : null));
    const { state, nonce } = await start('student');

    await callback({ state, nonce });

    expect(User.create).not.toHaveBeenCalled();
    expect(user.googleId).toBe('g-123');
    expect(user.role).toBe('company_rep'); // the existing role is kept
    expect(user.passwordHash).toBe('hash'); // verified email: the password stays
    expect(user.save).toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { outcome: 'linked' } }),
      expect.anything(),
    );
  });

  it('drops the password and sessions of an unverified account it links to', async () => {
    const user = makeUser({ emailVerifiedAt: null });
    User.findOne.mockImplementation(async ({ where }) => (where.email ? user : null));
    const { state, nonce } = await start();

    await callback({ state, nonce });

    expect(user.passwordHash).toBeNull();
    expect(user.emailVerifiedAt).toEqual(expect.any(Date));
    expect(RefreshToken.update).toHaveBeenCalledWith(
      { revokedAt: expect.any(Date) },
      { where: { userId: 7, revokedAt: null } },
    );
  });

  it('activates a pending account it links to (Google has verified the email)', async () => {
    const user = makeUser({ emailVerifiedAt: null });
    User.findOne.mockImplementation(async ({ where }) => (where.email ? user : null));
    const { state, nonce } = await start();

    await callback({ state, nonce });

    expect(user.status).toBe('active');
  });

  it('refuses to relink an email already tied to another Google account', async () => {
    User.findOne.mockImplementation(async ({ where }) => (where.email ? makeUser({ googleId: 'g-other' }) : null));
    const { state, nonce } = await start();

    expect((await callback({ state, nonce })).headers.location).toBe(`${LOGIN}?error=google_failed`);
  });

  it('denied consent fails gracefully and creates no account', async () => {
    const { state, nonce } = await start();

    const res = await callback({ state, nonce, error: 'access_denied' });

    expect(res.headers.location).toBe(`${LOGIN}?error=google_denied`);
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(User.create).not.toHaveBeenCalled();
  });

  it('rejects a callback without the nonce cookie (CSRF)', async () => {
    const { state } = await start();

    const res = await callback({ state });

    expect(res.headers.location).toBe(`${LOGIN}?error=google_failed`);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('rejects a nonce that does not match the state', async () => {
    const { state } = await start();
    const { nonce: otherNonce } = await start();

    expect((await callback({ state, nonce: otherNonce })).headers.location).toBe(`${LOGIN}?error=google_failed`);
  });

  it('rejects a forged state', async () => {
    const { nonce } = await start();

    expect((await callback({ state: 'forged', nonce })).headers.location).toBe(`${LOGIN}?error=google_failed`);
  });

  it('refuses a Google account whose email Google has not verified', async () => {
    exchangeCode.mockResolvedValue(profile({ emailVerified: false }));
    const { state, nonce } = await start();

    expect((await callback({ state, nonce })).headers.location).toBe(`${LOGIN}?error=google_email_unverified`);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  it('US-12: refuses a suspended account', async () => {
    User.findOne.mockImplementation(async ({ where }) =>
      where.googleId ? makeUser({ googleId: 'g-123', status: 'suspended' }) : null,
    );
    const { state, nonce } = await start();

    const res = await callback({ state, nonce });

    expect(res.headers.location).toBe(`${LOGIN}?error=account_suspended`);
    expect(RefreshToken.create).not.toHaveBeenCalled();
  });

  it('reports a failed code exchange as google_failed', async () => {
    exchangeCode.mockRejectedValue(new Error('Google token exchange failed with 400'));
    const { state, nonce } = await start();

    expect((await callback({ state, nonce })).headers.location).toBe(`${LOGIN}?error=google_failed`);
  });

  it('reports a duplicate created concurrently as google_failed', async () => {
    User.create.mockRejectedValue(new UniqueConstraintError({}));
    const { state, nonce } = await start();

    expect((await callback({ state, nonce })).headers.location).toBe(`${LOGIN}?error=google_failed`);
  });
});
