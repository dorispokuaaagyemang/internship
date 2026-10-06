import bcrypt from 'bcryptjs';
import { Op, UniqueConstraintError } from 'sequelize';
import { config } from '../../config/index.js';
import { AppError } from '../../lib/errors.js';
import logger from '../../lib/logger.js';
import { generateOpaqueToken, hashToken, signAccessToken, signOAuthState, verifyOAuthState } from '../../lib/tokens.js';
import {
  sequelize,
  User,
  RefreshToken,
  EmailVerificationToken,
  AccountInvite,
  Company,
  CompanyMember,
} from '../../db/models/index.js';
import { buildAuthUrl, exchangeCode, isGoogleConfigured } from '../../integrations/google.js';
import { enqueueEmail } from '../../jobs/queues.js';
import { invalidateUserStatus } from '../../middleware/auth.js';
import { record } from '../audit/service.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RESEND_COOLDOWN_MS = 60 * 1000;

const invalidRefresh = () => new AppError(401, 'INVALID_REFRESH_TOKEN', 'Session expired, please sign in again');
const suspended = () => new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended');

// Compared against when the email is unknown, so response time doesn't reveal which accounts exist.
let dummyHash;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync('not-a-real-password', config.auth.bcryptCost));

// Stores a new refresh token (hash only) and signs an access token (ARCHITECTURE.md §4.1).
async function issueTokens(user, { transaction } = {}) {
  const refreshToken = generateOpaqueToken();
  await RefreshToken.create(
    {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + config.auth.refreshTtlDays * DAY_MS),
    },
    { transaction },
  );
  return { accessToken: signAccessToken(user), refreshToken, user };
}

// A password account becomes active once its email is verified (US-01). Google accounts have no
// password and a Google-verified email, so they are active at once. SMS verification (US-00B)
// was dropped on 2026-10-06.
export function readyToActivate(user) {
  return user.status === 'pending' && (!user.passwordHash || Boolean(user.emailVerifiedAt));
}

// Stores a single-use link token (hash only). The link opens GET /auth/verify-email/:token.
async function createEmailVerification(user, { transaction } = {}) {
  const token = generateOpaqueToken();
  await EmailVerificationToken.create(
    {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + config.auth.emailVerificationTtlHours * HOUR_MS),
    },
    { transaction },
  );
  return `${config.appUrl}/api/v1/auth/verify-email/${token}`;
}

// A queue outage must not fail the request: the user can ask for a new link.
// Outside production the link is logged, so verification works without Redis or a worker.
async function sendVerificationEmail(user, url) {
  try {
    await enqueueEmail('verifyEmail', user.email, { url, expiresInHours: config.auth.emailVerificationTtlHours });
  } catch (err) {
    const devLink = config.env === 'production' ? {} : { url };
    logger.warn({ err: err.message, userId: user.id, ...devLink }, 'Could not queue the verification email');
  }
}

// US-01: password accounts start pending; verifying the email activates them.
export async function register({ email, password, phone, role }, { ip }) {
  const passwordHash = await bcrypt.hash(password, config.auth.bcryptCost);
  let session;
  let verifyUrl;
  try {
    session = await sequelize.transaction(async (transaction) => {
      const user = await User.create(
        { email, passwordHash, role, phoneE164: phone, status: 'pending' },
        { transaction },
      );
      await record({ actor: user, action: 'auth.register', entity: { type: 'user', id: user.id }, ip }, { transaction });
      verifyUrl = await createEmailVerification(user, { transaction });
      return issueTokens(user, { transaction });
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists', {
        email: 'An account with this email already exists',
      });
    }
    throw err;
  }
  // Queued only after commit, so the worker never sees a token that was rolled back.
  await sendVerificationEmail(session.user, verifyUrl);
  return session;
}

// US-01: confirms the address behind a verification link.
export async function verifyEmail(rawToken, { ip }) {
  const invalid = () => new AppError(400, 'EMAIL_LINK_INVALID', 'This verification link is not valid');

  const stored = await EmailVerificationToken.findOne({ where: { tokenHash: hashToken(rawToken) } });
  if (!stored) throw invalid();
  const user = await User.findByPk(stored.userId);
  if (!user) throw invalid();

  // Opening the link a second time is harmless once the address is verified.
  if (user.emailVerifiedAt) return user;
  if (stored.usedAt) throw invalid();
  if (stored.expiresAt <= new Date()) {
    throw new AppError(410, 'EMAIL_LINK_EXPIRED', 'This verification link has expired, request a new one');
  }

  const now = new Date();
  const activated = await sequelize.transaction(async (transaction) => {
    // Conditional update: two clicks at once verify the address only once.
    const [used] = await EmailVerificationToken.update(
      { usedAt: now },
      { where: { id: stored.id, usedAt: null }, transaction },
    );
    if (used === 0) return false;

    user.emailVerifiedAt = now;
    const activate = readyToActivate(user);
    if (activate) user.status = 'active';
    await user.save({ transaction });
    await record({ actor: user, action: 'auth.email_verified', entity: { type: 'user', id: user.id }, ip }, { transaction });
    return activate;
  });
  if (activated) await invalidateUserStatus(user.id);
  return user;
}

// Sends a fresh link. Always succeeds from the caller's view, so it can't be used
// to find out which emails have accounts. At most one link per minute per account.
export async function resendVerification({ email }) {
  const user = await User.findOne({ where: { email } });
  if (!user || !user.passwordHash || user.emailVerifiedAt || user.status === 'suspended') return;

  const recent = await EmailVerificationToken.findOne({
    where: { userId: user.id, createdAt: { [Op.gt]: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
  });
  if (recent) return;

  await sendVerificationEmail(user, await createEmailVerification(user));
}

export async function login({ email, password }, { ip }) {
  const user = await User.findOne({ where: { email } });
  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? getDummyHash());

  // A Google-only account has no password hash, so it fails here too.
  if (!user || !user.passwordHash || !passwordOk) {
    await record({ actor: user, action: 'auth.login_failed', ip, metadata: { email } });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  if (user.status === 'suspended') throw suspended();
  // US-01: an unverified email blocks login and prompts verification.
  if (!user.emailVerifiedAt) {
    throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address before signing in');
  }

  return sequelize.transaction(async (transaction) => {
    await user.update({ lastLoginAt: new Date() }, { transaction });
    await record({ actor: user, action: 'auth.login', entity: { type: 'user', id: user.id }, ip }, { transaction });
    return issueTokens(user, { transaction });
  });
}

// Rotates the refresh token. A token that was already rotated may have been stolen,
// so presenting it revokes every session of that user (ARCHITECTURE.md §4.1).
export async function refresh(rawToken, { ip }) {
  if (!rawToken) throw invalidRefresh();

  const stored = await RefreshToken.findOne({ where: { tokenHash: hashToken(rawToken) } });
  if (!stored) throw invalidRefresh();

  const user = await User.findByPk(stored.userId);
  if (!user) throw invalidRefresh();

  const revokeAll = async () => {
    await RefreshToken.update({ revokedAt: new Date() }, { where: { userId: user.id, revokedAt: null } });
    await record({ actor: user, action: 'auth.refresh_reuse', entity: { type: 'user', id: user.id }, ip });
    throw invalidRefresh();
  };

  if (stored.revokedAt) return revokeAll();
  if (stored.expiresAt <= new Date()) throw invalidRefresh();

  // Conditional update: of two concurrent refreshes with the same token, only one wins.
  const [rotated] = await RefreshToken.update(
    { revokedAt: new Date() },
    { where: { id: stored.id, revokedAt: null } },
  );
  if (rotated === 0) return revokeAll();
  if (user.status === 'suspended') throw suspended();

  return issueTokens(user);
}

// Idempotent: a missing, unknown or already revoked token still succeeds.
export async function logout(rawToken, { ip }) {
  if (!rawToken) return;
  const stored = await RefreshToken.findOne({ where: { tokenHash: hashToken(rawToken) } });
  if (!stored || stored.revokedAt) return;

  await stored.update({ revokedAt: new Date() });
  const user = await User.findByPk(stored.userId);
  await record({ actor: user, action: 'auth.logout', entity: { type: 'user', id: stored.userId }, ip });
}

// --- Google sign-in (US-00A, ARCHITECTURE.md §4.3) ---

const GOOGLE_INTENTS = ['student', 'company_rep'];
const googleFailed = () => new AppError(502, 'GOOGLE_FAILED', 'Google sign-in failed, please try again');

// Returns the consent URL and the nonce the controller stores in a cookie.
// `intent` only sets the role of a brand-new account.
export function startGoogleSignIn(intent) {
  if (!isGoogleConfigured()) {
    throw new AppError(503, 'GOOGLE_UNAVAILABLE', 'Google sign-in is not available');
  }
  const nonce = generateOpaqueToken();
  const state = signOAuthState({ intent: GOOGLE_INTENTS.includes(intent) ? intent : 'student', nonce });
  return { url: buildAuthUrl(state), nonce };
}

// Finds the account by Google id, then by email (linking it), and creates one only if neither exists.
async function findOrCreateGoogleUser(profile, intent) {
  const byGoogleId = await User.findOne({ where: { googleId: profile.googleId } });
  if (byGoogleId) return { user: byGoogleId, outcome: 'existing' };

  const byEmail = await User.findOne({ where: { email: profile.email } });
  if (byEmail) {
    // Already linked to a different Google identity: refuse rather than relink.
    if (byEmail.googleId) throw googleFailed();

    const now = new Date();
    byEmail.googleId = profile.googleId;
    if (!byEmail.emailVerifiedAt) {
      // Whoever set this password never proved they own the address, so it goes,
      // along with its sessions. Otherwise an attacker could pre-register a victim's email.
      byEmail.passwordHash = null;
      byEmail.emailVerifiedAt = now;
      await RefreshToken.update({ revokedAt: now }, { where: { userId: byEmail.id, revokedAt: null } });
    }
    if (readyToActivate(byEmail)) byEmail.status = 'active';
    await byEmail.save();
    await invalidateUserStatus(byEmail.id);
    return { user: byEmail, outcome: 'linked' };
  }

  try {
    const user = await User.create({
      email: profile.email,
      googleId: profile.googleId,
      role: intent,
      status: 'active', // Google has verified the email
      emailVerifiedAt: new Date(),
    });
    return { user, outcome: 'created' };
  } catch (err) {
    // A concurrent sign-in or a soft-deleted account already holds this email or Google id.
    if (err instanceof UniqueConstraintError) throw googleFailed();
    throw err;
  }
}

// Handles Google's redirect back. `nonce` is the cookie set by startGoogleSignIn.
// Denying consent creates nothing (US-00A).
export async function completeGoogleSignIn({ error, code, state, nonce }, { ip }) {
  if (error) {
    if (error === 'access_denied') throw new AppError(403, 'GOOGLE_DENIED', 'Google sign-in was cancelled');
    throw googleFailed();
  }

  let claims;
  try {
    claims = verifyOAuthState(state);
  } catch {
    throw googleFailed();
  }
  if (!code || !nonce || claims.nonce !== nonce) throw googleFailed();

  let profile;
  try {
    profile = await exchangeCode(code);
  } catch (err) {
    logger.warn({ err: err.message }, 'Google code exchange failed');
    throw googleFailed();
  }
  // Linking by email is only safe when Google vouches for the address.
  if (!profile.email || !profile.emailVerified) {
    throw new AppError(403, 'GOOGLE_EMAIL_UNVERIFIED', 'Your Google account email is not verified');
  }

  const { user, outcome } = await findOrCreateGoogleUser(profile, claims.intent);
  if (user.status === 'suspended') throw suspended();

  return sequelize.transaction(async (transaction) => {
    await user.update({ lastLoginAt: new Date() }, { transaction });
    await record(
      { actor: user, action: 'auth.google_signin', entity: { type: 'user', id: user.id }, ip, metadata: { outcome } },
      { transaction },
    );
    return issueTokens(user, { transaction });
  });
}

export async function getCurrentUser(id) {
  const user = await User.findByPk(id);
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Account no longer exists');
  return user;
}

// --- Staff invites (US-09) ---
// A company rep adds a supervisor (companies/service.js); the emailed link lands on the app's
// /accept-invite page, which shows who it is for and sets the password. Opening the link proves
// the address, so accepting also verifies the email and activates the account.

const inviteInvalid = () => new AppError(400, 'INVITE_INVALID', 'This invitation link is not valid. Ask your company to send a new one.');

async function loadInvite(rawToken) {
  const invite = await AccountInvite.findOne({ where: { tokenHash: hashToken(rawToken ?? '') } });
  if (!invite || invite.usedAt) throw inviteInvalid();
  if (invite.expiresAt <= new Date()) {
    throw new AppError(410, 'INVITE_EXPIRED', 'This invitation has expired. Ask your company to send a new one.');
  }
  const user = await User.findByPk(invite.userId);
  if (!user || user.passwordHash || user.status === 'suspended') throw inviteInvalid();
  return { invite, user };
}

export async function getInvite(rawToken) {
  const { user } = await loadInvite(rawToken);
  const membership = await CompanyMember.findOne({
    where: { userId: user.id },
    include: [{ model: Company, as: 'company', attributes: ['name'] }],
  });
  return { email: user.email, fullName: membership?.fullName ?? null, companyName: membership?.company?.name ?? null };
}

export async function acceptInvite(rawToken, { password }, { ip }) {
  const { invite, user } = await loadInvite(rawToken);
  const passwordHash = await bcrypt.hash(password, config.auth.bcryptCost);
  const now = new Date();

  const session = await sequelize.transaction(async (transaction) => {
    // Conditional update: the same link used twice at once works only once.
    const [used] = await AccountInvite.update({ usedAt: now }, { where: { id: invite.id, usedAt: null }, transaction });
    if (used === 0) throw inviteInvalid();
    await user.update({ passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? now, status: 'active', lastLoginAt: now }, { transaction });
    await record({ actor: user, action: 'auth.invite_accepted', entity: { type: 'user', id: user.id }, ip }, { transaction });
    return issueTokens(user, { transaction });
  });
  await invalidateUserStatus(user.id);
  return session;
}
