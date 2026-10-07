import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index.js';

const validEnv = {
  CORS_ORIGIN: 'http://localhost:5173',
  DB_HOST: 'localhost',
  DB_NAME: 'app',
  DB_USER: 'app',
  DB_PASSWORD: 'secret',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:8333',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('loadConfig', () => {
  it('applies defaults and converts types', () => {
    const config = loadConfig({ ...validEnv, S3_FORCE_PATH_STYLE: 'false', PORT: '8080' });
    expect(config.port).toBe(8080);
    expect(config.env).toBe('development');
    expect(config.db.port).toBe(3306);
    expect(config.s3.forcePathStyle).toBe(false);
    expect(config.s3.region).toBe('us-east-1');
  });

  it('lists every missing variable in one error', () => {
    const { DB_HOST, REDIS_URL, ...incomplete } = validEnv; // eslint-disable-line no-unused-vars
    expect(() => loadConfig(incomplete)).toThrow(/"DB_HOST" is required[\s\S]*"REDIS_URL" is required/);
  });

  it('rejects a non-redis REDIS_URL', () => {
    expect(() => loadConfig({ ...validEnv, REDIS_URL: 'http://localhost' })).toThrow(/REDIS_URL/);
  });

  it('applies auth defaults (ARCHITECTURE.md §4.1)', () => {
    const config = loadConfig(validEnv);
    expect(config.auth).toMatchObject({ accessTtl: '15m', refreshTtlDays: 7, bcryptCost: 12, cookieSecure: false });
  });

  it('defaults APP_URL to CORS_ORIGIN and logs email when SMTP_HOST is empty', () => {
    const config = loadConfig({ ...validEnv, SMTP_HOST: '' });
    expect(config.appUrl).toBe('http://localhost:5173');
    expect(config.mail.smtp).toBeNull();
  });

  it('builds SMTP settings when SMTP_HOST is set', () => {
    const config = loadConfig({ ...validEnv, SMTP_HOST: 'localhost', SMTP_PORT: '1025', APP_URL: 'https://app.example.com/' });
    expect(config.mail.smtp).toEqual({ host: 'localhost', port: 1025, secure: false, auth: undefined });
    expect(config.appUrl).toBe('https://app.example.com');
  });

  it('US-00A: turns Google sign-in on only with both credentials, defaulting the callback URL', () => {
    expect(loadConfig(validEnv).google).toBeNull();
    expect(loadConfig({ ...validEnv, GOOGLE_CLIENT_ID: 'id' }).google).toBeNull();
    expect(loadConfig({ ...validEnv, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' }).google).toEqual({
      clientId: 'id',
      clientSecret: 's',
      callbackUrl: 'http://localhost:5173/api/v1/auth/google/callback',
    });
  });

  it('rejects a short JWT secret', () => {
    expect(() => loadConfig({ ...validEnv, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });
});

describe('production safety checks', () => {
  const production = {
    ...validEnv,
    NODE_ENV: 'production',
    CORS_ORIGIN: 'https://internships.example.com',
    APP_URL: 'https://internships.example.com',
    JWT_ACCESS_SECRET: 'kq3V9x0bW7nYt2LmP5cR8sD1fG4hJ6aZ',
    SMTP_HOST: 'smtp.example.com',
    PRIVACY_CONTACT_EMAIL: 'privacy@example.com',
    DATA_CONTROLLER_NAME: 'Example Internships Ltd',
  };

  it('accepts a complete production configuration', () => {
    expect(loadConfig(production).auth.cookieSecure).toBe(true);
  });

  it('lists every unsafe setting at once', () => {
    const run = () =>
      loadConfig({ ...production, JWT_ACCESS_SECRET: 'change-me-to-a-random-string-of-at-least-32-chars', APP_URL: 'http://localhost:5173', SMTP_HOST: '', COOKIE_SECURE: 'false' });
    expect(run).toThrow(/JWT_ACCESS_SECRET is a placeholder/);
    expect(run).toThrow(/APP_URL must be the public https:\/\/ URL/);
    expect(run).toThrow(/SMTP_HOST is required/);
    expect(run).toThrow(/COOKIE_SECURE must not be false/);
  });

  it('does not apply them in development', () => {
    expect(() => loadConfig({ ...validEnv, JWT_ACCESS_SECRET: 'change-me-to-a-random-string-of-at-least-32-chars' })).not.toThrow();
  });
});

describe('ALLOW_INSECURE_PRODUCTION', () => {
  it('lets the full Docker stack run locally over http, and only when set', () => {
    const local = { ...validEnv, NODE_ENV: 'production', COOKIE_SECURE: 'false' };
    expect(() => loadConfig(local)).toThrow(/must be the public https/);
    expect(() => loadConfig({ ...local, ALLOW_INSECURE_PRODUCTION: 'true' })).not.toThrow();
  });
});
