import { createHash, randomBytes } from 'node:crypto';
import { UniqueConstraintError } from 'sequelize';
import { config } from '../../config/index.js';
import { AppError } from '../../lib/errors.js';
import { emit } from '../../lib/events.js';
import logger from '../../lib/logger.js';
import { todayISO } from '../../lib/dates.js';
import { deleteObject, presignDownload, putObject, DOWNLOAD_URL_TTL_SECONDS } from '../../integrations/storage.js';
import { renderCertificate } from '../../integrations/pdf.js';
import { enqueueCertificate } from '../../jobs/queues.js';
import {
  sequelize,
  User,
  Company,
  CompanyMember,
  Posting,
  StudentProfile,
  Skill,
  StoredFile,
  Application,
  Internship,
  SupervisorAssignment,
  Evaluation,
  Certificate,
} from '../../db/models/index.js';
import { companyFor } from '../companies/service.js';
import { skillNames } from '../skills/service.js';
import { record } from '../audit/service.js';

// US-09..US-10. Who may see an internship (ARCHITECTURE.md §4.4):
//   the intern ('student'), a rep of the company ('company'), its active supervisor ('supervisor')
//   and admins. Anyone else gets 404, so ids can't be probed.

const notFound = () => new AppError(404, 'INTERNSHIP_NOT_FOUND', 'Internship not found');
const notOngoing = () => new AppError(409, 'INTERNSHIP_COMPLETED', 'This internship is already completed');

// A function, not a constant: the models are only touched when a request needs them.
const details = ({ withSkills = false } = {}) => [
  {
    model: Application,
    as: 'application',
    attributes: ['id', 'studentId', 'postingId'],
    include: [
      {
        model: Posting,
        as: 'posting',
        attributes: ['id', 'title', 'location', 'companyId', 'durationWeeks'],
        include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }],
      },
      {
        model: StudentProfile,
        as: 'profile',
        attributes: ['userId', 'fullName', 'university', 'department', 'gpa', 'resumeFileId'],
        ...(withSkills && { include: [{ model: Skill, as: 'skills', through: { attributes: [] } }] }),
      },
      { model: User, as: 'student', attributes: ['id', 'email'] },
    ],
  },
  {
    model: SupervisorAssignment,
    as: 'activeAssignment',
    required: false,
    include: [
      {
        model: User,
        as: 'supervisor',
        attributes: ['id', 'email'],
        include: [{ model: CompanyMember, as: 'membership', attributes: ['fullName'] }],
      },
    ],
  },
  { model: Certificate, as: 'certificate', attributes: ['id', 'serialNo', 'issuedAt'], required: false },
];

function serialize(internship, role) {
  const { application } = internship;
  const { posting, profile, student } = application;
  const supervisor = internship.activeAssignment?.supervisor;
  return {
    id: internship.id,
    status: internship.status,
    startDate: internship.startDate,
    endDate: internship.endDate,
    completedAt: internship.completedAt,
    certificate: internship.certificate ? { serialNo: internship.certificate.serialNo, issuedAt: internship.certificate.issuedAt } : null,
    applicationId: application.id,
    posting: { id: posting.id, title: posting.title, location: posting.location },
    company: { id: posting.company.id, name: posting.company.name },
    student: {
      id: student?.id ?? application.studentId,
      email: student?.email,
      fullName: profile?.fullName ?? null,
      university: profile?.university ?? null,
      department: profile?.department ?? null,
      // The supervisor's and company's view of the student's record (US-09).
      ...(role !== 'student' && {
        gpa: profile?.gpa ?? null,
        skills: skillNames(profile?.skills),
        hasResume: Boolean(profile?.resumeFileId),
      }),
    },
    supervisor: supervisor
      ? { id: supervisor.id, email: supervisor.email, fullName: supervisor.membership?.fullName ?? null, assignedAt: internship.activeAssignment.assignedAt }
      : null,
    viewerRole: role,
  };
}

async function viewerRole(internship, viewer) {
  const { application } = internship;
  if (viewer.role === 'admin') return 'admin';
  if (viewer.role === 'student' && application.studentId === viewer.id) return 'student';
  if (viewer.role === 'supervisor' && internship.activeAssignment?.supervisorUserId === viewer.id) return 'supervisor';
  if (viewer.role === 'company_rep') {
    const membership = await companyFor(viewer.id);
    if (membership?.companyId === application.posting.companyId) return 'company';
  }
  throw notFound();
}

async function load(internshipId, viewer, options) {
  const internship = await Internship.findByPk(internshipId, { include: details(options) });
  if (!internship) throw notFound();
  return { internship, role: await viewerRole(internship, viewer) };
}

export async function getInternship(internshipId, viewer) {
  const { internship, role } = await load(internshipId, viewer, { withSkills: true });
  return serialize(internship, role);
}

// The viewer's internships: a student's own, a company's, or a supervisor's current interns.
export async function listInternships(viewer, { status, page, limit }) {
  const include = details();
  const [applicationInclude, assignmentInclude] = include;
  const role = { student: 'student', company_rep: 'company', supervisor: 'supervisor', admin: 'admin' }[viewer.role];

  if (role === 'student') {
    applicationInclude.where = { studentId: viewer.id };
    applicationInclude.required = true;
  } else if (role === 'company') {
    const membership = await companyFor(viewer.id);
    if (!membership) return { items: [], page, limit, total: 0 };
    applicationInclude.required = true;
    applicationInclude.include[0].where = { companyId: membership.companyId };
    applicationInclude.include[0].required = true;
  } else if (role === 'supervisor') {
    assignmentInclude.where = { supervisorUserId: viewer.id };
    assignmentInclude.required = true;
  }

  const { rows, count } = await Internship.findAndCountAll({
    where: status ? { status } : {},
    include,
    order: [['startDate', 'DESC'], ['id', 'DESC']],
    limit,
    offset: (page - 1) * limit,
    distinct: true,
  });
  return { items: rows.map((i) => serialize(i, role)), page, limit, total: count };
}

async function loadForCompany(repId, internshipId) {
  const { internship, role } = await load(internshipId, { id: repId, role: 'company_rep' });
  if (role !== 'company') throw notFound();
  return internship;
}

// The rep adjusts the dates agreed with the intern (they decide when a certificate can be issued).
export async function updateDates(repId, internshipId, { startDate, endDate }) {
  const internship = await loadForCompany(repId, internshipId);
  if (internship.status !== 'ongoing') throw notOngoing();
  if (endDate < startDate) {
    throw new AppError(422, 'VALIDATION_ERROR', 'The end date must be on or after the start date', { endDate: 'Must be on or after the start date' });
  }
  await internship.update({ startDate, endDate });
  return serialize(internship, 'company');
}

// US-09: the rep picks a supervisor from the company's staff. Ending the current assignment and
// starting the new one happen in one transaction; the UNIQUE active_key makes a second active
// assignment impossible even if two requests race.
export async function assignSupervisor(repId, internshipId, { supervisorId }, { ip }) {
  const internship = await loadForCompany(repId, internshipId);
  if (internship.status !== 'ongoing') throw notOngoing();
  const companyId = internship.application.posting.companyId;

  const member = await CompanyMember.findOne({
    where: { companyId, userId: supervisorId, memberRole: 'supervisor' },
    include: [{ model: User, as: 'user', attributes: ['id', 'email', 'status'] }],
  });
  if (!member?.user) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Choose a supervisor from your staff list', { supervisorId: 'Not a supervisor in your company' });
  }
  if (member.user.status === 'suspended') {
    throw new AppError(422, 'VALIDATION_ERROR', 'This supervisor is suspended', { supervisorId: 'Suspended' });
  }
  if (internship.activeAssignment?.supervisorUserId === supervisorId) {
    throw new AppError(409, 'ALREADY_ASSIGNED', 'This supervisor is already assigned to this intern');
  }

  const now = new Date();
  try {
    await sequelize.transaction(async (transaction) => {
      await SupervisorAssignment.update({ active: false, endedAt: now }, { where: { internshipId: internship.id, active: true }, transaction });
      await SupervisorAssignment.create(
        { internshipId: internship.id, supervisorUserId: supervisorId, assignedBy: repId, active: true, assignedAt: now },
        { transaction },
      );
      const rep = await User.findByPk(repId, { attributes: ['id', 'role'], transaction });
      await record(
        { actor: rep, action: 'company.supervisor_assigned', entity: { type: 'internship', id: internship.id }, ip, metadata: { supervisorId } },
        { transaction },
      );
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new AppError(409, 'APPLICATION_CHANGED', 'The supervisor was just changed by someone else. Reload and try again');
    }
    throw err;
  }

  const updated = await getInternship(internship.id, { id: repId, role: 'company_rep' });
  await emit('supervisor.assigned', { internship: updated, supervisor: { id: member.user.id, email: member.user.email, fullName: member.fullName } });
  return updated;
}

// --- Evaluations (US-10) ---

function serializeEvaluation(e) {
  return {
    id: e.id,
    period: e.period,
    rating: e.rating,
    comments: e.comments,
    attendance: e.attendance,
    isFinal: e.isFinal,
    createdAt: e.createdAt,
    supervisor: e.supervisor ? { id: e.supervisor.id, fullName: e.supervisor.membership?.fullName ?? null } : null,
  };
}

const withSupervisorName = () => [
  {
    model: User,
    as: 'supervisor',
    attributes: ['id'],
    include: [{ model: CompanyMember, as: 'membership', attributes: ['fullName'] }],
  },
];

// The intern (read-only), the company, the active supervisor and admins can read them.
export async function listEvaluations(internshipId, viewer) {
  await load(internshipId, viewer);
  const rows = await Evaluation.findAll({
    where: { internshipId },
    include: withSupervisorName(),
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
  });
  return rows.map(serializeEvaluation);
}

// Only the intern's active supervisor, while the internship is ongoing. Saved evaluations are
// timestamped and never change (the model refuses updates and deletes).
export async function createEvaluation(internshipId, viewer, { period, rating, comments, attendance, isFinal }) {
  const { internship, role } = await load(internshipId, viewer);
  if (role !== 'supervisor') {
    throw new AppError(403, 'NOT_THE_SUPERVISOR', "Only the intern's current supervisor can add evaluations");
  }
  if (internship.status !== 'ongoing') throw notOngoing();

  const created = await Evaluation.create({ internshipId: internship.id, supervisorId: viewer.id, period, rating, comments, attendance, isFinal });
  const serialized = serializeEvaluation(await Evaluation.findByPk(created.id, { include: withSupervisorName() }));
  await emit('evaluation.submitted', { internship: serialize(internship, 'supervisor'), evaluation: serialized });
  return serialized;
}

// A 5-minute link to the intern's resume, for the company and the active supervisor (US-09).
export async function getInternResume(internshipId, viewer) {
  const { internship, role } = await load(internshipId, viewer);
  if (role === 'student') throw notFound();
  const profile = await StudentProfile.findByPk(internship.application.studentId, { include: [{ model: StoredFile, as: 'resume' }] });
  const resume = profile?.resume;
  if (!resume) throw new AppError(404, 'RESUME_NOT_FOUND', 'This intern has not uploaded a resume');
  return {
    url: await presignDownload({ bucket: resume.bucket, key: resume.objectKey, downloadName: resume.originalName, contentType: resume.mime }),
    expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000),
    fileName: resume.originalName,
  };
}

// --- Completion and certificate (US-11) ---

// The supervisor (or an admin) confirms completion once the end date has passed and a final
// evaluation exists; otherwise the request is refused with what is missing. The PDF itself is
// made by the `certificate.generate` job, so this answers at once.
export async function completeInternship(internshipId, viewer, { ip }) {
  const { internship, role } = await load(internshipId, viewer);
  if (role !== 'supervisor' && role !== 'admin') {
    throw new AppError(403, 'NOT_THE_SUPERVISOR', "Only the intern's supervisor or an admin can confirm completion");
  }
  if (internship.status !== 'ongoing') throw notOngoing();

  const missing = {};
  if (internship.endDate >= todayISO()) {
    missing.endDate = `The internship ends on ${internship.endDate}; it can be completed after that day`;
  }
  const finals = await Evaluation.count({ where: { internshipId: internship.id, isFinal: true } });
  if (finals === 0) missing.finalEvaluation = 'Submit a final evaluation first';
  if (Object.keys(missing).length) {
    throw new AppError(422, 'CERTIFICATE_NOT_READY', `The certificate can't be issued yet: ${Object.values(missing).join('; ')}`, missing);
  }

  const now = new Date();
  await sequelize.transaction(async (transaction) => {
    const [done] = await Internship.update(
      { status: 'completed', completedAt: now, completedBy: viewer.id },
      { where: { id: internship.id, status: 'ongoing' }, transaction },
    );
    if (done === 0) throw notOngoing();
    const actor = await User.findByPk(viewer.id, { attributes: ['id', 'role'], transaction });
    await record({ actor, action: 'internship.completed', entity: { type: 'internship', id: internship.id }, ip }, { transaction });
  });

  // If the queue is down, the maintenance sweep issues it later (issueMissingCertificates).
  try {
    await enqueueCertificate(internship.id);
  } catch (err) {
    logger.warn({ err: err.message, internshipId: internship.id }, 'Could not queue the certificate; the sweep will issue it');
  }
  return getInternship(internship.id, viewer);
}

const serialFor = (internshipId, issuedAt) =>
  `CERT-${issuedAt.getUTCFullYear()}-${String(internshipId).padStart(6, '0')}-${randomBytes(3).toString('hex').toUpperCase()}`;

// The `certificate.generate` job (worker). Idempotent: an internship that already has a
// certificate is left alone, so a retry or the sweep can run it again safely.
export async function generateCertificate(internshipId) {
  if (await Certificate.findOne({ where: { internshipId } })) return null;
  const internship = await Internship.findByPk(internshipId, { include: details() });
  if (!internship || internship.status !== 'completed') return null;

  const view = serialize(internship, 'admin');
  const issuedAt = new Date();
  const serialNo = serialFor(internship.id, issuedAt);
  const pdf = await renderCertificate({
    serialNo,
    studentName: view.student.fullName ?? view.student.email,
    postingTitle: view.posting.title,
    companyName: view.company.name,
    startDate: internship.startDate,
    endDate: internship.endDate,
    supervisorName: view.supervisor?.fullName,
    issuedAt,
  });

  const bucket = config.s3.buckets.certificates;
  const key = `internships/${internship.id}/${serialNo}.pdf`;
  await putObject({ bucket, key, body: pdf, contentType: 'application/pdf' });
  let certificate;
  try {
    certificate = await sequelize.transaction(async (transaction) => {
      const file = await StoredFile.create(
        {
          ownerUserId: view.student.id,
          bucket,
          objectKey: key,
          originalName: `Certificate ${serialNo}.pdf`,
          mime: 'application/pdf',
          size: pdf.length,
          checksum: createHash('sha256').update(pdf).digest('hex'),
        },
        { transaction },
      );
      return Certificate.create({ internshipId: internship.id, fileId: file.id, serialNo, issuedAt }, { transaction });
    });
  } catch (err) {
    // Another run issued it first (UNIQUE internship_id): keep theirs, drop this PDF.
    await deleteObject({ bucket, key }).catch(() => {});
    if (err instanceof UniqueConstraintError) return null;
    throw err;
  }

  await emit('certificate.issued', { internship: view, certificate: { serialNo, issuedAt } });
  return certificate;
}

// Maintenance sweep: completed internships whose certificate job never ran (queue down, crash).
export async function issueMissingCertificates() {
  const completed = await Internship.findAll({
    where: { status: 'completed' },
    attributes: ['id'],
    include: [{ model: Certificate, as: 'certificate', attributes: ['id'], required: false }],
  });
  let issued = 0;
  for (const { id } of completed.filter((i) => !i.certificate)) {
    if (await generateCertificate(id)) issued += 1;
  }
  return issued;
}

// US-11: the intern, the company, the supervisor and admins can download it (5-minute link).
export async function getCertificateDownload(internshipId, viewer) {
  const { internship } = await load(internshipId, viewer);
  const certificate = await Certificate.findOne({
    where: { internshipId: internship.id },
    include: [{ model: StoredFile, as: 'file' }],
  });
  if (!certificate) {
    throw internship.status === 'completed'
      ? new AppError(404, 'CERTIFICATE_PENDING', 'The certificate is being prepared. Try again in a minute')
      : new AppError(404, 'CERTIFICATE_NOT_ISSUED', 'No certificate yet: the internship is not completed');
  }
  return {
    url: await presignDownload({
      bucket: certificate.file.bucket,
      key: certificate.file.objectKey,
      downloadName: certificate.file.originalName,
      contentType: 'application/pdf',
    }),
    expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000),
    serialNo: certificate.serialNo,
    issuedAt: certificate.issuedAt,
  };
}

