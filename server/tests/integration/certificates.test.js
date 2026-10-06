import request from 'supertest';
import { UniqueConstraintError } from 'sequelize';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Internship, Evaluation, Certificate, StoredFile, Notification } from '../../src/db/models/index.js';
import redis from '../../src/lib/redis.js';
import { enqueueCertificate, enqueueEmail } from '../../src/jobs/queues.js';
import { putObject, deleteObject, presignDownload } from '../../src/integrations/storage.js';
import { record } from '../../src/modules/audit/service.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { generateCertificate, issueMissingCertificates } from '../../src/modules/internships/service.js';
import { processCertificate } from '../../src/jobs/processors/certificate.js';
import { createApp } from '../../src/app.js';

vi.mock('../../src/db/models/index.js', () => ({
  sequelize: { transaction: vi.fn((fn) => fn({})) },
  User: { findByPk: vi.fn(async (id) => ({ id, role: 'supervisor' })) },
  Company: {},
  CompanyMember: { findOne: vi.fn(), findAll: vi.fn(async () => []) },
  Posting: {},
  StudentProfile: {},
  Skill: {},
  StoredFile: { create: vi.fn() },
  Application: {},
  Internship: { findByPk: vi.fn(), update: vi.fn(), findAll: vi.fn() },
  SupervisorAssignment: {},
  Evaluation: { count: vi.fn() },
  Certificate: { findOne: vi.fn(), create: vi.fn() },
  Notification: { bulkCreate: vi.fn(async (rows) => rows.map((r, i) => ({ id: i + 1, readAt: null, createdAt: new Date(), ...r }))) },
}));
vi.mock('../../src/lib/redis.js', () => ({ default: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
vi.mock('../../src/jobs/queues.js', () => ({ enqueueEmail: vi.fn(), enqueueCertificate: vi.fn() }));
vi.mock('../../src/modules/audit/service.js', () => ({ record: vi.fn() }));
vi.mock('../../src/integrations/storage.js', () => ({
  DOWNLOAD_URL_TTL_SECONDS: 300,
  putObject: vi.fn(),
  deleteObject: vi.fn(),
  presignDownload: vi.fn(),
}));

const app = createApp();
const bearer = (role, id) => `Bearer ${signAccessToken({ id, role })}`;
const supervisor = bearer('supervisor', 50);

function internship(overrides = {}) {
  return {
    id: 40,
    status: 'ongoing',
    startDate: '2026-08-03',
    endDate: '2026-09-25',
    completedAt: null,
    certificate: null,
    application: {
      id: 30,
      studentId: 7,
      posting: { id: 9, title: 'Data Analyst Intern', location: 'Nairobi', companyId: 5, company: { id: 5, name: 'Acme Ltd' } },
      profile: { userId: 7, fullName: 'Ada Lovelace', university: 'UoN', department: 'CS', gpa: 3.6, resumeFileId: null, skills: [] },
      student: { id: 7, email: 'ada@example.com' },
    },
    activeAssignment: { supervisorUserId: 50, assignedAt: new Date(), supervisor: { id: 50, email: 'sv@acme.co.ke', membership: { fullName: 'Grace Hopper' } } },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  redis.get.mockResolvedValue('active');
  Internship.findByPk.mockResolvedValue(internship());
  Internship.update.mockResolvedValue([1]);
  Evaluation.count.mockResolvedValue(1);
  enqueueCertificate.mockResolvedValue({});
  enqueueEmail.mockResolvedValue({});
  putObject.mockResolvedValue();
  deleteObject.mockResolvedValue();
});

describe('POST /api/v1/internships/:id/complete (US-11)', () => {
  const complete = (auth = supervisor) => request(app).post('/api/v1/internships/40/complete').set('Authorization', auth);

  it('marks it completed, audits it and queues the certificate', async () => {
    const res = await complete();

    expect(res.status).toBe(202);
    expect(Internship.update).toHaveBeenCalledWith(
      { status: 'completed', completedAt: expect.any(Date), completedBy: 50 },
      { where: { id: 40, status: 'ongoing' }, transaction: expect.anything() },
    );
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'internship.completed' }), expect.anything());
    expect(enqueueCertificate).toHaveBeenCalledWith(40);
  });

  it('blocks it with a validation message until the end date has passed and a final evaluation exists', async () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    Internship.findByPk.mockResolvedValue(internship({ endDate: future }));
    Evaluation.count.mockResolvedValue(0);

    const res = await complete();

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CERTIFICATE_NOT_READY');
    expect(res.body.error.fields).toEqual({
      endDate: `The internship ends on ${future}; it can be completed after that day`,
      finalEvaluation: 'Submit a final evaluation first',
    });
    expect(Internship.update).not.toHaveBeenCalled();
    expect(enqueueCertificate).not.toHaveBeenCalled();
  });

  it('counts only final evaluations', async () => {
    Evaluation.count.mockResolvedValue(0);
    await complete();
    expect(Evaluation.count).toHaveBeenCalledWith({ where: { internshipId: 40, isFinal: true } });
  });

  it('lets an admin confirm too, but not the company or the student', async () => {
    expect((await complete(bearer('admin', 1))).status).toBe(202);
    expect((await complete(bearer('student', 7))).status).toBe(403);
  });

  it('still completes when the queue is down (the sweep issues the certificate later)', async () => {
    enqueueCertificate.mockRejectedValue(new Error('timed out'));
    expect((await complete()).status).toBe(202);
  });

  it('refuses a second completion', async () => {
    Internship.findByPk.mockResolvedValue(internship({ status: 'completed' }));
    expect((await complete()).body.error.code).toBe('INTERNSHIP_COMPLETED');
  });
});

describe('the certificate.generate job (US-11)', () => {
  beforeEach(() => {
    Internship.findByPk.mockResolvedValue(internship({ status: 'completed' }));
    Certificate.findOne.mockResolvedValue(null);
    StoredFile.create.mockImplementation(async (values) => ({ id: 80, ...values }));
    Certificate.create.mockImplementation(async (values) => ({ id: 90, ...values }));
  });

  it('renders the PDF, stores it privately, records it and tells the student', async () => {
    await expect(processCertificate({ data: { internshipId: 40 } })).resolves.toEqual({ issued: true });

    const put = putObject.mock.calls[0][0];
    expect(put).toMatchObject({ bucket: 'certificates', contentType: 'application/pdf' });
    expect(put.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(put.key).toMatch(/^internships\/40\/CERT-\d{4}-000040-[0-9A-F]{6}\.pdf$/);

    expect(StoredFile.create.mock.calls[0][0]).toMatchObject({ ownerUserId: 7, bucket: 'certificates', objectKey: put.key, mime: 'application/pdf', size: put.body.length });
    const cert = Certificate.create.mock.calls[0][0];
    expect(cert).toMatchObject({ internshipId: 40, fileId: 80, serialNo: expect.stringMatching(/^CERT-/) });

    expect(Notification.bulkCreate).toHaveBeenCalledWith([expect.objectContaining({ userId: 7, type: 'certificate.issued', payload: expect.objectContaining({ serialNo: cert.serialNo }) })]);
    expect(enqueueEmail).toHaveBeenCalledWith('certificateIssued', 'ada@example.com', expect.objectContaining({ serialNo: cert.serialNo, url: 'http://localhost:5173/my-internships/40' }));
  });

  it('is idempotent: an existing certificate is left alone', async () => {
    Certificate.findOne.mockResolvedValue({ id: 90 });

    await expect(generateCertificate(40)).resolves.toBeNull();
    expect(putObject).not.toHaveBeenCalled();
  });

  it('drops its PDF when a parallel run won the race', async () => {
    Certificate.create.mockRejectedValue(new UniqueConstraintError({}));

    await expect(generateCertificate(40)).resolves.toBeNull();
    expect(deleteObject).toHaveBeenCalledWith({ bucket: 'certificates', key: putObject.mock.calls[0][0].key });
  });

  it('does nothing for an internship that is not completed', async () => {
    Internship.findByPk.mockResolvedValue(internship({ status: 'ongoing' }));
    await expect(generateCertificate(40)).resolves.toBeNull();
    expect(putObject).not.toHaveBeenCalled();
  });

  it('the sweep issues only the missing ones', async () => {
    Internship.findAll.mockResolvedValue([{ id: 40, certificate: null }, { id: 41, certificate: { id: 3 } }]);

    await expect(issueMissingCertificates()).resolves.toBe(1);
    expect(putObject).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/v1/internships/:id/certificate (US-11)', () => {
  it('gives the intern a 5-minute download link', async () => {
    Internship.findByPk.mockResolvedValue(internship({ status: 'completed' }));
    Certificate.findOne.mockResolvedValue({ serialNo: 'CERT-2026-000040-ABC123', issuedAt: new Date(), file: { bucket: 'certificates', objectKey: 'k', originalName: 'Certificate.pdf' } });
    presignDownload.mockResolvedValue('https://storage.example/signed');

    const res = await request(app).get('/api/v1/internships/40/certificate').set('Authorization', bearer('student', 7));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ url: 'https://storage.example/signed', serialNo: 'CERT-2026-000040-ABC123' });
  });

  it('says whether it is still being prepared or not issued at all', async () => {
    Certificate.findOne.mockResolvedValue(null);

    Internship.findByPk.mockResolvedValueOnce(internship({ status: 'completed' }));
    expect((await request(app).get('/api/v1/internships/40/certificate').set('Authorization', bearer('student', 7))).body.error.code).toBe('CERTIFICATE_PENDING');

    Internship.findByPk.mockResolvedValueOnce(internship());
    expect((await request(app).get('/api/v1/internships/40/certificate').set('Authorization', bearer('student', 7))).body.error.code).toBe('CERTIFICATE_NOT_ISSUED');
  });
});
