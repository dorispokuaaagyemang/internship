import bcrypt from 'bcryptjs';
import request from 'supertest';
import { UniqueConstraintError } from 'sequelize';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  User,
  CompanyMember,
  Application,
  Internship,
  SupervisorAssignment,
  Evaluation,
  AccountInvite,
  Notification,
} from '../../src/db/models/index.js';
import redis from '../../src/lib/redis.js';
import { enqueueEmail } from '../../src/jobs/queues.js';
import { record } from '../../src/modules/audit/service.js';
import { hashToken, signAccessToken } from '../../src/lib/tokens.js';
import { createApp } from '../../src/app.js';

vi.mock('../../src/db/models/index.js', () => ({
  sequelize: { transaction: vi.fn((fn) => fn({})), fn: vi.fn(), col: vi.fn() },
  User: { create: vi.fn(), findByPk: vi.fn(), findOne: vi.fn() },
  Company: {},
  CompanyMember: { create: vi.fn(), findOne: vi.fn(), findAll: vi.fn() },
  Posting: {},
  StudentProfile: { findByPk: vi.fn() },
  Skill: {},
  StoredFile: {},
  Application: { findByPk: vi.fn(), update: vi.fn() },
  ApplicationStatusHistory: { create: vi.fn() },
  Internship: { create: vi.fn(), findByPk: vi.fn(), findAndCountAll: vi.fn() },
  SupervisorAssignment: { create: vi.fn(), update: vi.fn(), findAll: vi.fn() },
  Evaluation: { create: vi.fn(), findAll: vi.fn(), findByPk: vi.fn() },
  Certificate: {},
  AccountInvite: { create: vi.fn(), findOne: vi.fn(), update: vi.fn() },
  RefreshToken: { create: vi.fn() },
  Notification: { bulkCreate: vi.fn(async (rows) => rows.map((r, i) => ({ id: i + 1, readAt: null, createdAt: new Date(), ...r }))) },
}));
vi.mock('../../src/lib/redis.js', () => ({ default: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
vi.mock('../../src/jobs/queues.js', () => ({ enqueueEmail: vi.fn(), enqueueCertificate: vi.fn() }));
vi.mock('../../src/modules/audit/service.js', () => ({ record: vi.fn() }));

const app = createApp();
const bearer = (role, id) => `Bearer ${signAccessToken({ id, role })}`;
const rep = bearer('company_rep', 20);
const DAY = 86_400_000;

const repMembership = { companyId: 5, memberRole: 'rep', company: { id: 5, name: 'Acme Ltd' } };

// An internship as loaded with its details (application, posting, company, profile, supervisor).
function internship(overrides = {}) {
  return {
    id: 40,
    status: 'ongoing',
    startDate: '2026-11-02',
    endDate: '2026-11-29',
    completedAt: null,
    application: {
      id: 30,
      studentId: 7,
      posting: { id: 9, title: 'Data Analyst Intern', location: 'Nairobi', companyId: 5, company: { id: 5, name: 'Acme Ltd' } },
      profile: { userId: 7, fullName: 'Ada Lovelace', university: 'UoN', department: 'CS', gpa: 3.6, resumeFileId: null, skills: [{ name: 'SQL' }] },
      student: { id: 7, email: 'ada@example.com' },
    },
    activeAssignment: null,
    update: vi.fn(async function (values) {
      Object.assign(this, values);
    }),
    ...overrides,
  };
}
const withSupervisor = (id = 50) => ({
  supervisorUserId: id,
  assignedAt: new Date(),
  supervisor: { id, email: 'sv@acme.co.ke', membership: { fullName: 'Grace Hopper' } },
});

beforeEach(() => {
  vi.clearAllMocks();
  redis.get.mockResolvedValue('active');
  CompanyMember.findOne.mockResolvedValue(repMembership);
  enqueueEmail.mockResolvedValue({});
});

describe('accepting an applicant creates the internship (US-09)', () => {
  const accepted = () => ({
    id: 30,
    postingId: 9,
    studentId: 7,
    status: 'interviewed',
    posting: { id: 9, companyId: 5, title: 'Data Analyst Intern', durationWeeks: 12, company: { id: 5, name: 'Acme Ltd' } },
  });

  beforeEach(() => {
    Application.findByPk.mockResolvedValue(accepted());
    Application.update.mockResolvedValue([1]);
    User.findByPk.mockResolvedValue({ id: 7, email: 'ada@example.com' });
  });

  it("starts on the given date and runs for the posting's duration, in the same transaction", async () => {
    const res = await request(app).patch('/api/v1/applications/30/status').set('Authorization', rep).send({ status: 'accepted', startDate: '2026-11-02' });

    expect(res.status).toBe(200);
    expect(Internship.create).toHaveBeenCalledWith(
      { applicationId: 30, startDate: '2026-11-02', endDate: '2027-01-24', status: 'ongoing' },
      { transaction: expect.anything() },
    );
  });

  it('defaults the start to today', async () => {
    await request(app).patch('/api/v1/applications/30/status').set('Authorization', rep).send({ status: 'accepted' });

    expect(Internship.create.mock.calls[0][0].startDate).toBe(new Date().toISOString().slice(0, 10));
  });

  it('takes a start date only when accepting, and only a real date', async () => {
    const wrongMove = await request(app).patch('/api/v1/applications/30/status').set('Authorization', rep).send({ status: 'rejected', startDate: '2026-11-02' });
    expect(wrongMove.status).toBe(422);

    const badDate = await request(app).patch('/api/v1/applications/30/status').set('Authorization', rep).send({ status: 'accepted', startDate: '2026-02-30' });
    expect(badDate.body.error.fields.startDate).toBe('Enter a date as YYYY-MM-DD');
    expect(Internship.create).not.toHaveBeenCalled();
  });
});

describe('staff invites (US-09)', () => {
  it('adds a supervisor as a pending account and emails a link to set a password', async () => {
    User.findByPk.mockResolvedValue({ id: 20, role: 'company_rep' });
    User.create.mockImplementation(async (values) => ({ id: 50, ...values }));
    CompanyMember.create.mockImplementation(async (values) => values);

    const res = await request(app).post('/api/v1/companies/me/staff').set('Authorization', rep).send({ fullName: 'Grace Hopper', email: 'Grace@Acme.co.ke' });

    expect(res.status).toBe(201);
    expect(res.body.member).toMatchObject({ id: 50, email: 'grace@acme.co.ke', fullName: 'Grace Hopper', status: 'invited', activeInterns: 0 });
    expect(User.create).toHaveBeenCalledWith({ email: 'grace@acme.co.ke', displayName: 'Grace Hopper', role: 'supervisor', status: 'pending' }, expect.anything());
    expect(CompanyMember.create).toHaveBeenCalledWith({ companyId: 5, userId: 50, memberRole: 'supervisor', fullName: 'Grace Hopper' }, expect.anything());

    const [template, to, data] = enqueueEmail.mock.calls[0];
    expect([template, to]).toEqual(['staffInvite', 'grace@acme.co.ke']);
    const token = data.url.split('/').pop();
    expect(data.url).toBe(`http://localhost:5173/accept-invite/${token}`);
    expect(AccountInvite.create.mock.calls[0][0]).toMatchObject({ userId: 50, invitedBy: 20, tokenHash: hashToken(token) });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'company.staff_added' }), expect.anything());
  });

  it('refuses an email that already has an account', async () => {
    User.findByPk.mockResolvedValue({ id: 20 });
    User.create.mockRejectedValue(new UniqueConstraintError({}));

    const res = await request(app).post('/api/v1/companies/me/staff').set('Authorization', rep).send({ fullName: 'Grace', email: 'ada@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.error.fields.email).toMatch(/already exists/);
  });

  it('lists staff with each supervisor\'s current number of interns', async () => {
    CompanyMember.findAll.mockResolvedValue([
      { userId: 20, memberRole: 'rep', fullName: null, user: { id: 20, email: 'rep@acme.co.ke', status: 'active', passwordHash: 'h' } },
      { userId: 50, memberRole: 'supervisor', fullName: 'Grace Hopper', user: { id: 50, email: 'sv@acme.co.ke', status: 'active', passwordHash: 'h' } },
      { userId: 51, memberRole: 'supervisor', fullName: 'New Person', user: { id: 51, email: 'new@acme.co.ke', status: 'pending', passwordHash: null } },
    ]);
    SupervisorAssignment.findAll.mockResolvedValue([{ supervisorUserId: 50, n: '3' }]);

    const res = await request(app).get('/api/v1/companies/me/staff').set('Authorization', rep);

    expect(res.body.items.map((m) => [m.fullName, m.status, m.activeInterns])).toEqual([
      [null, 'active', 0],
      ['Grace Hopper', 'active', 3],
      ['New Person', 'invited', 0],
    ]);
  });
});

describe('accepting an invite (US-09)', () => {
  const pendingSupervisor = () => ({
    id: 50,
    email: 'grace@acme.co.ke',
    role: 'supervisor',
    status: 'pending',
    passwordHash: null,
    emailVerifiedAt: null,
    update: vi.fn(async function (values) {
      Object.assign(this, values);
    }),
    toJSON() {
      const { update, toJSON, passwordHash, ...rest } = this; // eslint-disable-line no-unused-vars
      return rest;
    },
  });
  const invite = (overrides) => ({ id: 1, userId: 50, usedAt: null, expiresAt: new Date(Date.now() + DAY), ...overrides });

  it('shows who the invite is for', async () => {
    AccountInvite.findOne.mockResolvedValue(invite());
    User.findByPk.mockResolvedValue(pendingSupervisor());
    CompanyMember.findOne.mockResolvedValue({ fullName: 'Grace Hopper', company: { name: 'Acme Ltd' } });

    const res = await request(app).get('/api/v1/auth/invite/tok123');

    expect(res.body.invite).toEqual({ email: 'grace@acme.co.ke', fullName: 'Grace Hopper', companyName: 'Acme Ltd' });
    expect(AccountInvite.findOne).toHaveBeenCalledWith({ where: { tokenHash: hashToken('tok123') } });
  });

  it('sets the password, confirms the email, activates and signs in', async () => {
    const user = pendingSupervisor();
    AccountInvite.findOne.mockResolvedValue(invite());
    AccountInvite.update.mockResolvedValue([1]);
    User.findByPk.mockResolvedValue(user);

    const res = await request(app).post('/api/v1/auth/invite/accept').send({ token: 'tok123', password: 'secret#123' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ status: 'active', role: 'supervisor' });
    expect(await bcrypt.compare('secret#123', user.passwordHash)).toBe(true);
    expect(user.emailVerifiedAt).toEqual(expect.any(Date));
    expect(AccountInvite.update).toHaveBeenCalledWith({ usedAt: expect.any(Date) }, { where: { id: 1, usedAt: null }, transaction: expect.anything() });
  });

  it('applies the password rules (US-01)', async () => {
    const res = await request(app).post('/api/v1/auth/invite/accept').send({ token: 'tok123', password: 'password' });
    expect(res.status).toBe(422);
    expect(res.body.error.fields).toHaveProperty('password');
  });

  it('refuses a used link and explains an expired one', async () => {
    AccountInvite.findOne.mockResolvedValueOnce(invite({ usedAt: new Date() }));
    expect((await request(app).get('/api/v1/auth/invite/tok')).body.error.code).toBe('INVITE_INVALID');

    AccountInvite.findOne.mockResolvedValueOnce(invite({ expiresAt: new Date(Date.now() - 1000) }));
    const expired = await request(app).get('/api/v1/auth/invite/tok');
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe('INVITE_EXPIRED');
  });
});

describe('internship access (US-09)', () => {
  it('shows the company and the active supervisor the intern\'s record; the student a lighter view', async () => {
    Internship.findByPk.mockResolvedValue(internship({ activeAssignment: withSupervisor() }));

    const asSupervisor = await request(app).get('/api/v1/internships/40').set('Authorization', bearer('supervisor', 50));
    expect(asSupervisor.body.internship).toMatchObject({
      viewerRole: 'supervisor',
      student: { fullName: 'Ada Lovelace', gpa: 3.6, skills: ['SQL'] },
      supervisor: { fullName: 'Grace Hopper' },
    });

    const asStudent = await request(app).get('/api/v1/internships/40').set('Authorization', bearer('student', 7));
    expect(asStudent.body.internship.viewerRole).toBe('student');
    expect(asStudent.body.internship.student).not.toHaveProperty('gpa');
  });

  it('hides it from another supervisor, student or company', async () => {
    Internship.findByPk.mockResolvedValue(internship({ activeAssignment: withSupervisor(50) }));

    expect((await request(app).get('/api/v1/internships/40').set('Authorization', bearer('supervisor', 51))).status).toBe(404);
    expect((await request(app).get('/api/v1/internships/40').set('Authorization', bearer('student', 8))).status).toBe(404);
    CompanyMember.findOne.mockResolvedValue({ companyId: 99 });
    expect((await request(app).get('/api/v1/internships/40').set('Authorization', rep)).status).toBe(404);
  });

  it("lists a supervisor's current interns only", async () => {
    Internship.findAndCountAll.mockResolvedValue({ rows: [internship({ activeAssignment: withSupervisor() })], count: 1 });

    const res = await request(app).get('/api/v1/internships').set('Authorization', bearer('supervisor', 50));

    expect(res.body.total).toBe(1);
    const assignmentInclude = Internship.findAndCountAll.mock.calls[0][0].include[1];
    expect(assignmentInclude).toMatchObject({ as: 'activeAssignment', where: { supervisorUserId: 50 }, required: true });
  });
});

describe('POST /api/v1/internships/:id/supervisor (US-09)', () => {
  const assign = (supervisorId = 50) => request(app).post('/api/v1/internships/40/supervisor').set('Authorization', rep).send({ supervisorId });

  beforeEach(() => {
    CompanyMember.findOne.mockImplementation(async ({ where }) =>
      where.memberRole === 'supervisor'
        ? where.userId === 50
          ? { fullName: 'Grace Hopper', user: { id: 50, email: 'sv@acme.co.ke', status: 'active' } }
          : null
        : repMembership,
    );
    User.findByPk.mockResolvedValue({ id: 20, role: 'company_rep' });
  });

  it('ends the current assignment and starts the new one together, then tells both people', async () => {
    Internship.findByPk
      .mockResolvedValueOnce(internship({ activeAssignment: withSupervisor(49) }))
      .mockResolvedValue(internship({ activeAssignment: withSupervisor(50) }));

    const res = await assign();

    expect(res.status).toBe(200);
    expect(SupervisorAssignment.update).toHaveBeenCalledWith(
      { active: false, endedAt: expect.any(Date) },
      { where: { internshipId: 40, active: true }, transaction: expect.anything() },
    );
    expect(SupervisorAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({ internshipId: 40, supervisorUserId: 50, assignedBy: 20, active: true }),
      { transaction: expect.anything() },
    );
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'company.supervisor_assigned' }), expect.anything());

    const types = Notification.bulkCreate.mock.calls.map(([rows]) => `${rows[0].type}:${rows[0].userId}`);
    expect(types.sort()).toEqual(['intern.assigned:50', 'supervisor.assigned:7']);
    const recipients = enqueueEmail.mock.calls.filter(([t]) => t === 'supervisorAssigned').map(([, to, d]) => `${d.recipient}:${to}`);
    expect(recipients.sort()).toEqual(['student:ada@example.com', 'supervisor:sv@acme.co.ke']);
  });

  it('only accepts a supervisor from this company\'s staff', async () => {
    Internship.findByPk.mockResolvedValue(internship());

    const res = await assign(99);

    expect(res.status).toBe(422);
    expect(res.body.error.fields.supervisorId).toBe('Not a supervisor in your company');
    expect(SupervisorAssignment.create).not.toHaveBeenCalled();
  });

  it('reports a supervisor who is already assigned', async () => {
    Internship.findByPk.mockResolvedValue(internship({ activeAssignment: withSupervisor(50) }));

    expect((await assign()).body.error.code).toBe('ALREADY_ASSIGNED');
  });

  it('turns a lost race on the one-active-supervisor rule into a clear 409', async () => {
    Internship.findByPk.mockResolvedValue(internship());
    SupervisorAssignment.create.mockRejectedValueOnce(new UniqueConstraintError({}));

    expect((await assign()).status).toBe(409);
  });
});

describe('evaluations (US-10)', () => {
  const evaluate = (body, auth = bearer('supervisor', 50)) => request(app).post('/api/v1/internships/40/evaluations').set('Authorization', auth).send(body);
  const valid = { period: 'Week 1', rating: 4, comments: 'Solid start', attendance: 'excellent' };

  beforeEach(() => {
    Internship.findByPk.mockResolvedValue(internship({ activeAssignment: withSupervisor(50) }));
    Evaluation.create.mockImplementation(async (values) => ({ id: 70, ...values }));
    Evaluation.findByPk.mockImplementation(async (id) => ({ id, ...valid, isFinal: false, createdAt: new Date(), supervisor: { id: 50, membership: { fullName: 'Grace Hopper' } } }));
  });

  it('lets the active supervisor add one, timestamped, and tells the intern', async () => {
    const res = await evaluate(valid);

    expect(res.status).toBe(201);
    expect(res.body.evaluation).toMatchObject({ id: 70, rating: 4, attendance: 'excellent', isFinal: false, supervisor: { fullName: 'Grace Hopper' } });
    expect(res.body.evaluation.createdAt).toEqual(expect.any(String));
    expect(Evaluation.create).toHaveBeenCalledWith({ internshipId: 40, supervisorId: 50, ...valid, isFinal: false });
    expect(Notification.bulkCreate).toHaveBeenCalledWith([expect.objectContaining({ userId: 7, type: 'evaluation.submitted' })]);
  });

  it('requires rating 1-5, comments and attendance', async () => {
    const res = await evaluate({ period: 'Week 1', rating: 6, comments: ' ', attendance: 'sometimes' });

    expect(res.status).toBe(422);
    expect(res.body.error.fields).toMatchObject({
      rating: 'Rating must be from 1 to 5',
      comments: 'Comments are required',
      attendance: 'Attendance must be one of: excellent, good, fair, poor',
    });
  });

  it('is only for supervisors, and only the active one', async () => {
    expect((await evaluate(valid, bearer('student', 7))).status).toBe(403);
    expect((await evaluate(valid, bearer('supervisor', 51))).status).toBe(404);
    expect(Evaluation.create).not.toHaveBeenCalled();
  });

  it('is read-only for the student, who can still read them', async () => {
    Evaluation.findAll.mockResolvedValue([{ id: 70, ...valid, isFinal: false, createdAt: new Date(), supervisor: null }]);

    const res = await request(app).get('/api/v1/internships/40/evaluations').set('Authorization', bearer('student', 7));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});

describe('PATCH /api/v1/internships/:id/dates', () => {
  it('lets the company change the dates, end not before start', async () => {
    const row = internship();
    Internship.findByPk.mockResolvedValue(row);

    const bad = await request(app).patch('/api/v1/internships/40/dates').set('Authorization', rep).send({ startDate: '2026-11-10', endDate: '2026-11-01' });
    expect(bad.status).toBe(422);

    const ok = await request(app).patch('/api/v1/internships/40/dates').set('Authorization', rep).send({ startDate: '2026-11-02', endDate: '2026-12-18' });
    expect(ok.status).toBe(200);
    expect(row.update).toHaveBeenCalledWith({ startDate: '2026-11-02', endDate: '2026-12-18' });
  });
});
