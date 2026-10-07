import { Op } from 'sequelize';
import { todayISO } from '../../lib/dates.js';
import { emit } from '../../lib/events.js';
import {
  RefreshToken,
  EmailVerificationToken,
  AccountInvite,
  Notification,
  Internship,
  SupervisorAssignment,
  Application,
  Posting,
  StudentProfile,
} from '../../db/models/index.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// Kept a while after they stop working, so a recent problem can still be looked into.
const TOKEN_RETENTION_DAYS = 30;
const READ_NOTIFICATION_RETENTION_DAYS = 180;

// The `maintenance.cleanup` job (ARCHITECTURE.md §7): removes credentials that can no longer be
// used, and old notifications that have been read. The audit log is never touched.
export async function purgeExpired(now = new Date()) {
  const cutoff = new Date(now.getTime() - TOKEN_RETENTION_DAYS * DAY_MS);
  const [refreshTokens, emailTokens, invites, notifications] = await Promise.all([
    RefreshToken.destroy({ where: { [Op.or]: [{ expiresAt: { [Op.lt]: cutoff } }, { revokedAt: { [Op.lt]: cutoff } }] } }),
    EmailVerificationToken.destroy({ where: { [Op.or]: [{ expiresAt: { [Op.lt]: cutoff } }, { usedAt: { [Op.lt]: cutoff } }] } }),
    AccountInvite.destroy({ where: { [Op.or]: [{ expiresAt: { [Op.lt]: cutoff } }, { usedAt: { [Op.lt]: cutoff } }] } }),
    Notification.destroy({ where: { readAt: { [Op.lt]: new Date(now.getTime() - READ_NOTIFICATION_RETENTION_DAYS * DAY_MS) } } }),
  ]);
  return { refreshTokens, emailTokens, invites, notifications };
}

// The `internships.markEnded` job (US-11): once an internship's end date has passed, its
// supervisor is reminded, once, to add a final evaluation and confirm completion.
export async function remindEndedInternships(now = new Date()) {
  const ended = await Internship.findAll({
    where: { status: 'ongoing', endDate: { [Op.lt]: todayISO(now) } },
    include: [
      { model: SupervisorAssignment, as: 'activeAssignment', required: true, attributes: ['supervisorUserId'] },
      {
        model: Application,
        as: 'application',
        attributes: ['id', 'studentId'],
        include: [
          { model: Posting, as: 'posting', attributes: ['title'] },
          { model: StudentProfile, as: 'profile', attributes: ['fullName'] },
        ],
      },
    ],
  });

  let reminded = 0;
  for (const internship of ended) {
    const supervisorId = internship.activeAssignment.supervisorUserId;
    // Once per internship and supervisor: the notification itself records that it was sent.
    // Sequelize's nested JSON syntax builds the path itself; a hand-written '$.x' path would be
    // escaped to '$$.x', which MySQL rejects as soon as a row matches.
    const already = await Notification.count({
      where: { userId: supervisorId, type: 'internship.ended', payload: { internshipId: internship.id } },
    });
    if (already) continue;
    await emit('internship.ended', {
      internshipId: internship.id,
      supervisorId,
      endDate: internship.endDate,
      postingTitle: internship.application.posting.title,
      studentName: internship.application.profile?.fullName ?? 'Your intern',
    });
    reminded += 1;
  }
  return reminded;
}
