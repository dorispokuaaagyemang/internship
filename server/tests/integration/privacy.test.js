import bcrypt from 'bcryptjs';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { User } from '../../src/db/models/index.js';
import redis from '../../src/lib/redis.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { exportUserData } from '../../src/modules/privacy/service.js';
import { createApp } from '../../src/app.js';

// Enough of the models for the real anonymiseUser to run (its queries are covered against MySQL).
vi.mock('../../src/db/models/index.js', () => {
  const write = () => ({ update: vi.fn(), destroy: vi.fn(), findAll: vi.fn(async () => []), findByPk: vi.fn(async () => null) });
  return {
    sequelize: { transaction: vi.fn((fn) => fn({})) },
    User: { findByPk: vi.fn() },
    RefreshToken: write(),
    EmailVerificationToken: write(),
    AccountInvite: write(),
    StudentProfile: write(),
    StoredFile: write(),
    CompanyMember: write(),
    Application: write(),
    SupervisorAssignment: write(),
    Certificate: write(),
    Notification: write(),
    Internship: {},
    AuditLog: { create: vi.fn() },
  };
});
vi.mock('../../src/lib/redis.js', () => ({ default: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
vi.mock('../../src/jobs/queues.js', () => ({ enqueueEmail: vi.fn() }));
// The export's queries are covered against MySQL; here only the route.
vi.mock('../../src/modules/privacy/service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, exportUserData: vi.fn() };
});

const app = createApp();
const bearer = (id, role = 'student') => `Bearer ${signAccessToken({ id, role })}`;
const user = (fields) => ({ ...fields, anonymisedAt: null, deletedAt: null, update: vi.fn(async function (v) { Object.assign(this, v); }), destroy: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks();
  redis.get.mockResolvedValue('active');
});

describe('GET /api/v1/account/export (right of access)', () => {
  it('downloads everything held about the user as a JSON file', async () => {
    exportUserData.mockResolvedValue({ account: { email: 'ada@example.com' }, applications: [] });

    const res = await request(app).get('/api/v1/account/export').set('Authorization', bearer(7));

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="my-data-\d{4}-\d{2}-\d{2}\.json"/);
    expect(res.body.account.email).toBe('ada@example.com');
    expect(exportUserData).toHaveBeenCalledWith(7, { ip: expect.any(String) });
  });

  it('requires sign-in', async () => {
    expect((await request(app).get('/api/v1/account/export')).status).toBe(401);
  });
});

describe('POST /api/v1/account/delete (right to erasure)', () => {
  const del = (body, id = 7, role = 'student') => request(app).post('/api/v1/account/delete').set('Authorization', bearer(id, role)).send(body);

  it('a password account confirms with its password, then is anonymised and signed out', async () => {
    User.findByPk.mockResolvedValue(user({ id: 7, role: 'student', email: 'ada@example.com', passwordHash: bcrypt.hashSync('secret#123', 4) }));

    const wrong = await del({ password: 'nope#123' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.fields.password).toBe('Incorrect password');

    const res = await del({ password: 'secret#123' });
    expect(res.status).toBe(204);
    const target = await User.findByPk.mock.results.at(-1).value;
    expect(target.update).toHaveBeenCalledWith(expect.objectContaining({ email: 'deleted-7@deleted.invalid', passwordHash: null, displayName: null, phoneE164: null, status: 'suspended' }), expect.anything());
    expect(target.destroy).toHaveBeenCalled();
    expect(res.headers['set-cookie']?.join(';')).toMatch(/refresh_token=;/);
  });

  it('a Google account (no password) confirms by typing its email', async () => {
    User.findByPk.mockResolvedValue(user({ id: 8, role: 'student', email: 'grace@gmail.com', passwordHash: null }));

    expect((await del({ confirmEmail: 'someone@else.com' }, 8)).body.error.fields.confirmEmail).toMatch(/Does not match/);
    expect((await del({ confirmEmail: ' Grace@Gmail.com ' }, 8)).status).toBe(204);
  });

  it('an admin cannot delete their own account here', async () => {
    User.findByPk.mockResolvedValue(user({ id: 1, role: 'admin', email: 'boss@x.co', passwordHash: 'h' }));

    const res = await del({ password: 'x' }, 1, 'admin');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ADMIN_ACCOUNT');
  });
});

describe('GET /api/v1/account/privacy-info', () => {
  it('is public and reports the retention periods the job uses', async () => {
    const res = await request(app).get('/api/v1/account/privacy-info');

    expect(res.status).toBe(200);
    expect(res.body.retention).toEqual({ inactiveAccountDays: 365, warningDaysBefore: 30, inactiveResumeDays: 182, auditLogDays: 365, unverifiedAccountDays: 30 });
  });
});
