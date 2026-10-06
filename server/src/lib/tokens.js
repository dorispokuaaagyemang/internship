import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

// Access token (ARCHITECTURE.md §4.1): short-lived HS256 JWT, kept in client memory.
export function signAccessToken(user) {
  return jwt.sign({ role: user.role }, config.auth.accessSecret, {
    algorithm: 'HS256',
    subject: String(user.id),
    expiresIn: config.auth.accessTtl,
  });
}

// Throws on a bad signature, wrong algorithm or expiry.
export function verifyAccessToken(token) {
  const payload = jwt.verify(token, config.auth.accessSecret, { algorithms: ['HS256'] });
  return { id: Number(payload.sub), role: payload.role };
}

// OAuth `state` for Google sign-in (ARCHITECTURE.md §4.3): carries the sign-up intent and a
// nonce that must match a cookie, so a callback can't be forged or replayed from another browser.
const STATE_AUDIENCE = 'google-oauth-state';

export function signOAuthState({ intent, nonce }) {
  return jwt.sign({ intent, nonce }, config.auth.accessSecret, {
    algorithm: 'HS256',
    audience: STATE_AUDIENCE,
    expiresIn: '10m',
  });
}

export function verifyOAuthState(state) {
  const { intent, nonce } = jwt.verify(state, config.auth.accessSecret, {
    algorithms: ['HS256'],
    audience: STATE_AUDIENCE,
  });
  return { intent, nonce };
}

// Opaque 256-bit token; only its hash is stored.
export function generateOpaqueToken() {
  return randomBytes(32).toString('base64url');
}

// SHA-256 hex, matching the CHAR(64) token columns.
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
