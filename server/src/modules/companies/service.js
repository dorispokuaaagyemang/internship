import { UniqueConstraintError } from 'sequelize';
import { config } from '../../config/index.js';
import { AppError } from '../../lib/errors.js';
import { emit } from '../../lib/events.js';
import logger from '../../lib/logger.js';
import { generateOpaqueToken, hashToken } from '../../lib/tokens.js';
import { sequelize, User, Company, CompanyMember, AccountInvite, SupervisorAssignment } from '../../db/models/index.js';
import { enqueueEmail } from '../../jobs/queues.js';
import { record } from '../audit/service.js';

function serialize(company, memberRole) {
  return {
    id: company.id,
    name: company.name,
    regNumber: company.regNumber,
    contactPhone: company.contactPhone,
    website: company.website,
    status: company.status,
    verifiedAt: company.verifiedAt,
    createdAt: company.createdAt,
    ...(memberRole && { memberRole }),
  };
}

// The user's company membership (with the company), or null. Other modules use it for ownership checks.
export const companyFor = (userId) =>
  CompanyMember.findOne({ where: { userId }, include: [{ model: Company, as: 'company' }] });

// US-04: the route requires an activated rep (requireVerified); the company starts
// pending_verification. The contact number is the one given, or the rep's own.
export async function registerCompany(userId, { name, regNumber, website, contactPhone }, { ip }) {
  const user = await User.findByPk(userId);
  const contact = contactPhone ?? user?.phoneE164;
  if (!contact) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Add a contact phone number', { contactPhone: 'Contact phone is required' });
  }
  if (await CompanyMember.findOne({ where: { userId } })) {
    throw new AppError(409, 'ALREADY_IN_COMPANY', 'Your account already belongs to a company');
  }

  try {
    const company = await sequelize.transaction(async (transaction) => {
      const created = await Company.create(
        { name, regNumber, website, contactPhone: contact, status: 'pending_verification' },
        { transaction },
      );
      await CompanyMember.create({ companyId: created.id, userId, memberRole: 'rep' }, { transaction });
      await record(
        { actor: user, action: 'company.registered', entity: { type: 'company', id: created.id }, ip },
        { transaction },
      );
      return created;
    });
    return serialize(company, 'rep');
  } catch (err) {
    if (!(err instanceof UniqueConstraintError)) throw err;
    // Either the registration number is taken, or a second request for the same rep won the race.
    if (/reg_number/.test(err.parent?.sqlMessage ?? Object.keys(err.fields ?? {}).join())) {
      throw new AppError(409, 'REG_NUMBER_TAKEN', 'A company with this registration number is already registered', {
        regNumber: 'Already registered',
      });
    }
    throw new AppError(409, 'ALREADY_IN_COMPANY', 'Your account already belongs to a company');
  }
}

export async function getMyCompany(userId) {
  const membership = await companyFor(userId);
  if (!membership) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Register your company first');
  return serialize(membership.company, membership.memberRole);
}

// US-04: the gate postings will call before creating or publishing. Returns the company.
export async function assertCanPost(userId) {
  const membership = await companyFor(userId);
  if (!membership) throw new AppError(403, 'COMPANY_REQUIRED', 'Register your company before posting internships');
  const { company } = membership;
  if (company.status === 'pending_verification') {
    throw new AppError(403, 'COMPANY_NOT_VERIFIED', 'Your company is awaiting admin verification. You can post once it is approved');
  }
  if (company.status !== 'verified') {
    throw new AppError(403, 'COMPANY_SUSPENDED', 'Your company is suspended and cannot post internships');
  }
  return company;
}

// --- Admin (US-04, US-12) ---

export async function listCompanies({ status, page, limit }) {
  const { rows, count } = await Company.findAndCountAll({
    where: status ? { status } : {},
    include: [
      {
        model: CompanyMember,
        as: 'members',
        where: { memberRole: 'rep' },
        required: false,
        include: [{ model: User, as: 'user', attributes: ['id', 'email', 'phoneE164'] }],
      },
    ],
    order: [['createdAt', 'ASC']],
    limit,
    offset: (page - 1) * limit,
    distinct: true,
  });
  return {
    items: rows.map((company) => ({
      ...serialize(company),
      reps: (company.members ?? []).map((m) => ({ id: m.user.id, email: m.user.email, phone: m.user.phoneE164 })),
    })),
    page,
    limit,
    total: count,
  };
}

// US-04: pending_verification -> verified, which enables posting. Audited with the admin's id (US-12).
export async function approveCompany(companyId, admin, { ip }) {
  const company = await Company.findByPk(companyId);
  if (!company) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found');

  const now = new Date();
  await sequelize.transaction(async (transaction) => {
    // Conditional update: only a pending company can be approved, and only once.
    const [approved] = await Company.update(
      { status: 'verified', verifiedBy: admin.id, verifiedAt: now },
      { where: { id: company.id, status: 'pending_verification' }, transaction },
    );
    if (approved === 0) {
      throw new AppError(409, 'COMPANY_NOT_PENDING', `Only a company awaiting verification can be approved (this one is ${company.status})`);
    }
    await record(
      { actor: admin, action: 'admin.company_approved', entity: { type: 'company', id: company.id }, ip },
      { transaction },
    );
  });

  Object.assign(company, { status: 'verified', verifiedBy: admin.id, verifiedAt: now });
  // The reps are told in-app and by email (modules/notifications/listeners.js).
  await emit('company.approved', { company });
  return serialize(company);
}

// --- Staff (US-09) ---
// Supervisors don't self-register: a rep adds them by email, which creates a pending supervisor
// account and emails a link to set its password (auth/service.js acceptInvite).

const INVITE_TTL_DAYS = 7;

async function sendInvite(user, membership, company, invitedBy) {
  const token = generateOpaqueToken();
  await AccountInvite.create({
    userId: user.id,
    invitedBy,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
  });
  const url = `${config.appUrl}/accept-invite/${token}`;
  try {
    await enqueueEmail('staffInvite', user.email, { companyName: company.name, fullName: membership.fullName, url, expiresInDays: INVITE_TTL_DAYS });
  } catch (err) {
    // Outside production the link is logged, so invites work without Redis or a worker.
    logger.warn({ err: err.message, userId: user.id, ...(config.env !== 'production' && { url }) }, 'Could not queue the staff invite');
  }
}

async function repCompany(repId) {
  const membership = await companyFor(repId);
  if (!membership || membership.memberRole !== 'rep') throw new AppError(403, 'COMPANY_REQUIRED', 'Register your company first');
  return membership.company;
}

export async function addStaff(repId, { email, fullName }, { ip }) {
  const company = await repCompany(repId);
  const rep = await User.findByPk(repId);
  let user;
  let membership;
  try {
    ({ user, membership } = await sequelize.transaction(async (transaction) => {
      const created = await User.create({ email, role: 'supervisor', status: 'pending' }, { transaction });
      const member = await CompanyMember.create({ companyId: company.id, userId: created.id, memberRole: 'supervisor', fullName }, { transaction });
      await record({ actor: rep, action: 'company.staff_added', entity: { type: 'user', id: created.id }, ip, metadata: { companyId: company.id } }, { transaction });
      return { user: created, membership: member };
    }));
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists', { email: 'An account with this email already exists' });
    }
    throw err;
  }
  await sendInvite(user, membership, company, repId);
  return staffMember(membership, user, 0);
}

export async function resendInvite(repId, userId) {
  const company = await repCompany(repId);
  const membership = await CompanyMember.findOne({ where: { companyId: company.id, userId, memberRole: 'supervisor' } });
  const user = membership && (await User.findByPk(userId));
  if (!user) throw new AppError(404, 'STAFF_NOT_FOUND', 'Staff member not found');
  if (user.passwordHash || user.status !== 'pending') {
    throw new AppError(409, 'INVITE_ALREADY_ACCEPTED', 'This supervisor has already set up their account');
  }
  await sendInvite(user, membership, company, repId);
}

function staffMember(membership, user, activeInterns) {
  return {
    id: user.id,
    email: user.email,
    fullName: membership.fullName,
    memberRole: membership.memberRole,
    // invited: has not set a password yet
    status: user.status === 'pending' && !user.passwordHash ? 'invited' : user.status,
    activeInterns,
  };
}

// US-09: the staff list the rep assigns supervisors from, with each one's current load.
export async function listStaff(repId) {
  const company = await repCompany(repId);
  const members = await CompanyMember.findAll({
    where: { companyId: company.id },
    include: [{ model: User, as: 'user', attributes: ['id', 'email', 'status', 'passwordHash'] }],
    order: [['memberRole', 'ASC'], ['createdAt', 'ASC']],
  });
  const counts = await SupervisorAssignment.findAll({
    attributes: ['supervisorUserId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
    where: { active: true, supervisorUserId: members.map((m) => m.userId) },
    group: ['supervisorUserId'],
    raw: true,
  });
  const load = new Map(counts.map((c) => [c.supervisorUserId, Number(c.n)]));
  return members.map((m) => staffMember(m, m.user, load.get(m.userId) ?? 0));
}
