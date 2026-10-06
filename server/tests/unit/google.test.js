import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuthUrl, exchangeCode } from '../../src/integrations/google.js';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';

function idToken(claims = {}) {
  return jwt.sign(
    {
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: 'g-123',
      email: 'Ada@Example.com',
      email_verified: true,
      name: 'Ada Lovelace',
      ...claims,
    },
    'irrelevant',
    { expiresIn: 60 },
  );
}

function mockTokenEndpoint(body, status = 200) {
  const fetchMock = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('buildAuthUrl (US-00A)', () => {
  it('asks only for openid email profile and carries the state and callback', () => {
    const url = new URL(buildAuthUrl('the-state'));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('state')).toBe('the-state');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/v1/auth/google/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
  });
});

describe('exchangeCode', () => {
  it('returns the Google identity with a lowercased email', async () => {
    const fetchMock = mockTokenEndpoint({ id_token: idToken() });

    await expect(exchangeCode('the-code')).resolves.toEqual({
      googleId: 'g-123',
      email: 'ada@example.com',
      emailVerified: true,
      name: 'Ada Lovelace',
    });
    const body = fetchMock.mock.calls[0][1].body;
    expect(body.get('code')).toBe('the-code');
    expect(body.get('grant_type')).toBe('authorization_code');
  });

  it('rejects a token issued for another client', async () => {
    mockTokenEndpoint({ id_token: idToken({ aud: 'someone-else' }) });
    await expect(exchangeCode('c')).rejects.toThrow(/another client/);
  });

  it('rejects a token from another issuer', async () => {
    mockTokenEndpoint({ id_token: idToken({ iss: 'https://evil.example' }) });
    await expect(exchangeCode('c')).rejects.toThrow(/issuer/);
  });

  it('fails when Google rejects the code', async () => {
    mockTokenEndpoint({ error: 'invalid_grant' }, 400);
    await expect(exchangeCode('c')).rejects.toThrow(/400/);
  });

  it('reports an unverified Google email as such', async () => {
    mockTokenEndpoint({ id_token: idToken({ email_verified: false }) });
    await expect(exchangeCode('c')).resolves.toMatchObject({ emailVerified: false });
  });
});
