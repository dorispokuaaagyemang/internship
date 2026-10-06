import request from 'supertest';
import { Op, UniqueConstraintError } from 'sequelize';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Notification,
  User,
  CompanyMember,
  Posting,
  StudentProfile,
  Application,
  ApplicationStatusHistory,
} from '../../src/db/models/index.js';
import redis from '../../src/lib/redis.js';
import { enqueueEmail } from '../../src/jobs/queues.js';
import { presignDownload } from '../../src/integrations/storage.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { TRANSITIONS, allowedActions } from '../../src/modules/applications/service.js';
import { createApp } from '../../src/app.js';

vi.mock('../../src/db/models/index.js', () => ({
  sequelize: {
    transaction: vi.fn((fn) => fn({})),
    literal: vi.fn((sql) => ({ literal: sql })),
    escape: vi.fn((s) => `'${s}'`),
  },
  User: { findByPk: vi.fn() },
  Company: {},
  CompanyMember: { findOne: vi.fn(), findAll: vi.fn() },
  Skill: {},
  StoredFile: {},
  Posting: { findByPk: vi.fn() },
  StudentProfile: { findByPk: vi.fn() },
  Application: { create: vi.fn(), findByPk: vi.fn(), update: vi.fn(), findAndCountAll: vi.fn(), findAll: vi.fn() },
  ApplicationStatusHistory: { create: vi.fn() },
  Notification: { bulkCreate: vi.fn(async (rows) => rows.map((r, i) => ({ id: i + 1, readAt: null, createdAt: new Date(), ...r }))) },
}));
vi.mock('../../src/lib/redis.js', () => ({ default: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
vi.mock('../../src/jobs/queues.js', () => ({ enqueueEmail: vi.fn() }));
vi.mock('../../src/integrations/storage.js', () => ({ DOWNLOAD_URL_TTL_SECONDS: 300, presignDownload: vi.fn() }));

const app = createApp();
const bearer = (role, id) => `Bearer ${signAccessToken({ id, role })}`;
const student = bearer('student', 7);
const rep = bearer('company_rep', 20);
const DAY = 24 * 60 * 60 * 1000;

const openPosting = (overrides = {}) => ({
  id: 9,
  companyId: 5,
  title: 'Data Analyst Intern',
  location: 'Nairobi',
  status: 'active',
  deadline: new Date(Date.now() + 5 * DAY),
  company: { id: 5, name: 'Acme Ltd' },
  ...overrides,
});
const completeProfile = { userId: 7, fullName: 'Ada Lovelace', university: 'University of Nairobi', department: 'CS' };
const application = (overrides = {}) => ({
  id: 30,
  postingId: 9,
  studentId: 7,
  status: 'applied',
  coverLetter: null,
  createdAt: new Date('2026-10-06T09:00:00Z'),
  posting: openPosting(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  redis.get.mockResolvedValue('active');
  Posting.findByPk.mockResolvedValue(openPosting());
  StudentProfile.findByPk.mockResolvedValue(completeProfile);
  User.findByPk.mockResolvedValue({ id: 7, email: 'ada@example.com' });
  Application.create.mockImplementation(async (values) => ({ id: 30, createdAt: new Date(), ...values }));
  Application.update.mockResolvedValue([1]);
  CompanyMember.findOne.mockResolvedValue({ companyId: 5, memberRole: 'rep' });
  CompanyMember.findAll.mockResolvedValue([{ user: { id: 20, email: 'rep@acme.co.ke' } }]);
  enqueueEmail.mockResolvedValue({});
});

describe('the transition table (US-07, US-08)', () => {
  it('covers exactly the six statuses', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual(['accepted', 'applied', 'interviewed', 'rejected', 'shortlisted', 'withdrawn']);
  });

  it('lets the student withdraw only from Applied or Shortlisted', () => {
    expect(allowedActions('applied', 'student')).toEqual(['withdraw']);
    expect(allowedActions('shortlisted', 'student')).toEqual(['withdraw']);
    for (const status of ['interviewed', 'accepted', 'rejected', 'withdrawn']) {
      expect(allowedActions(status, 'student')).toEqual([]);
    }
  });

  it('gives the company the moves in ARCHITECTURE.md §5.1', () => {
    expect(allowedActions('applied', 'company')).toEqual(['shortlisted', 'interviewed', 'rejected']);
    expect(allowedActions('interviewed', 'company')).toEqual(['accepted', 'rejected']);
    expect(allowedActions('accepted', 'company')).toEqual([]);
  });
});

describe('POST /api/v1/postings/:id/apply (US-03)', () => {
  const apply = (body = {}, auth = student) => request(app).post('/api/v1/postings/9/apply').set('Authorization', auth).send(body);

  it('creates the application as Applied, records it, and emails the student a confirmation', async () => {
    const res = await apply({ coverLetter: 'I love data.' });

    expect(res.status).toBe(201);
    expect(res.body.application).toMatchObject({ id: 30, status: 'applied', allowedActions: ['withdraw'], posting: { id: 9, company: { name: 'Acme Ltd' } } });
    expect(Application.create).toHaveBeenCalledWith(
      { postingId: 9, studentId: 7, status: 'applied', coverLetter: 'I love data.' },
      expect.anything(),
    );
    expect(ApplicationStatusHistory.create).toHaveBeenCalledWith(
      { applicationId: 30, fromStatus: null, toStatus: 'applied', changedBy: 7 },
      expect.anything(),
    );
    expect(enqueueEmail).toHaveBeenCalledWith('applicationReceived', 'ada@example.com', {
      postingTitle: 'Data Analyst Intern',
      companyName: 'Acme Ltd',
      url: 'http://localhost:5173/applications/30',
    });
    // In-app: the student's confirmation, and the new applicant for the company's reps.
    const payload = { applicationId: 30, postingId: 9, postingTitle: 'Data Analyst Intern', companyName: 'Acme Ltd' };
    expect(Notification.bulkCreate).toHaveBeenCalledWith([{ userId: 7, type: 'application.submitted', payload: { ...payload, status: 'applied' } }]);
    expect(Notification.bulkCreate).toHaveBeenCalledWith([{ userId: 20, type: 'application.received', payload }]);
  });

  it('checks profile completeness first and names the missing fields', async () => {
    StudentProfile.findByPk.mockResolvedValue({ ...completeProfile, university: '', department: null });

    const res = await apply();

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'PROFILE_INCOMPLETE',
      fields: { university: 'Required before applying', department: 'Required before applying' },
    });
    expect(Application.create).not.toHaveBeenCalled();
  });

  it('treats a missing profile as incomplete', async () => {
    StudentProfile.findByPk.mockResolvedValue(null);

    expect((await apply()).body.error.code).toBe('PROFILE_INCOMPLETE');
  });

  it('prevents a duplicate application with 409 ALREADY_APPLIED', async () => {
    Application.create.mockRejectedValue(new UniqueConstraintError({}));

    const res = await apply();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_APPLIED');
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it('US-05: refuses a closed posting, and an active one past its deadline', async () => {
    Posting.findByPk.mockResolvedValueOnce(openPosting({ status: 'closed' }));
    expect((await apply()).body.error.code).toBe('POSTING_CLOSED');

    Posting.findByPk.mockResolvedValueOnce(openPosting({ deadline: new Date(Date.now() - 1000) }));
    expect((await apply()).body.error.code).toBe('POSTING_CLOSED');
  });

  it('treats a draft as not found', async () => {
    Posting.findByPk.mockResolvedValue(openPosting({ status: 'draft' }));

    expect((await apply()).status).toBe(404);
  });

  it('US-01: an unverified email blocks applying', async () => {
    redis.get.mockResolvedValue('pending');
    User.findByPk.mockResolvedValue({ id: 7, passwordHash: 'h', emailVerifiedAt: null });

    const res = await apply();

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('still applies when the email queue is down', async () => {
    enqueueEmail.mockRejectedValue(new Error('timed out'));

    expect((await apply()).status).toBe(201);
  });

  it('is for students only', async () => {
    expect((await apply({}, rep)).status).toBe(403);
  });
});

describe('GET /api/v1/applications/me (US-07)', () => {
  it("lists the student's applications, newest first, with what they can do next", async () => {
    Application.findAndCountAll.mockResolvedValue({ rows: [application({ status: 'interviewed' })], count: 1 });

    const res = await request(app).get('/api/v1/applications/me?status=interviewed').set('Authorization', student);

    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ id: 30, status: 'interviewed', allowedActions: [], posting: { title: 'Data Analyst Intern' } });
    expect(Application.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { studentId: 7, status: 'interviewed' }, order: [['createdAt', 'DESC']] }),
    );
  });
});

describe('GET /api/v1/applications/:id', () => {
  const detailed = (overrides) =>
    application({
      profile: { userId: 7, fullName: 'Ada Lovelace', university: 'UoN', department: 'CS', gpa: 3.6, resumeFileId: 4, skills: [{ name: 'SQL' }] },
      student: { id: 7, email: 'ada@example.com' },
      history: [{ fromStatus: null, toStatus: 'applied', createdAt: new Date('2026-10-06T09:00:00Z'), note: null }],
      ...overrides,
    });

  it('shows the student their application and its history', async () => {
    Application.findByPk.mockResolvedValue(detailed());

    const res = await request(app).get('/api/v1/applications/30').set('Authorization', student);

    expect(res.status).toBe(200);
    expect(res.body.application).toMatchObject({ allowedActions: ['withdraw'], history: [{ from: null, to: 'applied' }] });
    expect(res.body.application).not.toHaveProperty('student');
  });

  it("shows a rep of the posting's company the applicant summary and their moves", async () => {
    Application.findByPk.mockResolvedValue(detailed());

    const res = await request(app).get('/api/v1/applications/30').set('Authorization', rep);

    expect(res.body.application).toMatchObject({
      allowedActions: ['shortlisted', 'interviewed', 'rejected'],
      student: { fullName: 'Ada Lovelace', gpa: 3.6, skills: ['SQL'], hasResume: true, email: 'ada@example.com' },
    });
  });

  it('hides it from other students and other companies', async () => {
    Application.findByPk.mockResolvedValue(detailed());

    expect((await request(app).get('/api/v1/applications/30').set('Authorization', bearer('student', 8))).status).toBe(404);
    CompanyMember.findOne.mockResolvedValue({ companyId: 99 });
    expect((await request(app).get('/api/v1/applications/30').set('Authorization', rep)).status).toBe(404);
  });
});

describe('POST /api/v1/applications/:id/withdraw (US-08)', () => {
  const withdraw = () => request(app).post('/api/v1/applications/30/withdraw').set('Authorization', student);

  it.each(['applied', 'shortlisted'])('withdraws from %s and notifies the company', async (status) => {
    Application.findByPk.mockResolvedValue(application({ status }));
    StudentProfile.findByPk.mockResolvedValue({ fullName: 'Ada Lovelace' });

    const res = await withdraw();

    expect(res.status).toBe(200);
    expect(res.body.application).toMatchObject({ status: 'withdrawn', allowedActions: [] });
    expect(Application.update).toHaveBeenCalledWith({ status: 'withdrawn' }, { where: { id: 30, status }, transaction: expect.anything() });
    expect(ApplicationStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ fromStatus: status, toStatus: 'withdrawn', changedBy: 7 }),
      expect.anything(),
    );
    expect(enqueueEmail).toHaveBeenCalledWith('applicationWithdrawn', 'rep@acme.co.ke', expect.objectContaining({ studentName: 'Ada Lovelace' }));
    expect(Notification.bulkCreate).toHaveBeenCalledWith([
      { userId: 20, type: 'application.withdrawn', payload: expect.objectContaining({ applicationId: 30, studentName: 'Ada Lovelace' }) },
    ]);
  });

  it.each(['interviewed', 'accepted', 'rejected', 'withdrawn'])('refuses from %s with 409', async (status) => {
    Application.findByPk.mockResolvedValue(application({ status }));

    const res = await withdraw();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('WITHDRAW_NOT_ALLOWED');
    expect(Application.update).not.toHaveBeenCalled();
  });

  it("cannot withdraw someone else's application", async () => {
    Application.findByPk.mockResolvedValue(application({ studentId: 8 }));

    expect((await withdraw()).status).toBe(404);
  });
});

describe('PATCH /api/v1/applications/:id/status (US-06, US-07)', () => {
  const change = (body) => request(app).patch('/api/v1/applications/30/status').set('Authorization', rep).send(body);

  it('moves the application on, records who and why, and emails the student', async () => {
    Application.findByPk.mockResolvedValue(application());

    const res = await change({ status: 'shortlisted', note: 'Strong SQL' });

    expect(res.status).toBe(200);
    expect(res.body.application).toMatchObject({ status: 'shortlisted', allowedActions: ['interviewed', 'rejected'] });
    expect(ApplicationStatusHistory.create).toHaveBeenCalledWith(
      { applicationId: 30, fromStatus: 'applied', toStatus: 'shortlisted', changedBy: 20, note: 'Strong SQL' },
      expect.anything(),
    );
    expect(enqueueEmail).toHaveBeenCalledWith(
      'applicationStatusChanged',
      'ada@example.com',
      expect.objectContaining({ from: 'applied', to: 'shortlisted', companyName: 'Acme Ltd' }),
    );
    expect(Notification.bulkCreate).toHaveBeenCalledWith([
      { userId: 7, type: 'application.status_changed', payload: expect.objectContaining({ applicationId: 30, from: 'applied', to: 'shortlisted' }) },
    ]);
  });

  it('refuses a move the table does not allow, naming the allowed ones', async () => {
    Application.findByPk.mockResolvedValue(application());

    const res = await change({ status: 'accepted' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'INVALID_TRANSITION', fields: { status: 'Allowed next: shortlisted, interviewed, rejected' } });
  });

  it('keeps the status set closed (US-07): withdrawn and made-up values are rejected', async () => {
    expect((await change({ status: 'withdrawn' })).status).toBe(422);
    expect((await change({ status: 'hired' })).status).toBe(422);
  });

  it('reports a concurrent change instead of overwriting it', async () => {
    Application.findByPk.mockResolvedValue(application());
    Application.update.mockResolvedValue([0]);

    const res = await change({ status: 'rejected' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('APPLICATION_CHANGED');
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it("is limited to the posting's company", async () => {
    Application.findByPk.mockResolvedValue(application());
    CompanyMember.findOne.mockResolvedValue({ companyId: 99 });

    expect((await change({ status: 'rejected' })).status).toBe(404);
  });
});

describe('GET /api/v1/postings/:id/applications (US-06)', () => {
  const list = (qs = '') => request(app).get(`/api/v1/postings/9/applications${qs}`).set('Authorization', rep);

  beforeEach(() => {
    Application.findAndCountAll.mockResolvedValue({ rows: [{ id: 30 }], count: 1 });
    Application.findAll.mockResolvedValue([
      application({
        profile: { userId: 7, fullName: 'Ada Lovelace', university: 'University of Nairobi', department: 'CS', gpa: 3.6, resumeFileId: null, skills: [{ name: 'SQL' }] },
        student: { id: 7, email: 'ada@example.com' },
      }),
    ]);
  });

  it('lists applicants with profile summaries', async () => {
    const res = await list();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1, items: [{ id: 30, status: 'applied', student: { fullName: 'Ada Lovelace', skills: ['SQL'], hasResume: false } }] });
  });

  it('filters by every listed skill, university (contains) and minimum GPA', async () => {
    await list('?skills=SQL,excel&skills=sql&university=Nairobi&minGpa=3.2');

    const query = Application.findAndCountAll.mock.calls[0][0];
    const skillSql = query.where[Op.and][0].literal;
    expect(skillSql).toContain("WHERE s.name IN ('SQL', 'excel')");
    expect(skillSql).toContain('HAVING COUNT(DISTINCT s.id) = 2');
    expect(query.include[0]).toMatchObject({
      as: 'profile',
      required: true,
      where: { university: { [Op.like]: '%Nairobi%' }, gpa: { [Op.gte]: 3.2 } },
    });
  });

  it('pages through ids without the skill join, then loads details', async () => {
    await list();

    expect(Application.findAndCountAll.mock.calls[0][0]).toMatchObject({ attributes: ['id'], include: [] });
    expect(Application.findAll.mock.calls[0][0].where).toEqual({ id: { [Op.in]: [30] } });
  });

  it("refuses another company's posting", async () => {
    CompanyMember.findOne.mockResolvedValue({ companyId: 99 });

    expect((await list()).status).toBe(404);
  });

  it('validates the filters', async () => {
    const res = await list('?minGpa=9&status=hired');

    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['minGpa', 'status']);
  });
});

describe('GET /api/v1/applications/:id/resume', () => {
  it("gives the posting's company a 5-minute link to the applicant's resume", async () => {
    Application.findByPk.mockResolvedValue(application());
    StudentProfile.findByPk.mockResolvedValue({
      resume: { bucket: 'resumes', objectKey: 'students/7/a.pdf', originalName: 'CV.pdf', mime: 'application/pdf', size: 1234 },
    });
    presignDownload.mockResolvedValue('https://storage.example/signed');

    const res = await request(app).get('/api/v1/applications/30/resume').set('Authorization', rep);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ url: 'https://storage.example/signed', fileName: 'CV.pdf' });
  });

  it('is not available to students', async () => {
    expect((await request(app).get('/api/v1/applications/30/resume').set('Authorization', student)).status).toBe(403);
  });
});
