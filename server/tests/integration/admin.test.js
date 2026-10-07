import request from 'supertest';
import { Op } from 'sequelize';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { User, RefreshToken, Company, Posting, AuditLog, Notification, CompanyMember } from '../../src/db/models/index.js';
import redis from '../../src/lib/redis.js';
import { record } from '../../src/modules/audit/service.js';
import { anonymiseUser } from '../../src/modules/privacy/service.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { createApp } from '../../src/app.js';

vi.mock('../../src/db/models/index.js', () => ({
  sequelize: { transaction: vi.fn((fn) => fn({})), fn: vi.fn(), col: vi.fn() },
  User: { findByPk: vi.fn(), findAll: vi.fn(), findAndCountAll: vi.fn() },
  RefreshToken: { update: vi.fn() },
  StudentProfile: {},
  Company: { findByPk: vi.fn(), findAll: vi.fn() },
  CompanyMember: { findOne: vi.fn(), findAll: vi.fn(async () => []) },
  Posting: { update: vi.fn(), findAll: vi.fn() },
  Application: { findAll: vi.fn() },
  AuditLog: { findAndCountAll: vi.fn() },
  Notification: { bulkCreate: vi.fn(async (rows) => rows) },
}));
vi.mock('../../src/lib/redis.js', () => ({ default: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
vi.mock('../../src/jobs/queues.js', () => ({ enqueueEmail: vi.fn() }));
vi.mock('../../src/modules/audit/service.js', () => ({ record: vi.fn() }));
vi.mock('../../src/modules/privacy/service.js', () => ({ anonymiseUser: vi.fn(async () => true) }));

const app = createApp();
const admin = `Bearer ${signAccessToken({ id: 1, role: 'admin' })}`;

const target = (overrides = {}) => ({
  id: 7,
  email: 'ada@example.com',
  role: 'student',
  status: 'active',
  passwordHash: 'h',
  emailVerifiedAt: new Date(),
  update: vi.fn(async function (v) {
    Object.assign(this, v);
  }),
  destroy: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  redis.get.mockImplementation(async (key) => (key.startsWith('user:status:') ? 'active' : null));
  redis.set.mockResolvedValue('OK');
  redis.del.mockResolvedValue(1);
});

describe('GET /api/v1/admin/stats (US-12)', () => {
  it('counts active students, companies, postings and applications, and caches for 60 s', async () => {
    User.findAll.mockImplementation(async ({ where }) =>
      where.role === 'student' ? [{ status: 'active', n: '12' }, { status: 'pending', n: '3' }] : [{ status: 'active', n: '20' }, { status: 'suspended', n: '1' }],
    );
    Company.findAll.mockResolvedValue([{ status: 'verified', n: '4' }, { status: 'pending_verification', n: '2' }]);
    Posting.findAll.mockResolvedValue([{ status: 'active', n: '6' }, { status: 'draft', n: '1' }]);
    const { Application } = await import('../../src/db/models/index.js');
    Application.findAll.mockResolvedValue([{ status: 'applied', n: '9' }, { status: 'accepted', n: '2' }]);

    const res = await request(app).get('/api/v1/admin/stats').set('Authorization', admin);

    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({
      students: { active: 12, total: 15 },
      companies: { verified: 4, pending: 2, suspended: 0, total: 6 },
      postings: { active: 6, total: 7 },
      applications: { applied: 9, accepted: 2, total: 11 },
      users: { suspended: 1 },
    });
    expect(redis.set).toHaveBeenCalledWith('admin:stats', expect.any(String), 'EX', 60);
  });

  it('serves the cached copy', async () => {
    redis.get.mockImplementation(async (key) => (key === 'admin:stats' ? JSON.stringify({ students: { active: 99 } }) : 'active'));

    const res = await request(app).get('/api/v1/admin/stats').set('Authorization', admin);

    expect(res.body.stats.students.active).toBe(99);
    expect(User.findAll).not.toHaveBeenCalled();
  });

  it('is for admins only', async () => {
    expect((await request(app).get('/api/v1/admin/stats').set('Authorization', `Bearer ${signAccessToken({ id: 7, role: 'student' })}`)).status).toBe(403);
  });
});

describe('admin user management (US-12)', () => {
  it('lists users, searching email and names in one query', async () => {
    User.findAndCountAll.mockResolvedValue({
      rows: [{ ...target(), studentProfile: { fullName: 'Ada Lovelace' }, membership: null, googleId: null, createdAt: new Date() }],
      count: 1,
    });

    const res = await request(app).get('/api/v1/admin/users?q=ada&role=student').set('Authorization', admin);

    expect(res.body.items[0]).toMatchObject({ name: 'Ada Lovelace', role: 'student', signInMethod: 'password', emailVerified: true });
    const query = User.findAndCountAll.mock.calls[0][0];
    expect(query.where.role).toBe('student');
    expect(query.where[Op.or]).toHaveLength(4);
    expect(query.subQuery).toBe(false);
  });

  it('suspends with a reason: revokes sessions, clears the status cache, audits', async () => {
    const user = target();
    User.findByPk.mockResolvedValue(user);

    const res = await request(app).post('/api/v1/admin/users/7/suspend').set('Authorization', admin).send({ reason: 'Spam applications' });

    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('suspended');
    expect(RefreshToken.update).toHaveBeenCalledWith({ revokedAt: expect.any(Date) }, { where: { userId: 7, revokedAt: null }, transaction: expect.anything() });
    expect(redis.del).toHaveBeenCalledWith('user:status:7');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.user_suspended', actor: { id: 1, role: 'admin' }, metadata: { reason: 'Spam applications' } }),
      expect.anything(),
    );
  });

  it('requires a reason', async () => {
    const res = await request(app).post('/api/v1/admin/users/7/suspend').set('Authorization', admin).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.fields.reason).toMatch(/audit log/);
  });

  it('will not suspend or delete an admin', async () => {
    User.findByPk.mockResolvedValue(target({ id: 2, role: 'admin' }));

    expect((await request(app).post('/api/v1/admin/users/2/suspend').set('Authorization', admin).send({ reason: 'test it' })).body.error.code).toBe('CANNOT_MODIFY_ADMIN');
    expect((await request(app).delete('/api/v1/admin/users/2').set('Authorization', admin).send({ reason: 'test it' })).body.error.code).toBe('CANNOT_MODIFY_ADMIN');
  });

  it('reinstates to active, or to pending if the email was never verified', async () => {
    const verified = target({ status: 'suspended' });
    User.findByPk.mockResolvedValueOnce(verified);
    await request(app).post('/api/v1/admin/users/7/reinstate').set('Authorization', admin);
    expect(verified.status).toBe('active');

    const unverified = target({ status: 'suspended', emailVerifiedAt: null });
    User.findByPk.mockResolvedValueOnce(unverified);
    await request(app).post('/api/v1/admin/users/7/reinstate').set('Authorization', admin);
    expect(unverified.status).toBe('pending');
  });

  it('deletes by anonymising (data protection), auditing the reason but not the email', async () => {
    User.findByPk.mockResolvedValue(target());

    const res = await request(app).delete('/api/v1/admin/users/7').set('Authorization', admin).send({ reason: 'Requested by the user' });

    expect(res.status).toBe(204);
    expect(anonymiseUser).toHaveBeenCalledWith(7, { actor: { id: 1, role: 'admin' }, reason: 'Requested by the user', ip: expect.any(String), source: 'admin' });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.user_deleted', metadata: { reason: 'Requested by the user' } }));
  });
});

describe('company suspension (US-12)', () => {
  it('suspends the company, closes its active postings and tells its reps', async () => {
    const company = { id: 5, name: 'Acme Ltd', status: 'verified', verifiedAt: new Date(), update: vi.fn(async function (v) { Object.assign(this, v); }) };
    Company.findByPk.mockResolvedValue(company);
    Posting.update.mockResolvedValue([3]);
    CompanyMember.findAll.mockResolvedValue([{ user: { id: 20, email: 'rep@acme.co' } }]);

    const res = await request(app).post('/api/v1/admin/companies/5/suspend').set('Authorization', admin).send({ reason: 'Fake listings' });

    expect(res.body.company).toMatchObject({ status: 'suspended', postingsClosed: 3 });
    expect(Posting.update).toHaveBeenCalledWith({ status: 'closed', closedAt: expect.any(Date) }, { where: { companyId: 5, status: 'active' }, transaction: expect.anything() });
    expect(Notification.bulkCreate).toHaveBeenCalledWith([expect.objectContaining({ userId: 20, type: 'company.suspended' })]);
  });

  it('reinstates to verified (or pending if it was never approved)', async () => {
    const company = { id: 5, name: 'Acme', status: 'suspended', verifiedAt: null, update: vi.fn(async function (v) { Object.assign(this, v); }) };
    Company.findByPk.mockResolvedValue(company);

    const res = await request(app).post('/api/v1/admin/companies/5/reinstate').set('Authorization', admin);

    expect(res.body.company.status).toBe('pending_verification');
  });
});

describe('GET /api/v1/admin/audit-logs (US-12)', () => {
  it('filters by action prefix, actor and dates, newest first', async () => {
    AuditLog.findAndCountAll.mockResolvedValue({
      rows: [{ id: 1, action: 'auth.login', actorId: 7, actorRole: 'student', actor: { id: 7, email: 'ada@example.com' }, ip: '1.2.3.4', metadata: null, createdAt: new Date() }],
      count: 1,
    });

    const res = await request(app).get('/api/v1/admin/audit-logs?action=auth.&actorId=7&from=2026-10-01&to=2026-10-31').set('Authorization', admin);

    expect(res.body.items[0]).toMatchObject({ action: 'auth.login', actor: { email: 'ada@example.com' } });
    const { where, order } = AuditLog.findAndCountAll.mock.calls[0][0];
    expect(where.action).toEqual({ [Op.startsWith]: 'auth.' });
    expect(where.actorId).toBe(7);
    expect(where.createdAt[Op.gte]).toEqual(new Date('2026-10-01'));
    expect(order[0]).toEqual(['createdAt', 'DESC']);
  });

  it('rejects an end date before the start date', async () => {
    const res = await request(app).get('/api/v1/admin/audit-logs?from=2026-10-31&to=2026-10-01').set('Authorization', admin);
    expect(res.status).toBe(422);
  });
});
