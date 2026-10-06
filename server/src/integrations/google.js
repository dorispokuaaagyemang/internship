import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

// Google sign-in adapter (US-00A): the OAuth 2.0 authorization-code flow with OpenID Connect.
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const TIMEOUT_MS = 10_000;

export const isGoogleConfigured = () => Boolean(config.google);

// The consent screen URL. Scope is limited to openid email profile (ARCHITECTURE.md §4.3).
export function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params}`;
}

// Swaps the callback code for the user's identity. The ID token comes straight from
// Google's token endpoint over TLS, so its claims are checked but its signature is not
// (OpenID Connect Core §3.1.3.7).
export async function exchangeCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.callbackUrl,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Google token exchange failed with ${res.status}`);

  const { id_token: idToken } = await res.json();
  const claims = idToken ? jwt.decode(idToken) : null;
  if (!claims) throw new Error('Google returned no ID token');
  if (!ISSUERS.includes(claims.iss)) throw new Error('Unexpected ID token issuer');
  if (claims.aud !== config.google.clientId) throw new Error('ID token is for another client');
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error('ID token has expired');

  return {
    googleId: claims.sub,
    email: String(claims.email ?? '').toLowerCase(),
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    name: claims.name ?? null,
  };
}
