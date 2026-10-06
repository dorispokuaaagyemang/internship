import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { withTimeout } from '../lib/timeout.js';
import logger from '../lib/logger.js';
import redis from '../lib/redis.js';
import { User } from '../db/models/index.js';

const STATUS_TTL_SECONDS = 30;
const REDIS_TIMEOUT_MS = 250;

const statusKey = (id) => `user:status:${id}`;

// The account status is cached briefly so a suspension takes effect on the next
// request (US-12) without a DB read on every call. Redis trouble falls back to the DB.
export async function loadStatus(id) {
  try {
    const cached = await withTimeout(redis.get(statusKey(id)), REDIS_TIMEOUT_MS);
    if (cached) return cached;
  } catch (err) {
    logger.warn({ err: err.message }, 'User status cache unavailable');
  }

  const user = await User.findByPk(id, { attributes: ['id', 'status'] });
  if (!user) return null;

  withTimeout(redis.set(statusKey(id), user.status, 'EX', STATUS_TTL_SECONDS), REDIS_TIMEOUT_MS).catch(() => {});
  return user.status;
}

// Call after any change to a user's status (suspend, reinstate, delete).
export async function invalidateUserStatus(id) {
  await withTimeout(redis.del(statusKey(id)), REDIS_TIMEOUT_MS).catch(() => {});
}

export async function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
  }

  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    throw new AppError(401, 'UNAUTHENTICATED', 'Invalid or expired access token');
  }

  const status = await loadStatus(claims.id);
  if (!status) throw new AppError(401, 'UNAUTHENTICATED', 'Account no longer exists');
  if (status === 'suspended') throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended');

  req.user = { id: claims.id, role: claims.role, status };
  next();
}

// For public routes that show more to a signed-in user: with no Authorization header the
// request continues anonymously; with one, it must be valid, exactly as with authenticate.
export function optionalAuthenticate(req, res, next) {
  if (!req.headers.authorization) return next();
  return authenticate(req, res, next);
}

// Use after authenticate: router.post('/', authenticate, authorize('admin'), handler).
export function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this resource');
    }
    next();
  };
}

// US-01: use after authenticate on every route that needs an activated account (applying,
// posting, ...). A password account is active once its email is verified; a Google account
// from the start. The error code tells the client which step is missing.
export async function requireVerified(req, res, next) {
  if (req.user?.status === 'active') return next();

  const user = await User.findByPk(req.user.id, { attributes: ['id', 'passwordHash', 'emailVerifiedAt'] });
  if (user?.passwordHash && !user.emailVerifiedAt) {
    throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address to continue');
  }
  throw new AppError(403, 'ACCOUNT_NOT_ACTIVE', 'Your account is not active yet');
}
