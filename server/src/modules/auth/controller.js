import { config } from '../../config/index.js';
import { AppError } from '../../lib/errors.js';
import * as auth from './service.js';

export const REFRESH_COOKIE = 'refresh_token';

// Scoped to the auth routes, so the browser sends it only to /refresh and /logout.
const cookieOptions = () => ({
  httpOnly: true,
  secure: config.auth.cookieSecure,
  sameSite: 'strict',
  path: '/api/v1/auth',
});

function setRefreshCookie(res, refreshToken) {
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...cookieOptions(),
    maxAge: config.auth.refreshTtlDays * 24 * 60 * 60 * 1000,
  });
}

function sendSession(res, status, { accessToken, refreshToken, user }) {
  setRefreshCookie(res, refreshToken);
  res.status(status).json({ accessToken, user });
}

// Holds the OAuth nonce between /google and /google/callback. Lax, because Google's
// redirect back is a cross-site navigation and a Strict cookie would not be sent.
const GOOGLE_NONCE_COOKIE = 'google_oauth_nonce';
const googleCookieOptions = () => ({
  httpOnly: true,
  secure: config.auth.cookieSecure,
  sameSite: 'lax',
  path: '/api/v1/auth/google',
});

export async function register(req, res) {
  sendSession(res, 201, await auth.register(req.body, { ip: req.ip }));
}

export async function login(req, res) {
  sendSession(res, 200, await auth.login(req.body, { ip: req.ip }));
}

export async function refresh(req, res) {
  try {
    sendSession(res, 200, await auth.refresh(req.cookies?.[REFRESH_COOKIE], { ip: req.ip }));
  } catch (err) {
    // A rejected token is useless; drop it so the client stops resending it.
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    throw err;
  }
}

export async function logout(req, res) {
  await auth.logout(req.cookies?.[REFRESH_COOKIE], { ip: req.ip });
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
  res.status(204).end();
}

// Opened from the email, so the browser is sent back to the app with the outcome
// in the query string, e.g. /login?error=email_link_expired.
export async function verifyEmail(req, res) {
  try {
    await auth.verifyEmail(req.params.token, { ip: req.ip });
    res.redirect(`${config.appUrl}/login?emailVerified=1`);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    res.redirect(`${config.appUrl}/login?error=${err.code.toLowerCase()}`);
  }
}

export async function resendVerification(req, res) {
  await auth.resendVerification(req.body);
  res.status(202).json({ message: 'If that account needs verification, a new link is on its way' });
}

// Both Google endpoints are browser navigations, so every outcome is a redirect back to the
// app: errors land on /login?error=<code>, e.g. google_denied (US-00A).
const redirectToLogin = (res, err) => res.redirect(`${config.appUrl}/login?error=${err.code.toLowerCase()}`);

export function googleStart(req, res) {
  try {
    const { url, nonce } = auth.startGoogleSignIn(req.query.intent);
    res.cookie(GOOGLE_NONCE_COOKIE, nonce, { ...googleCookieOptions(), maxAge: 10 * 60 * 1000 });
    res.redirect(url);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    redirectToLogin(res, err);
  }
}

// On success the refresh cookie is set and the app's /auth/complete page calls
// POST /auth/refresh for an access token, then routes to OTP if the phone is unverified.
export async function googleCallback(req, res) {
  res.clearCookie(GOOGLE_NONCE_COOKIE, googleCookieOptions());
  const params = {
    error: req.query.error,
    code: typeof req.query.code === 'string' ? req.query.code : undefined,
    state: typeof req.query.state === 'string' ? req.query.state : '',
    nonce: req.cookies?.[GOOGLE_NONCE_COOKIE],
  };
  try {
    const { refreshToken } = await auth.completeGoogleSignIn(params, { ip: req.ip });
    setRefreshCookie(res, refreshToken);
    res.redirect(`${config.appUrl}/auth/complete`);
  } catch (err) {
    if (err instanceof AppError) return redirectToLogin(res, err);
    req.log.error({ err }, 'Google sign-in failed');
    redirectToLogin(res, new AppError(502, 'GOOGLE_FAILED', 'Google sign-in failed'));
  }
}

// US-09: what the invite page shows, then accepting it, which signs the supervisor in.
export async function getInvite(req, res) {
  res.json({ invite: await auth.getInvite(req.params.token) });
}

export async function acceptInvite(req, res) {
  sendSession(res, 200, await auth.acceptInvite(req.body.token, req.body, { ip: req.ip }));
}

export async function me(req, res) {
  res.json({ user: await auth.getCurrentUser(req.user.id) });
}
