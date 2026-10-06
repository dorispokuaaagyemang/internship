import axios from 'axios';

// Same-origin in every environment: Vite proxies /api in dev, nginx in production.
export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
});

// --- Session plumbing (ARCHITECTURE.md §4.1) ---
// The access token lives only in memory; the refresh token is an httpOnly cookie the browser
// sends to /api/v1/auth. The AuthProvider subscribes to session changes.

let accessToken = null;
const listeners = new Set();

export const getAccessToken = () => accessToken;

export function setSession(session) {
  accessToken = session?.accessToken ?? null;
  for (const listener of listeners) listener(session);
}

export function onSessionChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Exactly one refresh at a time. The server rotates the refresh token on every call and treats
// a second use of the same token as theft, revoking every session, so concurrent 401s (or
// React StrictMode running an effect twice) must share one request.
let refreshing = null;
export function refreshSession() {
  refreshing ??= api
    .post('/auth/refresh', null, { skipAuthRefresh: true })
    .then(({ data }) => {
      setSession(data);
      return data;
    })
    .catch((err) => {
      setSession(null);
      throw err;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

api.interceptors.request.use((request) => {
  if (accessToken && !request.headers.Authorization) request.headers.Authorization = `Bearer ${accessToken}`;
  return request;
});

// An expired access token (15 min) is renewed once, then the request is replayed.
api.interceptors.response.use(undefined, async (error) => {
  const { config, response } = error;
  const expired = response?.status === 401 && response.data?.error?.code === 'UNAUTHENTICATED';
  if (!expired || !config || config.skipAuthRefresh || config._retried || !accessToken) throw error;

  await refreshSession();
  config._retried = true;
  config.headers.Authorization = `Bearer ${accessToken}`;
  return api(config);
});

// The API's error body: { error: { code, message, fields? } }.
export function apiError(err) {
  const body = err?.response?.data?.error;
  if (body) return { code: body.code, message: body.message, fields: body.fields ?? {}, status: err.response.status };
  return { code: 'NETWORK_ERROR', message: 'Could not reach the server. Check your connection and try again.', fields: {}, status: 0 };
}
