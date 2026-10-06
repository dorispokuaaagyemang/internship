import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiError, getAccessToken, refreshSession, setSession } from './api';

// A fake transport for axios: each test decides what the "server" answers.
let server;
const reply = (config, status, data) => {
  const response = { status, data, headers: {}, config, statusText: String(status) };
  if (status >= 400) {
    const err = new Error(`Request failed with status code ${status}`);
    err.config = config;
    err.response = response;
    err.isAxiosError = true;
    return Promise.reject(err);
  }
  return Promise.resolve(response);
};

beforeEach(() => {
  server = vi.fn();
  api.defaults.adapter = (config) => server(config);
  setSession(null);
});
afterEach(() => setSession(null));

const session = (token) => ({ accessToken: token, user: { id: 7, role: 'student', status: 'active' } });

describe('refreshSession', () => {
  it('sends one request however many callers ask at once (rotation reuse would sign the user out)', async () => {
    server.mockImplementation((config) => reply(config, 200, session('fresh')));

    const [a, b, c] = await Promise.all([refreshSession(), refreshSession(), refreshSession()]);

    expect(server).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(getAccessToken()).toBe('fresh');
  });

  it('clears the session when the refresh cookie is rejected', async () => {
    setSession(session('old'));
    server.mockImplementation((config) => reply(config, 401, { error: { code: 'INVALID_REFRESH_TOKEN', message: 'x' } }));

    await expect(refreshSession()).rejects.toThrow();
    expect(getAccessToken()).toBeNull();
  });
});

describe('the 401 interceptor', () => {
  it('attaches the access token', async () => {
    setSession(session('t1'));
    server.mockImplementation((config) => reply(config, 200, { ok: true }));

    await api.get('/students/me');

    expect(server.mock.calls[0][0].headers.Authorization).toBe('Bearer t1');
  });

  it('renews an expired token once and replays the request', async () => {
    setSession(session('expired'));
    server.mockImplementation((config) => {
      if (config.url === '/auth/refresh') return reply(config, 200, session('renewed'));
      if (config.headers.Authorization === 'Bearer expired') {
        return reply(config, 401, { error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired access token' } });
      }
      return reply(config, 200, { ok: true });
    });

    const [r1, r2] = await Promise.all([api.get('/a'), api.get('/b')]);

    expect(r1.data).toEqual({ ok: true });
    expect(r2.data).toEqual({ ok: true });
    expect(server.mock.calls.filter(([c]) => c.url === '/auth/refresh')).toHaveLength(1);
  });

  it('does not try to refresh when nobody is signed in', async () => {
    server.mockImplementation((config) => reply(config, 401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }));

    await expect(api.get('/students/me')).rejects.toThrow();
    expect(server).toHaveBeenCalledTimes(1);
  });

  it('passes other errors through untouched', async () => {
    setSession(session('t1'));
    server.mockImplementation((config) => reply(config, 403, { error: { code: 'FORBIDDEN', message: 'No' } }));

    await expect(api.get('/admin/companies')).rejects.toMatchObject({ response: { status: 403 } });
    expect(server).toHaveBeenCalledTimes(1);
  });
});

describe('apiError', () => {
  it('reads the API error body, or explains a network failure', () => {
    expect(apiError({ response: { status: 422, data: { error: { code: 'VALIDATION_ERROR', message: 'Bad', fields: { a: 'b' } } } } })).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Bad',
      fields: { a: 'b' },
      status: 422,
    });
    expect(apiError(new Error('Network Error')).code).toBe('NETWORK_ERROR');
  });
});
