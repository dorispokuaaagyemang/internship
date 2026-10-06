import request from 'supertest';
import { Op } from 'sequelize';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Posting, CompanyMember, Skill } from '../../src/db/models/index.js';
import redis from '../../src/lib/redis.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { closeExpiredPostings, toBooleanQuery } from '../../src/modules/postings/service.js';
import { processMaintenance } from '../../src/jobs/processors/maintenance.js';
import { createApp } from '../../src/app.js';

vi.mock('../../src/db/models/index.js', () => ({
  sequelize: {
    transaction: vi.fn((fn) => fn({})),
    literal: vi.fn((sql) => ({ literal: sql })),
    escape: vi.fn((s) => `'${s}'`),
  },
  User: { findByPk: vi.fn() },
  Company: {},
  CompanyMember: { findOne: vi.fn() },
  Skill: { bulkCreate: vi.fn(), findAll: vi.fn() },
  Posting: { create: vi.fn(), findByPk: vi.fn(), update: vi.fn(), findAndCountAll: vi.fn(), findAll: vi.fn() },
}));
vi.mock('../../src/lib/redis.js', () => ({ default: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
vi.mock('../../src/jobs/queues.js', () => ({ enqueueEmail: vi.fn() }));

const app = createApp();
const bearer = (role, id = 7) => `Bearer ${signAccessToken({ id, role })}`;
const rep = bearer('company_rep');
const DAY = 24 * 60 * 60 * 1000;

const verifiedCompany = { id: 5, name: 'Acme Ltd', status: 'verified' };
const membership = (company = verifiedCompany) => ({ companyId: company.id, memberRole: 'rep', company });

const posting = (overrides = {}) => ({
  id: 9,
  companyId: 5,
  title: 'Data Analyst Intern',
  description: 'Work with our data team.',
  location: 'Nairobi',
  domain: 'Data',
  durationWeeks: 12,
  stipend: 15000,
  stipendCurrency: 'KES',
  deadline: new Date(Date.now() + 10 * DAY),
  status: 'draft',
  publishedAt: null,
  closedAt: null,
  company: { id: 5, name: 'Acme Ltd', website: null },
  skills: [{ name: 'SQL' }, { name: 'Excel' }],
  update: vi.fn(),
  setSkills: vi.fn(),
  ...overrides,
});

const body = {
  title: 'Data Analyst Intern',
  description: 'Work with our data team.',
  location: 'Nairobi',
  domain: 'Data',
  durationWeeks: 12,
  stipend: 15000,
  deadline: new Date(Date.now() + 10 * DAY).toISOString(),
  skills: ['SQL', 'Excel'],
};

beforeEach(() => {
  vi.clearAllMocks();
  redis.get.mockResolvedValue('active');
  CompanyMember.findOne.mockResolvedValue(membership());
  Skill.findAll.mockResolvedValue([{ id: 1, name: 'SQL' }, { id: 2, name: 'Excel' }]);
  Posting.findByPk.mockResolvedValue(posting());
  Posting.update.mockResolvedValue([1]);
});

describe('POST /api/v1/postings (US-05)', () => {
  const create = (payload = body, auth = rep) => request(app).post('/api/v1/postings').set('Authorization', auth).send(payload);

  it('saves the posting as a Draft for the rep\'s company, with its skills', async () => {
    const created = posting();
    Posting.create.mockResolvedValue(created);

    const res = await create();

    expect(res.status).toBe(201);
    expect(Posting.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Data Analyst Intern', companyId: 5, createdBy: 7, status: 'draft', stipendCurrency: 'KES' }),
      expect.anything(),
    );
    expect(created.setSkills).toHaveBeenCalledWith([{ id: 1, name: 'SQL' }, { id: 2, name: 'Excel' }], expect.anything());
    expect(res.body.posting).toMatchObject({ id: 9, status: 'draft', skills: ['Excel', 'SQL'], company: { name: 'Acme Ltd' } });
  });

  it('US-04: an unverified company is blocked with an explanation', async () => {
    CompanyMember.findOne.mockResolvedValue(membership({ id: 5, status: 'pending_verification' }));

    const res = await create();

    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: 'COMPANY_NOT_VERIFIED', message: expect.stringMatching(/awaiting admin verification/) });
    expect(Posting.create).not.toHaveBeenCalled();
  });

  it('requires title, description, duration, stipend and skills, and a future deadline', async () => {
    const res = await create({ stipend: -5, deadline: '2020-01-01', skills: [] });

    expect(res.status).toBe(422);
    expect(res.body.error.fields).toMatchObject({
      title: 'Title is required',
      description: 'Description is required',
      durationWeeks: 'Duration is required',
      stipend: 'Stipend cannot be negative',
      deadline: 'The deadline must be in the future',
      skills: 'List at least one required skill',
    });
  });

  it('accepts an unpaid internship (stipend 0) and rejects a deadline over a year out', async () => {
    Posting.create.mockResolvedValue(posting());
    expect((await create({ ...body, stipend: 0 })).status).toBe(201);

    const far = await create({ ...body, deadline: new Date(Date.now() + 400 * DAY).toISOString() });
    expect(far.body.error.fields.deadline).toBe('The deadline must be within a year');
  });

  it('is for company reps only', async () => {
    expect((await create(body, bearer('student'))).status).toBe(403);
  });
});

describe('PUT /api/v1/postings/:id (US-05)', () => {
  const update = (id = 9) => request(app).put(`/api/v1/postings/${id}`).set('Authorization', rep).send(body);

  it('edits a draft', async () => {
    const draft = posting();
    Posting.findByPk.mockResolvedValue(draft);

    expect((await update()).status).toBe(200);
    expect(draft.update).toHaveBeenCalledWith(expect.objectContaining({ title: 'Data Analyst Intern' }), expect.anything());
  });

  it('refuses to edit a published posting', async () => {
    Posting.findByPk.mockResolvedValue(posting({ status: 'active' }));

    const res = await update();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('POSTING_NOT_EDITABLE');
  });

  it("reports another company's posting as not found", async () => {
    Posting.findByPk.mockResolvedValue(posting({ companyId: 99 }));

    expect((await update()).status).toBe(404);
  });
});

describe('POST /api/v1/postings/:id/publish (US-05)', () => {
  const publish = () => request(app).post('/api/v1/postings/9/publish').set('Authorization', rep);

  it('turns a draft Active and stamps when', async () => {
    const res = await publish();

    expect(res.status).toBe(200);
    expect(Posting.update).toHaveBeenCalledWith(
      { status: 'active', publishedAt: expect.any(Date) },
      { where: { id: 9, status: 'draft' } },
    );
  });

  it('only publishes a draft', async () => {
    Posting.findByPk.mockResolvedValue(posting({ status: 'closed' }));
    Posting.update.mockResolvedValue([0]);

    const res = await publish();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('POSTING_NOT_DRAFT');
  });

  it('refuses a draft whose deadline has passed', async () => {
    Posting.findByPk.mockResolvedValue(posting({ deadline: new Date(Date.now() - DAY) }));

    const res = await publish();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DEADLINE_PASSED');
    expect(Posting.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/postings/:id/close (US-05)', () => {
  it('closes an active posting, even for a company no longer verified', async () => {
    CompanyMember.findOne.mockResolvedValue(membership({ id: 5, status: 'suspended' }));
    Posting.findByPk.mockResolvedValue(posting({ status: 'active' }));

    const res = await request(app).post('/api/v1/postings/9/close').set('Authorization', rep);

    expect(res.status).toBe(200);
    expect(Posting.update).toHaveBeenCalledWith(
      { status: 'closed', closedAt: expect.any(Date) },
      { where: { id: 9, status: 'active' } },
    );
  });

  it('only closes an active posting', async () => {
    Posting.update.mockResolvedValue([0]);

    const res = await request(app).post('/api/v1/postings/9/close').set('Authorization', rep);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('POSTING_NOT_ACTIVE');
  });
});

describe('GET /api/v1/postings (US-03 search)', () => {
  beforeEach(() => {
    // Step 1 pages through ids; step 2 loads those postings with company and skills.
    Posting.findAndCountAll.mockResolvedValue({ rows: [{ id: 9 }], count: 1 });
    Posting.findAll.mockResolvedValue([posting({ status: 'active' })]);
  });

  it('pages through ids without joins (MATCH cannot run on a subquery), then loads them in order', async () => {
    Posting.findAndCountAll.mockResolvedValue({ rows: [{ id: 3 }, { id: 9 }], count: 2 });
    Posting.findAll.mockResolvedValue([posting({ id: 9 }), posting({ id: 3 })]);

    const res = await request(app).get('/api/v1/postings?q=data');

    const page = Posting.findAndCountAll.mock.calls[0][0];
    expect(page.attributes).toEqual(['id']);
    expect(page).not.toHaveProperty('include');
    expect(Posting.findAll.mock.calls[0][0].where).toEqual({ id: { [Op.in]: [3, 9] } });
    expect(res.body.items.map((p) => p.id)).toEqual([3, 9]);
  });

  it('is public and shows only active postings whose deadline is ahead, newest first', async () => {
    const res = await request(app).get('/api/v1/postings');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, limit: 20, total: 1, items: [{ id: 9, status: 'active' }] });
    const { where, order } = Posting.findAndCountAll.mock.calls[0][0];
    expect(where.status).toBe('active');
    expect(where.deadline[Op.gt]).toBeInstanceOf(Date);
    expect(order).toEqual([['publishedAt', 'DESC']]);
  });

  it('matches keywords with FULLTEXT, best match first', async () => {
    await request(app).get('/api/v1/postings?q=data analy');

    const { where, order } = Posting.findAndCountAll.mock.calls[0][0];
    const sql = where[Op.and][0].literal;
    expect(sql).toBe("MATCH (`Posting`.`title`, `Posting`.`description`) AGAINST ('+data* +analy*' IN BOOLEAN MODE)");
    expect(order[0]).toEqual([{ literal: sql }, 'DESC']);
  });

  it('filters by location (contains) and domain (exact), escaping LIKE wildcards', async () => {
    await request(app).get('/api/v1/postings?location=Nai%25&domain=Data&page=2&limit=10');

    const { where, limit, offset } = Posting.findAndCountAll.mock.calls[0][0];
    expect(where.location).toEqual({ [Op.like]: '%Nai\\%%' });
    expect(where.domain).toBe('Data');
    expect({ limit, offset }).toEqual({ limit: 10, offset: 10 });
  });

  it('returns nothing (without querying) for a keyword made only of symbols', async () => {
    const res = await request(app).get('/api/v1/postings?q=%2B%2B%2B');

    expect(res.body).toMatchObject({ items: [], total: 0 });
    expect(Posting.findAndCountAll).not.toHaveBeenCalled();
  });

  it('caps the page size', async () => {
    expect((await request(app).get('/api/v1/postings?limit=500')).status).toBe(422);
  });
});

describe('toBooleanQuery', () => {
  it('requires every word as a prefix and drops FULLTEXT operators', () => {
    expect(toBooleanQuery('data  analyst')).toBe('+data* +analyst*');
    expect(toBooleanQuery('"C++" -java (dev)')).toBe('+C* +java* +dev*');
    expect(toBooleanQuery('Développeur Nairobi')).toBe('+Développeur* +Nairobi*');
  });
});

describe('GET /api/v1/postings/:id', () => {
  it('shows an active posting to anyone', async () => {
    Posting.findByPk.mockResolvedValue(posting({ status: 'active' }));

    const res = await request(app).get('/api/v1/postings/9');

    expect(res.status).toBe(200);
    expect(res.body.posting).toMatchObject({ id: 9, title: 'Data Analyst Intern', stipend: 15000 });
  });

  it('hides a draft from the public and from other companies', async () => {
    expect((await request(app).get('/api/v1/postings/9')).status).toBe(404);

    CompanyMember.findOne.mockResolvedValue(membership({ id: 77, status: 'verified' }));
    expect((await request(app).get('/api/v1/postings/9').set('Authorization', rep)).status).toBe(404);
  });

  it('shows a draft to its own company', async () => {
    expect((await request(app).get('/api/v1/postings/9').set('Authorization', rep)).status).toBe(200);
  });

  it('rejects a bad token rather than silently treating the caller as anonymous', async () => {
    expect((await request(app).get('/api/v1/postings/9').set('Authorization', 'Bearer nope')).status).toBe(401);
  });

  it('returns 404 for a malformed id', async () => {
    expect((await request(app).get('/api/v1/postings/abc')).status).toBe(404);
  });
});

describe('GET /api/v1/companies/me/postings (US-05)', () => {
  it("lists the company's postings, drafts included", async () => {
    Posting.findAndCountAll.mockResolvedValue({ rows: [posting()], count: 1 });

    const res = await request(app).get('/api/v1/companies/me/postings?status=draft').set('Authorization', rep);

    expect(res.status).toBe(200);
    expect(Posting.findAndCountAll.mock.calls[0][0].where).toEqual({ companyId: 5, status: 'draft' });
    expect(res.body.items[0]).toMatchObject({ status: 'draft' });
  });
});

describe('postings.autoClose job (US-05)', () => {
  it('closes every active posting whose deadline has passed', async () => {
    Posting.update.mockResolvedValue([3]);
    const now = new Date('2026-10-06T12:00:00Z');

    await expect(closeExpiredPostings(now)).resolves.toBe(3);
    expect(Posting.update).toHaveBeenCalledWith(
      { status: 'closed', closedAt: now },
      { where: { status: 'active', deadline: { [Op.lte]: now } } },
    );
  });

  it('runs through the maintenance processor', async () => {
    Posting.update.mockResolvedValue([0]);

    await expect(processMaintenance({ name: 'postings.autoClose' })).resolves.toEqual({ closed: 0 });
    await expect(processMaintenance({ name: 'nope' })).rejects.toThrow(/Unknown maintenance job/);
  });
});
