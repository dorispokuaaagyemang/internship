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

  it('defaults to secure cookies in production', () => {
    expect(loadConfig({ ...validEnv, NODE_ENV: 'production' }).auth.cookieSecure).toBe(true);
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
