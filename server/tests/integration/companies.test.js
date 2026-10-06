import request from 'supertest';
import { UniqueConstraintError } from 'sequelize';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { User, Company, CompanyMember, Notification } from '../../src/db/models/index.js';
import redis from '../../src/lib/redis.js';
import { enqueueEmail } from '../../src/jobs/queues.js';
import { record } from '../../src/modules/audit/service.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { assertCanPost } from '../../src/modules/companies/service.js';
import { createApp } from '../../src/app.js';

vi.mock('../../src/db/models/index.js', () => ({
  sequelize: { transaction: vi.fn((fn) => fn({})) },
  User: { findByPk: vi.fn() },
  Company: { create: vi.fn(), findByPk: vi.fn(), update: vi.fn(), findAndCountAll: vi.fn() },
  CompanyMember: { create: vi.fn(), findOne: vi.fn(), findAll: vi.fn() },
  Notification: { bulkCreate: vi.fn(async (rows) => rows.map((r, i) => ({ id: i + 1, readAt: null, createdAt: new Date(), ...r }))) },
}));
vi.mock('../../src/lib/redis.js', () => ({ default: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
vi.mock('../../src/jobs/queues.js', () => ({ enqueueEmail: vi.fn() }));
vi.mock('../../src/modules/audit/service.js', () => ({ record: vi.fn() }));

const app = createApp();
const bearer = (role, id = 7) => `Bearer ${signAccessToken({ id, role })}`;
const rep = bearer('company_rep');
const admin = bearer('admin', 1);

const repUser = (overrides = {}) => ({
  id: 7,
  role: 'company_rep',
  email: 'rep@acme.co.ke',
  passwordHash: 'h',
  emailVerifiedAt: new Date(),
  phoneE164: '+254712345678',
  ...overrides,
});

const company = (overrides = {}) => ({
  id: 5,
  name: 'Acme Ltd',
  regNumber: 'PVT-2024/123',
  contactPhone: '+254712345678',
  website: null,
  status: 'pending_verification',
  verifiedAt: null,
  createdAt: new Date('2026-10-01T08:00:00Z'),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  redis.get.mockResolvedValue('active');
  CompanyMember.findOne.mockResolvedValue(null);
  Company.create.mockImplementation(async (values) => company(values));
  enqueueEmail.mockResolvedValue({});
});

describe('POST /api/v1/companies (US-04)', () => {
  const body = { name: ' Acme Ltd ', regNumber: 'pvt-2024/123', website: 'https://acme.co.ke' };
  const register = (payload = body, auth = rep) => request(app).post('/api/v1/companies').set('Authorization', auth).send(payload);

  it('creates the company as Pending Verification, with the rep\'s number, and audits it', async () => {
    User.findByPk.mockResolvedValue(repUser());

    const res = await register();

    expect(res.status).toBe(201);
    expect(res.body.company).toMatchObject({ name: 'Acme Ltd', regNumber: 'PVT-2024/123', status: 'pending_verification', memberRole: 'rep' });
    expect(Company.create).toHaveBeenCalledWith(
      { name: 'Acme Ltd', regNumber: 'PVT-2024/123', website: 'https://acme.co.ke', contactPhone: '+254712345678', status: 'pending_verification' },
      expect.anything(),
    );
    expect(CompanyMember.create).toHaveBeenCalledWith({ companyId: 5, userId: 7, memberRole: 'rep' }, expect.anything());
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'company.registered' }), expect.anything());
  });

  it('US-01: a rep whose email is not verified cannot register a company yet', async () => {
    redis.get.mockResolvedValue('pending');
    User.findByPk.mockResolvedValue(repUser({ emailVerifiedAt: null }));

    const res = await register();

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(Company.create).not.toHaveBeenCalled();
  });

  it('uses a given contact number, and requires one when the rep has none (Google account)', async () => {
    User.findByPk.mockResolvedValue(repUser({ phoneE164: null }));

    const missing = await register();
    expect(missing.status).toBe(422);
    expect(missing.body.error.fields).toEqual({ contactPhone: 'Contact phone is required' });

    const res = await register({ ...body, contactPhone: '+254 733 123456' });
    expect(res.status).toBe(201);
    expect(Company.create.mock.calls[0][0].contactPhone).toBe('+254733123456');
  });

  it('allows one company per account', async () => {
    User.findByPk.mockResolvedValue(repUser());
    CompanyMember.findOne.mockResolvedValue({ companyId: 2 });

    const res = await register();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_IN_COMPANY');
  });

  it('refuses a registration number that is already registered', async () => {
    User.findByPk.mockResolvedValue(repUser());
    const err = new UniqueConstraintError({});
    err.parent = { sqlMessage: "Duplicate entry 'PVT-2024/123' for key 'companies.reg_number'" };
    Company.create.mockRejectedValue(err);

    const res = await register();

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'REG_NUMBER_TAKEN', fields: { regNumber: 'Already registered' } });
  });

  it('names every missing or invalid field', async () => {
    const res = await register({ name: '', regNumber: '!!', website: 'acme' });

    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['name', 'regNumber', 'website']);
  });

  it('is for company reps only', async () => {
    expect((await register(body, bearer('student'))).status).toBe(403);
  });
});

describe('GET /api/v1/companies/me (US-04)', () => {
  it("returns the rep's company and its status", async () => {
    CompanyMember.findOne.mockResolvedValue({ memberRole: 'rep', company: company() });

    const res = await request(app).get('/api/v1/companies/me').set('Authorization', rep);

    expect(res.status).toBe(200);
    expect(res.body.company).toMatchObject({ id: 5, status: 'pending_verification', memberRole: 'rep' });
  });

  it('returns 404 before a company is registered', async () => {
    const res = await request(app).get('/api/v1/companies/me').set('Authorization', rep);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COMPANY_NOT_FOUND');
  });
});

describe('assertCanPost (US-04 posting gate)', () => {
  it('blocks a company awaiting verification with a clear message', async () => {
    CompanyMember.findOne.mockResolvedValue({ company: company() });

    await expect(assertCanPost(7)).rejects.toMatchObject({
      status: 403,
      code: 'COMPANY_NOT_VERIFIED',
      message: expect.stringMatching(/awaiting admin verification/),
    });
  });

  it('blocks a suspended company and a rep with no company', async () => {
    CompanyMember.findOne.mockResolvedValueOnce({ company: company({ status: 'suspended' }) });
    await expect(assertCanPost(7)).rejects.toMatchObject({ code: 'COMPANY_SUSPENDED' });

    CompanyMember.findOne.mockResolvedValueOnce(null);
    await expect(assertCanPost(7)).rejects.toMatchObject({ code: 'COMPANY_REQUIRED' });
  });

  it('lets a verified company post', async () => {
    CompanyMember.findOne.mockResolvedValue({ company: company({ status: 'verified' }) });

    await expect(assertCanPost(7)).resolves.toMatchObject({ id: 5, status: 'verified' });
  });
});

describe('GET /api/v1/admin/companies (US-04, US-12)', () => {
  it('lists companies by status, oldest first, with their reps', async () => {
    Company.findAndCountAll.mockResolvedValue({
      rows: [{ ...company(), members: [{ user: { id: 7, email: 'rep@acme.co.ke', phoneE164: '+254712345678' } }] }],
      count: 1,
    });

    const res = await request(app).get('/api/v1/admin/companies?status=pending_verification').set('Authorization', admin);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, limit: 20, total: 1 });
    expect(res.body.items[0]).toMatchObject({ id: 5, reps: [{ id: 7, email: 'rep@acme.co.ke', phone: '+254712345678' }] });
    expect(Company.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'pending_verification' }, order: [['createdAt', 'ASC']], limit: 20, offset: 0 }),
    );
  });

  it('validates the query', async () => {
    const res = await request(app).get('/api/v1/admin/companies?status=nope&limit=500').set('Authorization', admin);

    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['limit', 'status']);
  });

  it('is for admins only', async () => {
    expect((await request(app).get('/api/v1/admin/companies').set('Authorization', rep)).status).toBe(403);
  });
});

describe('POST /api/v1/admin/companies/:id/approve (US-04, US-12)', () => {
  const approve = (id = 5) => request(app).post(`/api/v1/admin/companies/${id}/approve`).set('Authorization', admin);

  beforeEach(() => {
    Company.findByPk.mockResolvedValue(company());
    Company.update.mockResolvedValue([1]);
    CompanyMember.findAll.mockResolvedValue([{ user: { id: 7, email: 'rep@acme.co.ke' } }]);
  });

  it('verifies the company, records the admin and time, audits it and emails the rep', async () => {
    const res = await approve();

    expect(res.status).toBe(200);
    expect(res.body.company).toMatchObject({ id: 5, status: 'verified', verifiedAt: expect.any(String) });
    expect(Company.update).toHaveBeenCalledWith(
      { status: 'verified', verifiedBy: 1, verifiedAt: expect.any(Date) },
      { where: { id: 5, status: 'pending_verification' }, transaction: expect.anything() },
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.company_approved', actor: expect.objectContaining({ id: 1, role: 'admin' }), entity: { type: 'company', id: 5 } }),
      expect.anything(),
    );
    expect(enqueueEmail).toHaveBeenCalledWith('companyApproved', 'rep@acme.co.ke', {
      companyName: 'Acme Ltd',
      url: 'http://localhost:5173/company',
    });
    expect(Notification.bulkCreate).toHaveBeenCalledWith([
      { userId: 7, type: 'company.approved', payload: { companyId: 5, companyName: 'Acme Ltd' } },
    ]);
  });

  it('approves only a pending company, and only once', async () => {
    Company.findByPk.mockResolvedValue(company({ status: 'verified' }));
    Company.update.mockResolvedValue([0]);

    const res = await approve();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COMPANY_NOT_PENDING');
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it('still approves when the email queue is down', async () => {
    enqueueEmail.mockRejectedValue(new Error('timed out'));

    expect((await approve()).status).toBe(200);
  });

  it('returns 404 for an unknown or malformed id', async () => {
    Company.findByPk.mockResolvedValue(null);
    expect((await approve(99)).status).toBe(404);
    expect((await approve('abc')).status).toBe(404);
  });

  it('is for admins only', async () => {
    const res = await request(app).post('/api/v1/admin/companies/5/approve').set('Authorization', rep);

    expect(res.status).toBe(403);
    expect(Company.update).not.toHaveBeenCalled();
  });
});
