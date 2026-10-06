import { Op, UniqueConstraintError } from 'sequelize';
import { AppError } from '../../lib/errors.js';
import { emit } from '../../lib/events.js';
import { addDays, todayISO } from '../../lib/dates.js';
import { presignDownload, DOWNLOAD_URL_TTL_SECONDS } from '../../integrations/storage.js';
import {
  sequelize,
  User,
  Company,
  Posting,
  StudentProfile,
  Skill,
  StoredFile,
  Application,
  ApplicationStatusHistory,
  Internship,
} from '../../db/models/index.js';
import { companyFor } from '../companies/service.js';
import { completeness } from '../students/service.js';
import { skillNames, uniqueSkillNames } from '../skills/service.js';

// The one transition table (ARCHITECTURE.md §5.1): from -> { to: who may make that move }.
// It drives the guards below and the `allowedActions` every response carries, so the client
// can disable Withdraw once an application is Accepted or Rejected (US-08).
export const TRANSITIONS = {
  applied: { shortlisted: 'company', interviewed: 'company', rejected: 'company', withdrawn: 'student' },
  shortlisted: { interviewed: 'company', rejected: 'company', withdrawn: 'student' },
  interviewed: { accepted: 'company', rejected: 'company' },
  accepted: {},
  rejected: {},
  withdrawn: {},
};

// The moves `actor` ('student' or 'company') may make from `status`.
export function allowedActions(status, actor) {
  return Object.entries(TRANSITIONS[status] ?? {})
    .filter(([, who]) => who === actor)
    .map(([to]) => (to === 'withdrawn' ? 'withdraw' : to));
}

const notFound = () => new AppError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
const postingSummary = (posting) => ({
  id: posting.id,
  title: posting.title,
  location: posting.location,
  status: posting.status,
  deadline: posting.deadline,
  company: posting.company ? { id: posting.company.id, name: posting.company.name } : undefined,
});
const withPosting = () => ({
  model: Posting,
  as: 'posting',
  include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }],
});

function studentSummary(profile, email) {
  return {
    id: profile?.userId,
    email,
    fullName: profile?.fullName ?? null,
    university: profile?.university ?? null,
    department: profile?.department ?? null,
    gpa: profile?.gpa ?? null,
    skills: skillNames(profile?.skills),
    hasResume: Boolean(profile?.resumeFileId),
  };
}

function serialize(application, actor) {
  return {
    id: application.id,
    status: application.status,
    coverLetter: application.coverLetter,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    posting: application.posting ? postingSummary(application.posting) : undefined,
    allowedActions: allowedActions(application.status, actor),
  };
}

// Who is looking: the applicant ('student'), a rep of the posting's company ('company'),
// or nobody allowed, which is reported as not found (ARCHITECTURE.md §4.4).
async function viewerRole(application, viewer) {
  if (viewer.role === 'student' && application.studentId === viewer.id) return 'student';
  if (viewer.role === 'company_rep') {
    const membership = await companyFor(viewer.id);
    if (membership && membership.companyId === application.posting.companyId) return 'company';
  }
  throw notFound();
}

// --- Student side (US-03, US-07, US-08) ---

// US-03: the student must be verified (route: requireVerified) and have a complete profile;
// the posting must be open. UNIQUE(posting_id, student_id) rules out a second application.
export async function apply(studentId, postingId, { coverLetter }) {
  const posting = await Posting.findByPk(postingId, { include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }] });
  if (!posting || posting.status === 'draft') throw new AppError(404, 'POSTING_NOT_FOUND', 'Posting not found');
  // The deadline is checked here too, so nothing gets in between auto-close runs (US-05).
  if (posting.status !== 'active' || posting.deadline <= new Date()) {
    throw new AppError(409, 'POSTING_CLOSED', 'This posting is closed and no longer accepts applications');
  }

  const { complete, missing } = completeness(await StudentProfile.findByPk(studentId));
  if (!complete) {
    throw new AppError(422, 'PROFILE_INCOMPLETE', 'Complete your profile (full name, university and department) before applying', Object.fromEntries(missing.map((f) => [f, 'Required before applying'])));
  }

  let application;
  try {
    application = await sequelize.transaction(async (transaction) => {
      const created = await Application.create({ postingId, studentId, status: 'applied', coverLetter }, { transaction });
      await ApplicationStatusHistory.create(
        { applicationId: created.id, fromStatus: null, toStatus: 'applied', changedBy: studentId },
        { transaction },
      );
      return created;
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new AppError(409, 'ALREADY_APPLIED', 'You have already applied to this posting');
    }
    throw err;
  }

  application.posting = posting;
  const student = await User.findByPk(studentId, { attributes: ['id', 'email'] });
  await emit('application.created', { application, posting, student });
  return serialize(application, 'student');
}

export async function listMine(studentId, { status, page, limit }) {
  const { rows, count } = await Application.findAndCountAll({
    where: { studentId, ...(status && { status }) },
    include: [withPosting()],
    order: [['createdAt', 'DESC']],
    limit,
    offset: (page - 1) * limit,
  });
  return { items: rows.map((a) => serialize(a, 'student')), page, limit, total: count };
}

// One application with its history. Students see their own; reps see their company's,
// with the applicant's profile summary.
export async function getApplication(applicationId, viewer) {
  const application = await Application.findByPk(applicationId, {
    include: [
      withPosting(),
      {
        model: StudentProfile,
        as: 'profile',
        include: [{ model: Skill, as: 'skills', through: { attributes: [] } }],
      },
      { model: User, as: 'student', attributes: ['id', 'email'] },
      { model: ApplicationStatusHistory, as: 'history' },
    ],
    order: [[{ model: ApplicationStatusHistory, as: 'history' }, 'createdAt', 'ASC']],
  });
  if (!application) throw notFound();
  const actor = await viewerRole(application, viewer);

  return {
    ...serialize(application, actor),
    history: (application.history ?? []).map((h) => ({ from: h.fromStatus, to: h.toStatus, at: h.createdAt, note: h.note })),
    ...(actor === 'company' && { student: studentSummary(application.profile, application.student?.email) }),
  };
}

// US-08: only from Applied or Shortlisted; the company's reps are told.
export async function withdraw(studentId, applicationId) {
  const application = await Application.findByPk(applicationId, { include: [withPosting()] });
  if (!application || application.studentId !== studentId) throw notFound();

  const from = application.status;
  if (TRANSITIONS[from]?.withdrawn !== 'student') {
    throw new AppError(409, 'WITHDRAW_NOT_ALLOWED', `An application that is ${from} can no longer be withdrawn`);
  }
  await moveStatus(application, from, 'withdrawn', { changedBy: studentId });

  const profile = await StudentProfile.findByPk(studentId, { attributes: ['fullName'] });
  await emit('application.withdrawn', {
    application,
    posting: application.posting,
    studentName: profile?.fullName ?? 'A student',
  });
  return serialize(application, 'student');
}

// --- Company side (US-06, US-07) ---

// Writes the change and its history row. The update only applies while the status is still
// `from`, so two people acting at once can't both move it.
// `within(transaction)` adds work that must commit or roll back with the change.
async function moveStatus(application, from, to, { changedBy, note, within }) {
  await sequelize.transaction(async (transaction) => {
    const [moved] = await Application.update({ status: to }, { where: { id: application.id, status: from }, transaction });
    if (moved === 0) {
      throw new AppError(409, 'APPLICATION_CHANGED', 'This application was just updated by someone else. Reload it and try again');
    }
    await ApplicationStatusHistory.create(
      { applicationId: application.id, fromStatus: from, toStatus: to, changedBy, note: note ?? null },
      { transaction },
    );
    if (within) await within(transaction);
  });
  application.status = to;
}

async function loadForCompany(repId, applicationId) {
  const application = await Application.findByPk(applicationId, { include: [withPosting()] });
  if (!application) throw notFound();
  const membership = await companyFor(repId);
  if (!membership || membership.companyId !== application.posting.companyId) throw notFound();
  return application;
}

// US-06: Shortlisted, Interviewed, Accepted or Rejected, following the transition table;
// the student is notified (US-07).
// US-09: accepting creates the internship. It starts on `startDate` (default today) and runs for the
// posting's duration; the rep can adjust both dates later (internships/service.js).
function createInternship(application, startDate) {
  return (transaction) => {
    const start = startDate ?? todayISO();
    const endDate = addDays(start, application.posting.durationWeeks * 7 - 1);
    return Internship.create({ applicationId: application.id, startDate: start, endDate, status: 'ongoing' }, { transaction });
  };
}

export async function changeStatus(repId, applicationId, { status: to, note, startDate }) {
  const application = await loadForCompany(repId, applicationId);
  const from = application.status;
  if (TRANSITIONS[from]?.[to] !== 'company') {
    throw new AppError(409, 'INVALID_TRANSITION', `An application that is ${from} cannot be moved to ${to}`, {
      status: `Allowed next: ${allowedActions(from, 'company').join(', ') || 'none'}`,
    });
  }
  await moveStatus(application, from, to, {
    changedBy: repId,
    note,
    within: to === 'accepted' ? createInternship(application, startDate) : undefined,
  });

  const student = await User.findByPk(application.studentId, { attributes: ['id', 'email'] });
  await emit('application.statusChanged', { application, posting: application.posting, student, from, to });
  return serialize(application, 'company');
}

// US-06: a posting's applicants with profile summaries, filtered by skills (all of them),
// university (contains) and minimum GPA.
export async function listForPosting(repId, postingId, { status, skills, university, minGpa, page, limit }) {
  const posting = await Posting.findByPk(postingId);
  const membership = await companyFor(repId);
  if (!posting || !membership || posting.companyId !== membership.companyId) {
    throw new AppError(404, 'POSTING_NOT_FOUND', 'Posting not found');
  }

  const where = { postingId, ...(status && { status }) };
  const wanted = uniqueSkillNames(skills);
  if (wanted.length) {
    // Students who list every requested skill. Skill names compare case-insensitively.
    where[Op.and] = [
      sequelize.literal(
        `\`Application\`.\`student_id\` IN (SELECT ss.user_id FROM student_skills ss JOIN skills s ON s.id = ss.skill_id ` +
          `WHERE s.name IN (${wanted.map((s) => sequelize.escape(s)).join(', ')}) ` +
          `GROUP BY ss.user_id HAVING COUNT(DISTINCT s.id) = ${wanted.length})`,
      ),
    ];
  }
  const profileWhere = {
    ...(university && { university: { [Op.like]: `%${university.replace(/[\\%_]/g, '\\$&')}%` } }),
    ...(minGpa !== undefined && { gpa: { [Op.gte]: minGpa } }),
  };
  const filtersProfile = Object.keys(profileWhere).length > 0;

  // Page through ids first (single-row joins only, so no subquery), then load the details.
  const { rows: matches, count } = await Application.findAndCountAll({
    where,
    attributes: ['id'],
    include: filtersProfile ? [{ model: StudentProfile, as: 'profile', attributes: [], where: profileWhere, required: true }] : [],
    order: [['createdAt', 'ASC']],
    limit,
    offset: (page - 1) * limit,
  });
  const ids = matches.map((a) => a.id);
  const loaded = ids.length
    ? await Application.findAll({
        where: { id: { [Op.in]: ids } },
        include: [
          { model: StudentProfile, as: 'profile', include: [{ model: Skill, as: 'skills', through: { attributes: [] } }] },
          { model: User, as: 'student', attributes: ['id', 'email'] },
        ],
      })
    : [];
  const byId = new Map(loaded.map((a) => [a.id, a]));

  return {
    items: ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((a) => ({
        ...serialize(a, 'company'),
        student: studentSummary(a.profile, a.student?.email),
      })),
    page,
    limit,
    total: count,
  };
}

// A 5-minute link to an applicant's resume, for a rep of the posting's company.
export async function getApplicantResume(repId, applicationId) {
  const application = await loadForCompany(repId, applicationId);
  const profile = await StudentProfile.findByPk(application.studentId, { include: [{ model: StoredFile, as: 'resume' }] });
  const resume = profile?.resume;
  if (!resume) throw new AppError(404, 'RESUME_NOT_FOUND', 'This applicant has not uploaded a resume');

  return {
    url: await presignDownload({ bucket: resume.bucket, key: resume.objectKey, downloadName: resume.originalName, contentType: resume.mime }),
    expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000),
    fileName: resume.originalName,
    mime: resume.mime,
    size: resume.size,
  };
}
