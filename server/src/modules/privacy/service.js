import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { config } from '../../config/index.js';
import { AppError } from '../../lib/errors.js';
import logger from '../../lib/logger.js';
import { disconnectUser } from '../../lib/realtime.js';
import { deleteObject } from '../../integrations/storage.js';
import { enqueueEmail } from '../../jobs/queues.js';
import { invalidateUserStatus } from '../../middleware/auth.js';
import {
  sequelize,
  User,
  RefreshToken,
  EmailVerificationToken,
  AccountInvite,
  StudentProfile,
  Skill,
  StoredFile,
  Company,
  CompanyMember,
  Posting,
  Application,
  ApplicationStatusHistory,
  Internship,
  SupervisorAssignment,
  Evaluation,
  Certificate,
  Notification,
  AuditLog,
} from '../../db/models/index.js';
import { record } from '../audit/service.js';

// Data protection (Kenya Data Protection Act 2019, GDPR): the right of access (export), the right to
// erasure (anonymisation) and storage limitation (the retention rules below).

const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION = {
  inactiveAccountDays: 365, // no sign-in for a year: anonymised
  warningDaysBefore: 30, // emailed this long before
  inactiveResumeDays: 182, // a student's resume after ~6 months without sign-in
  auditLogDays: 365,
  unverifiedAccountDays: 30, // password accounts that never confirmed their email
};
export const DELETED_NAME = 'Deleted user';

// --- Erasure ---

// Wipes a person's data but keeps the rows other people's records point at (applications,
// internships, evaluations, audit log), which then read "Deleted user". The account can never
// sign in again, and its email is freed for a new registration. Idempotent.
export async function anonymiseUser(userId, { actor = null, reason = null, ip = null, source }) {
  const user = await User.findByPk(userId, { paranoid: false });
  if (!user || user.anonymisedAt) return false;

  const files = await StoredFile.findAll({ where: { ownerUserId: user.id } });
  const certificateIds = (
    await Certificate.findAll({
      attributes: ['id'],
      include: [
        {
          model: Internship,
          as: 'internship',
          attributes: [],
          required: true,
          include: [{ model: Application, as: 'application', attributes: [], required: true, where: { studentId: user.id } }],
        },
      ],
    })
  ).map((c) => c.id);
  const now = new Date();

  await sequelize.transaction(async (transaction) => {
    await user.update(
      {
        email: `deleted-${user.id}@deleted.invalid`,
        displayName: null,
        phoneE164: null,
        passwordHash: null,
        googleId: null,
        status: 'suspended',
        anonymisedAt: now,
        retentionWarnedAt: null,
      },
      { transaction },
    );
    const profile = await StudentProfile.findByPk(user.id, { transaction });
    if (profile) {
      await profile.update({ fullName: DELETED_NAME, university: '', department: '', gpa: null, bio: null, resumeFileId: null }, { transaction });
      await profile.setSkills([], { transaction });
    }
    await CompanyMember.update({ fullName: DELETED_NAME }, { where: { userId: user.id }, transaction });
    // Free text the person wrote; the application itself stays in the company's history.
    await Application.update({ coverLetter: null }, { where: { studentId: user.id }, transaction });
    // Certificates carry the name: removed with their PDF (rows first, files are RESTRICT).
    if (certificateIds.length) await Certificate.destroy({ where: { id: certificateIds }, transaction });
    if (files.length) await StoredFile.destroy({ where: { id: files.map((f) => f.id) }, transaction });
    await Notification.destroy({ where: { userId: user.id }, transaction });
    await RefreshToken.destroy({ where: { userId: user.id }, transaction });
    await EmailVerificationToken.destroy({ where: { userId: user.id }, transaction });
    await AccountInvite.destroy({ where: { userId: user.id }, transaction });
    // A supervisor who leaves no longer holds interns; the company can assign someone else.
    await SupervisorAssignment.update({ active: false, endedAt: now }, { where: { supervisorUserId: user.id, active: true }, transaction });
    await record(
      { actor, action: 'account.anonymised', entity: { type: 'user', id: user.id }, ip, metadata: { source, ...(reason && { reason }) } },
      { transaction },
    );
    if (!user.deletedAt) await user.destroy({ transaction });
  });

  // Objects go after the commit: at worst an orphaned private object, never a dangling row.
  for (const file of files) {
    await deleteObject({ bucket: file.bucket, key: file.objectKey }).catch((err) =>
      logger.warn({ err: err.message, fileId: file.id }, 'Could not delete a stored file of an erased account'),
    );
  }
  await invalidateUserStatus(user.id);
  disconnectUser(user.id);
  return true;
}

// The user's own "Delete my account". A password account confirms with its password; a Google
// account (no password) by typing its email address.
export async function deleteOwnAccount(userId, { password, confirmEmail }, { ip }) {
  const user = await User.findByPk(userId);
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Account no longer exists');
  if (user.role === 'admin') {
    throw new AppError(409, 'ADMIN_ACCOUNT', 'Admin accounts cannot delete themselves; ask another admin');
  }
  if (user.passwordHash) {
    if (!password || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new AppError(422, 'VALIDATION_ERROR', 'The password is not correct', { password: 'Incorrect password' });
    }
  } else if ((confirmEmail ?? '').trim().toLowerCase() !== user.email) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Type your email address to confirm', { confirmEmail: 'Does not match your email address' });
  }
  await anonymiseUser(user.id, { actor: user, ip, source: 'self' });
}

// --- Access (export) ---

// Everything held about the user, as one JSON document they can download (right of access).
export async function exportUserData(userId, { ip }) {
  const user = await User.findByPk(userId);
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Account no longer exists');

  const [profile, membership, applications, internships, written, notifications, activity] = await Promise.all([
    StudentProfile.findByPk(user.id, { include: [{ model: Skill, as: 'skills', through: { attributes: [] } }, { model: StoredFile, as: 'resume' }] }),
    CompanyMember.findOne({ where: { userId: user.id }, include: [{ model: Company, as: 'company', attributes: ['name', 'regNumber', 'status'] }] }),
    Application.findAll({
      where: { studentId: user.id },
      include: [
        { model: Posting, as: 'posting', attributes: ['title'], include: [{ model: Company, as: 'company', attributes: ['name'] }] },
        { model: ApplicationStatusHistory, as: 'history', attributes: ['fromStatus', 'toStatus', 'note', 'createdAt'] },
      ],
      order: [['createdAt', 'ASC']],
    }),
    Internship.findAll({
      include: [
        { model: Application, as: 'application', attributes: ['id'], required: true, where: { studentId: user.id } },
        { model: Evaluation, as: 'evaluations', attributes: ['period', 'rating', 'comments', 'attendance', 'isFinal', 'createdAt'] },
        { model: Certificate, as: 'certificate', attributes: ['serialNo', 'issuedAt'] },
      ],
    }),
    Evaluation.findAll({ where: { supervisorId: user.id }, attributes: ['internshipId', 'period', 'rating', 'comments', 'attendance', 'isFinal', 'createdAt'] }),
    Notification.findAll({ where: { userId: user.id }, attributes: ['type', 'payload', 'readAt', 'createdAt'], order: [['createdAt', 'DESC']] }),
    AuditLog.findAll({ where: { actorId: user.id }, attributes: ['action', 'ip', 'createdAt'], order: [['createdAt', 'DESC']] }),
  ]);

  await record({ actor: user, action: 'account.exported', entity: { type: 'user', id: user.id }, ip });
  return {
    exportedAt: new Date().toISOString(),
    about: 'All personal data the Internship Platform holds about you. Retention rules are described on the privacy page.',
    account: {
      email: user.email,
      name: user.displayName,
      role: user.role,
      status: user.status,
      phone: user.phoneE164,
      signInMethods: [user.passwordHash && 'password', user.googleId && 'google'].filter(Boolean),
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
      lastActiveAt: user.lastLoginAt,
    },
    studentProfile: profile && {
      fullName: profile.fullName,
      university: profile.university,
      department: profile.department,
      gpa: profile.gpa,
      bio: profile.bio,
      skills: (profile.skills ?? []).map((s) => s.name),
      resume: profile.resume && { fileName: profile.resume.originalName, size: profile.resume.size, uploadedAt: profile.resume.createdAt },
      updatedAt: profile.updatedAt,
    },
    company: membership && { name: membership.company?.name, role: membership.memberRole, nameOnStaffList: membership.fullName },
    applications: applications.map((a) => ({
      posting: a.posting?.title,
      company: a.posting?.company?.name,
      status: a.status,
      coverLetter: a.coverLetter,
      appliedAt: a.createdAt,
      history: (a.history ?? []).map((h) => ({ from: h.fromStatus, to: h.toStatus, note: h.note, at: h.createdAt })),
    })),
    internships: internships.map((i) => ({
      startDate: i.startDate,
      endDate: i.endDate,
      status: i.status,
      evaluations: i.evaluations,
      certificate: i.certificate && { serialNo: i.certificate.serialNo, issuedAt: i.certificate.issuedAt },
    })),
    evaluationsWritten: written,
    notifications,
    accountActivity: activity,
  };
}

// --- Retention (the daily `privacy.retention` job) ---

const inactiveSince = (cutoff) => ({
  [Op.or]: [{ lastLoginAt: { [Op.lt]: cutoff } }, { lastLoginAt: null, createdAt: { [Op.lt]: cutoff } }],
});
const days = (n, now) => new Date(now.getTime() - n * DAY_MS);

export async function applyRetention(now = new Date()) {
  const result = { warned: 0, anonymised: 0, unverified: 0, resumes: 0, auditLogs: 0 };
  const base = { role: { [Op.ne]: 'admin' }, anonymisedAt: null };

  // 1. Warn accounts that will be anonymised in 30 days unless they sign in.
  const toWarn = await User.findAll({
    where: { ...base, retentionWarnedAt: null, emailVerifiedAt: { [Op.ne]: null }, ...inactiveSince(days(RETENTION.inactiveAccountDays - RETENTION.warningDaysBefore, now)) },
    attributes: ['id', 'email', 'displayName'],
  });
  for (const user of toWarn) {
    try {
      await enqueueEmail('retentionWarning', user.email, { name: user.displayName ?? 'there', days: RETENTION.warningDaysBefore, url: `${config.appUrl}/login` });
      await user.update({ retentionWarnedAt: now });
      result.warned += 1;
    } catch (err) {
      logger.warn({ err: err.message, userId: user.id }, 'Could not queue the retention warning; trying again tomorrow');
    }
  }

  // 2. Warned at least 30 days ago and still inactive for a year: anonymise.
  const expired = await User.findAll({
    where: { ...base, retentionWarnedAt: { [Op.lte]: days(RETENTION.warningDaysBefore, now) }, ...inactiveSince(days(RETENTION.inactiveAccountDays, now)) },
    attributes: ['id'],
  });
  for (const { id } of expired) if (await anonymiseUser(id, { source: 'retention' })) result.anonymised += 1;

  // 3. Password accounts that never confirmed their email.
  const unverified = await User.findAll({
    where: { ...base, status: 'pending', emailVerifiedAt: null, passwordHash: { [Op.ne]: null }, createdAt: { [Op.lt]: days(RETENTION.unverifiedAccountDays, now) } },
    attributes: ['id'],
  });
  for (const { id } of unverified) if (await anonymiseUser(id, { source: 'unverified' })) result.unverified += 1;

  // 4. Resumes of students inactive for ~6 months.
  const staleResumes = await StudentProfile.findAll({
    where: { resumeFileId: { [Op.ne]: null } },
    include: [
      { model: StoredFile, as: 'resume', required: true },
      { model: User, as: 'user', attributes: ['id'], required: true, where: { ...base, ...inactiveSince(days(RETENTION.inactiveResumeDays, now)) } },
    ],
  });
  for (const profile of staleResumes) {
    const file = profile.resume;
    await sequelize.transaction(async (transaction) => {
      await profile.update({ resumeFileId: null }, { transaction });
      await StoredFile.destroy({ where: { id: file.id }, transaction });
    });
    await deleteObject({ bucket: file.bucket, key: file.objectKey }).catch(() => {});
    result.resumes += 1;
  }

  // 5. Audit entries older than a year. AuditLog refuses deletes through the model (it is
  // insert-only for the app), so retention uses a direct statement, the only place that does.
  const [res] = await sequelize.query('DELETE FROM audit_logs WHERE created_at < :cutoff', {
    replacements: { cutoff: days(RETENTION.auditLogDays, now) },
  });
  result.auditLogs = res?.affectedRows ?? 0;

  return result;
}
