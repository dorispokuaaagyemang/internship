import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import request from 'supertest';
import { Op } from 'sequelize';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentProfile, Skill, StoredFile } from '../../src/db/models/index.js';
import { putObject, deleteObject, presignDownload } from '../../src/integrations/storage.js';
import redis from '../../src/lib/redis.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { completeness } from '../../src/modules/students/service.js';
import { createApp } from '../../src/app.js';

vi.mock('../../src/db/models/index.js', () => ({
  sequelize: { transaction: vi.fn((fn) => fn({})) },
  User: { findByPk: vi.fn() },
  StudentProfile: { findByPk: vi.fn(), upsert: vi.fn() },
  Skill: { bulkCreate: vi.fn(), findAll: vi.fn() },
  StoredFile: { create: vi.fn(), destroy: vi.fn() },
}));
vi.mock('../../src/integrations/storage.js', () => ({
  DOWNLOAD_URL_TTL_SECONDS: 300,
  putObject: vi.fn(),
  deleteObject: vi.fn(),
  presignDownload: vi.fn(),
}));
vi.mock('../../src/lib/redis.js', () => ({ default: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
vi.mock('../../src/jobs/queues.js', () => ({ enqueueEmail: vi.fn() }));

const app = createApp();
const asRole = (role) => `Bearer ${signAccessToken({ id: 7, role })}`;
const student = asRole('student');

const stored = (overrides = {}) => ({
  userId: 7,
  fullName: 'Ada Lovelace',
  university: 'University of Ghana',
  department: 'Computer Science',
  gpa: 3.6,
  bio: null,
  skills: [{ name: 'SQL' }, { name: 'React' }],
  updatedAt: new Date('2026-10-06T10:00:00Z'),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  redis.get.mockResolvedValue('active');
});

describe('GET /api/v1/students/me (US-02)', () => {
  it('returns null and every missing field before the first save', async () => {
    StudentProfile.findByPk.mockResolvedValue(null);

    const res = await request(app).get('/api/v1/students/me').set('Authorization', student);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      profile: null,
      completeness: { complete: false, missing: ['fullName', 'university', 'department'] },
    });
  });

  it('returns the profile with skills sorted and the last-updated timestamp', async () => {
    StudentProfile.findByPk.mockResolvedValue(stored());

    const res = await request(app).get('/api/v1/students/me').set('Authorization', student);

    expect(res.body.profile).toMatchObject({
      fullName: 'Ada Lovelace',
      gpa: 3.6,
      skills: ['React', 'SQL'],
      updatedAt: '2026-10-06T10:00:00.000Z',
    });
    expect(res.body.completeness.complete).toBe(true);
  });

  it('is for students only', async () => {
    const res = await request(app).get('/api/v1/students/me').set('Authorization', asRole('company_rep'));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('requires sign-in', async () => {
    expect((await request(app).get('/api/v1/students/me')).status).toBe(401);
  });
});

describe('PUT /api/v1/students/me (US-02)', () => {
  const body = {
    fullName: '  Ada Lovelace ',
    university: 'University of Ghana',
    department: 'Computer Science',
    gpa: 3.6,
    skills: ['React', 'react', ' SQL  Server '],
  };

  it('saves the profile, links the skills and returns it with a fresh timestamp', async () => {
    const setSkills = vi.fn();
    StudentProfile.upsert.mockResolvedValue([{ userId: 7, setSkills }]);
    const skillRows = [{ id: 1, name: 'React' }, { id: 2, name: 'SQL Server' }];
    Skill.findAll.mockResolvedValue(skillRows);
    StudentProfile.findByPk.mockResolvedValue(stored({ skills: skillRows }));

    const res = await request(app).put('/api/v1/students/me').set('Authorization', student).send(body);

    expect(res.status).toBe(200);
    expect(StudentProfile.upsert).toHaveBeenCalledWith(
      { userId: 7, fullName: 'Ada Lovelace', university: 'University of Ghana', department: 'Computer Science', gpa: 3.6, bio: null },
      expect.anything(),
    );
    // Duplicates differing only in case are one skill; whitespace is tidied.
    expect(Skill.bulkCreate).toHaveBeenCalledWith([{ name: 'React' }, { name: 'SQL Server' }], expect.objectContaining({ ignoreDuplicates: true }));
    expect(Skill.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { name: { [Op.in]: ['React', 'SQL Server'] } } }));
    expect(setSkills).toHaveBeenCalledWith(skillRows, expect.anything());
    expect(res.body.profile.skills).toEqual(['React', 'SQL Server']);
    expect(res.body.profile.updatedAt).toEqual(expect.any(String));
  });

  it('clears the skills when none are given', async () => {
    const setSkills = vi.fn();
    StudentProfile.upsert.mockResolvedValue([{ userId: 7, setSkills }]);
    StudentProfile.findByPk.mockResolvedValue(stored({ skills: [] }));
    const { skills, ...withoutSkills } = body; // eslint-disable-line no-unused-vars

    await request(app).put('/api/v1/students/me').set('Authorization', student).send(withoutSkills);

    expect(Skill.bulkCreate).not.toHaveBeenCalled();
    expect(setSkills).toHaveBeenCalledWith([], expect.anything());
  });

  it('blocks the save and names every missing mandatory field', async () => {
    const res = await request(app)
      .put('/api/v1/students/me')
      .set('Authorization', student)
      .send({ fullName: '   ', gpa: 3.1 });

    expect(res.status).toBe(422);
    expect(res.body.error.fields).toEqual({
      fullName: 'Full name is required',
      university: 'University is required',
      department: 'Department is required',
    });
    expect(StudentProfile.upsert).not.toHaveBeenCalled();
  });

  it('rejects a GPA outside 0 to 5 and too many skills', async () => {
    const res = await request(app)
      .put('/api/v1/students/me')
      .set('Authorization', student)
      .send({ ...body, gpa: 7, skills: Array.from({ length: 31 }, (_, i) => `skill${i}`) });

    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['gpa', 'skills']);
  });
});

describe('profile completeness (US-03 gate)', () => {
  it('lists exactly the empty mandatory fields', () => {
    expect(completeness({ fullName: 'Ada', university: '', department: null })).toEqual({
      complete: false,
      missing: ['university', 'department'],
    });
    expect(completeness(stored()).complete).toBe(true);
  });
});

// --- Resume upload (US-02) ---

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

// A minimal Word document: a zip (stored, uncompressed) whose [Content_Types].xml names the
// wordprocessingml main part. That is what Word writes and what file-type looks for.
function zip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text);
    const nameBuf = Buffer.from(name);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBuf.length, 28);
    header.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, data);
    central.push(header, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

const DOCX = zip({
  '[Content_Types].xml':
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
});

describe('POST /api/v1/students/me/resume (US-02)', () => {
  const upload = (buffer, filename) =>
    request(app).post('/api/v1/students/me/resume').set('Authorization', student).attach('resume', buffer, filename);
  const savedResume = { originalName: 'CV.pdf', mime: 'application/pdf', size: PDF.length, createdAt: new Date() };

  let profile;
  beforeEach(() => {
    profile = { userId: 7, resume: null, update: vi.fn() };
    // The bare lookup before the upload, then getProfile (skills and resume included) after it.
    StudentProfile.findByPk.mockImplementation(async (id, options) =>
      options?.include?.length === 2 ? stored({ resume: savedResume }) : profile,
    );
    StoredFile.create.mockImplementation(async (values) => ({ id: 11, ...values }));
    putObject.mockResolvedValue();
    deleteObject.mockResolvedValue();
  });

  it('stores a PDF privately, records it and links it to the profile', async () => {
    const res = await upload(PDF, 'My CV.pdf');

    expect(res.status).toBe(201);
    const put = putObject.mock.calls[0][0];
    expect(put).toMatchObject({ bucket: 'resumes', contentType: 'application/pdf' });
    expect(Buffer.compare(put.body, PDF)).toBe(0);
    expect(put.key).toMatch(/^students\/7\/[0-9a-f-]{36}\.pdf$/);
    expect(StoredFile.create.mock.calls[0][0]).toMatchObject({
      ownerUserId: 7,
      bucket: 'resumes',
      objectKey: put.key,
      originalName: 'My CV.pdf',
      mime: 'application/pdf',
      size: PDF.length,
      checksum: createHash('sha256').update(PDF).digest('hex'),
    });
    expect(profile.update).toHaveBeenCalledWith({ resumeFileId: 11 }, expect.anything());
    expect(res.body.profile.resume).toMatchObject({ fileName: 'CV.pdf', mime: 'application/pdf' });
  });

  it('accepts a Word .docx', async () => {
    const res = await upload(DOCX, 'cv.docx');

    expect(res.status).toBe(201);
    expect(putObject.mock.calls[0][0]).toMatchObject({
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(putObject.mock.calls[0][0].key).toMatch(/\.docx$/);
  });

  it('judges the type by content: a renamed file is refused with 415', async () => {
    const res = await upload(Buffer.from('MZ not really a pdf at all'), 'cv.pdf');

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(res.body.error.fields).toHaveProperty('resume');
    expect(putObject).not.toHaveBeenCalled();
  });

  it('refuses other real formats, e.g. a PNG', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
    expect((await upload(png, 'cv.png')).status).toBe(415);
  });

  it('refuses a file over 5 MB with 413 before storing anything', async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]);

    const res = await upload(big, 'big.pdf');

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(putObject).not.toHaveBeenCalled();
  });

  it('asks for a file when none is sent', async () => {
    const res = await request(app).post('/api/v1/students/me/resume').set('Authorization', student);

    expect(res.status).toBe(422);
    expect(res.body.error.fields).toHaveProperty('resume');
  });

  it('needs a saved profile first', async () => {
    profile = null;

    const res = await upload(PDF, 'cv.pdf');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROFILE_REQUIRED');
  });

  it('replaces the previous resume and deletes the old object', async () => {
    profile.resume = { id: 4, bucket: 'resumes', objectKey: 'students/7/old.pdf' };

    expect((await upload(PDF, 'new.pdf')).status).toBe(201);
    expect(deleteObject).toHaveBeenCalledWith({ bucket: 'resumes', key: 'students/7/old.pdf' });
    expect(StoredFile.destroy).toHaveBeenCalledWith({ where: { id: 4 } });
  });

  it('removes the uploaded object again if the database write fails', async () => {
    StoredFile.create.mockRejectedValue(new Error('db down'));

    const res = await upload(PDF, 'cv.pdf');

    expect(res.status).toBe(500);
    expect(deleteObject).toHaveBeenCalledWith({ bucket: 'resumes', key: putObject.mock.calls[0][0].key });
  });

  it('keeps only a safe file name: no path, no quotes, the real extension', async () => {
    await upload(PDF, 'evil"name.exe');

    expect(StoredFile.create.mock.calls[0][0].originalName).toBe('evilname.pdf');
  });

  it('keeps non-English file names intact', async () => {
    await upload(PDF, 'Wanjiku Müller CV.pdf');

    expect(StoredFile.create.mock.calls[0][0].originalName).toBe('Wanjiku Müller CV.pdf');
  });

  it('is for students only', async () => {
    const res = await request(app)
      .post('/api/v1/students/me/resume')
      .set('Authorization', asRole('company_rep'))
      .attach('resume', PDF, 'cv.pdf');

    expect(res.status).toBe(403);
  });
});

describe('GET and DELETE /api/v1/students/me/resume (US-02)', () => {
  const resume = { id: 4, bucket: 'resumes', objectKey: 'students/7/a.pdf', originalName: 'CV.pdf', mime: 'application/pdf', size: 1234 };

  it('returns a 5-minute download link', async () => {
    StudentProfile.findByPk.mockResolvedValue({ userId: 7, resume });
    presignDownload.mockResolvedValue('https://storage.example/signed');

    const res = await request(app).get('/api/v1/students/me/resume').set('Authorization', student);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ url: 'https://storage.example/signed', fileName: 'CV.pdf', size: 1234 });
    expect(new Date(res.body.expiresAt) - Date.now()).toBeGreaterThan(290_000);
    expect(presignDownload).toHaveBeenCalledWith({
      bucket: 'resumes',
      key: 'students/7/a.pdf',
      downloadName: 'CV.pdf',
      contentType: 'application/pdf',
    });
  });

  it('returns 404 when there is no resume', async () => {
    StudentProfile.findByPk.mockResolvedValue({ userId: 7, resume: null });

    const res = await request(app).get('/api/v1/students/me/resume').set('Authorization', student);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RESUME_NOT_FOUND');
  });

  it('deletes the resume: unlinks it, then removes the object and its row', async () => {
    const profile = { userId: 7, resume, update: vi.fn() };
    StudentProfile.findByPk.mockResolvedValue(profile);

    const res = await request(app).delete('/api/v1/students/me/resume').set('Authorization', student);

    expect(res.status).toBe(204);
    expect(profile.update).toHaveBeenCalledWith({ resumeFileId: null });
    expect(deleteObject).toHaveBeenCalledWith({ bucket: 'resumes', key: 'students/7/a.pdf' });
    expect(StoredFile.destroy).toHaveBeenCalledWith({ where: { id: 4 } });
  });
});
