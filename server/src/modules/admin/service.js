import { Op } from 'sequelize';
import { AppError } from '../../lib/errors.js';
import logger from '../../lib/logger.js';
import redis from '../../lib/redis.js';
import { withTimeout } from '../../lib/timeout.js';
import { disconnectUser } from '../../lib/realtime.js';
import { invalidateUserStatus } from '../../middleware/auth.js';
import {
  sequelize,
  User,
  RefreshToken,
  StudentProfile,
  Company,
  CompanyMember,
  Posting,
  Application,
  AuditLog,
} from '../../db/models/index.js';
import { record } from '../audit/service.js';

// US-12: admin oversight. Every change here is audited with the admin's id and a timestamp.

const STATS_KEY = 'admin:stats';
const STATS_TTL_SECONDS = 60;
const REDIS_TIMEOUT_MS = 250;

const countBy = async (model, column, where = {}) => {
  const rows = await model.findAll({ attributes: [column, [sequelize.fn('COUNT', sequelize.col('id')), 'n']], where, group: [column], raw: true });
  return Object.fromEntries(rows.map((r) => [r[column], Number(r.n)]));
};
const sum = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);

// US-12: the dashboard counts. Cached for 60 s; with Redis down they are simply computed each time.
export async function getStats() {
  try {
    const cached = await withTimeout(redis.get(STATS_KEY), REDIS_TIMEOUT_MS);
    if (cached) return JSON.parse(cached);
  } catch (err) {
    logger.warn({ err: err.message }, 'Stats cache unavailable');
  }

  const [students, companies, postings, applications, users] = await Promise.all([
    countBy(User, 'status', { role: 'student' }),
    countBy(Company, 'status'),
    countBy(Posting, 'status'),
    countBy(Application, 'status'),
    countBy(User, 'status'),
  ]);
  const stats = {
    students: { active: students.active ?? 0, total: sum(students) },
    companies: { verified: companies.verified ?? 0, pending: companies.pending_verification ?? 0, suspended: companies.suspended ?? 0, total: sum(companies) },
    postings: { active: postings.active ?? 0, total: sum(postings) },
    applications: { ...applications, total: sum(applications) },
    users: { pending: users.pending ?? 0, suspended: users.suspended ?? 0, total: sum(users) },
    generatedAt: new Date().toISOString(),
  };
  withTimeout(redis.set(STATS_KEY, JSON.stringify(stats), 'EX', STATS_TTL_SECONDS), REDIS_TIMEOUT_MS).catch(() => {});
  return stats;
}

// --- Users ---

const like = (q) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

function serializeUser(u) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    status: u.status,
    name: u.studentProfile?.fullName ?? u.membership?.fullName ?? null,
    company: u.membership?.company ? { id: u.membership.company.id, name: u.membership.company.name } : null,
    emailVerified: Boolean(u.emailVerifiedAt),
    signInMethod: u.googleId ? 'google' : 'password',
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

export async function listUsers({ q, role, status, page, limit }) {
  const where = { ...(role && { role }), ...(status && { status }) };
  if (q) {
    where[Op.or] = [
      { email: { [Op.like]: like(q) } },
      { '$studentProfile.full_name$': { [Op.like]: like(q) } },
      { '$membership.full_name$': { [Op.like]: like(q) } },
    ];
  }
  const { rows, count } = await User.findAndCountAll({
    where,
    include: [
      { model: StudentProfile, as: 'studentProfile', attributes: ['fullName'], required: false },
      {
        model: CompanyMember,
        as: 'membership',
        attributes: ['fullName'],
        required: false,
        include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }],
      },
    ],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset: (page - 1) * limit,
    // Single-row joins only, so the search on joined columns can stay in one query.
    subQuery: false,
    distinct: true,
  });
  return { items: rows.map(serializeUser), page, limit, total: count };
}

async function loadTarget(adminId, userId) {
  const user = await User.findByPk(userId);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  if (user.id === adminId || user.role === 'admin') {
    throw new AppError(409, 'CANNOT_MODIFY_ADMIN', "Admin accounts can't be suspended or deleted here");
  }
  return user;
}

// Takes effect at once: the status cache is cleared (next request refused), every refresh
// token is revoked (no new access tokens), and open sockets are dropped.
async function cutOff(userId) {
  await invalidateUserStatus(userId);
  disconnectUser(userId);
}

const adminActor = (admin) => ({ id: admin.id, role: 'admin' });

// US-12: a flagged account loses login, posting and application rights immediately.
export async function suspendUser(admin, userId, { reason }, { ip }) {
  const user = await loadTarget(admin.id, userId);
  if (user.status === 'suspended') throw new AppError(409, 'ALREADY_SUSPENDED', 'This account is already suspended');
  const now = new Date();
  await sequelize.transaction(async (transaction) => {
    await user.update({ status: 'suspended' }, { transaction });
    await RefreshToken.update({ revokedAt: now }, { where: { userId: user.id, revokedAt: null }, transaction });
    await record({ actor: adminActor(admin), action: 'admin.user_suspended', entity: { type: 'user', id: user.id }, ip, metadata: { reason } }, { transaction });
  });
  await cutOff(user.id);
  return serializeUser(user);
}

// Back to active, or to pending for a password account that never verified its email.
export async function reinstateUser(admin, userId, { ip }) {
  const user = await loadTarget(admin.id, userId);
  if (user.status !== 'suspended') throw new AppError(409, 'NOT_SUSPENDED', 'This account is not suspended');
  const status = user.passwordHash && !user.emailVerifiedAt ? 'pending' : 'active';
  await sequelize.transaction(async (transaction) => {
    await user.update({ status }, { transaction });
    await record({ actor: adminActor(admin), action: 'admin.user_reinstated', entity: { type: 'user', id: user.id }, ip }, { transaction });
  });
  await invalidateUserStatus(user.id);
  return serializeUser(user);
}

// Soft delete (users is paranoid): the row stays for the audit trail and foreign keys, the
// account can no longer sign in, and its sessions end now.
export async function deleteUser(admin, userId, { reason }, { ip }) {
  const user = await loadTarget(admin.id, userId);
  const now = new Date();
  await sequelize.transaction(async (transaction) => {
    await RefreshToken.update({ revokedAt: now }, { where: { userId: user.id, revokedAt: null }, transaction });
    await user.destroy({ transaction });
    await record({ actor: adminActor(admin), action: 'admin.user_deleted', entity: { type: 'user', id: user.id }, ip, metadata: { reason, email: user.email } }, { transaction });
  });
  await cutOff(user.id);
}

// --- Audit log (US-12) ---

export async function listAuditLogs({ action, actorId, entityType, entityId, from, to, page, limit }) {
  const where = {
    ...(action && { action: action.endsWith('.') ? { [Op.startsWith]: action } : action }),
    ...(actorId && { actorId }),
    ...(entityType && { entityType }),
    ...(entityId && { entityId }),
  };
  if (from || to) where.createdAt = { ...(from && { [Op.gte]: from }), ...(to && { [Op.lte]: to }) };

  const { rows, count } = await AuditLog.findAndCountAll({
    where,
    include: [{ model: User, as: 'actor', attributes: ['id', 'email'], paranoid: false, required: false }],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset: (page - 1) * limit,
  });
  return {
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      actor: r.actor ? { id: r.actor.id, email: r.actor.email } : null,
      actorRole: r.actorRole,
      entityType: r.entityType,
      entityId: r.entityId,
      ip: r.ip,
      metadata: r.metadata,
      createdAt: r.createdAt,
    })),
    page,
    limit,
    total: count,
  };
}
