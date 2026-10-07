import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import Joi from 'joi';

// One .env at the repo root serves local dev and docker compose.
const rootUrl = new URL('../../../', import.meta.url);
dotenv.config({ path: fileURLToPath(new URL('.env', rootUrl)), quiet: true });

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(4000),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),
  CORS_ORIGIN: Joi.string().uri().required(),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(3306),
  DB_NAME: Joi.string().required(),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  // Path to the server's CA certificate (e.g. Aiven's ca.pem). Set it to connect over verified TLS.
  DB_SSL_CA: Joi.string().allow('').default(''),

  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).required(),

  S3_ENDPOINT: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_ACCESS_KEY: Joi.string().required(),
  S3_SECRET_KEY: Joi.string().required(),
  S3_FORCE_PATH_STYLE: Joi.boolean().default(true),
  // Private buckets. Cloudflare R2 needs them created by hand; compose creates them for SeaweedFS.
  S3_BUCKET_RESUMES: Joi.string().default('resumes'),
  S3_BUCKET_CERTIFICATES: Joi.string().default('certificates'),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().min(1).default(7),
  BCRYPT_COST: Joi.number().integer().min(4).max(15).default(12),
  // Requests per IP per 15 minutes on the auth endpoints.
  AUTH_RATE_LIMIT: Joi.number().integer().min(1).default(20),
  // Requests per IP per 5 minutes across the whole API.
  API_RATE_LIMIT: Joi.number().integer().min(1).default(600),
  // Skips the production safety checks (see productionProblems). Never set it on a real server.
  ALLOW_INSECURE_PRODUCTION: Joi.boolean().default(false),
  // Secure cookies need https; the compose stack serves plain http on :80, so set false there.
  COOKIE_SECURE: Joi.boolean().when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().default(true),
    otherwise: Joi.boolean().default(false),
  }),

  // Public URL users open in a browser; links in emails start with it.
  APP_URL: Joi.string().uri({ scheme: ['http', 'https'] }).default(Joi.ref('CORS_ORIGIN')),
  EMAIL_VERIFICATION_TTL_HOURS: Joi.number().integer().min(1).default(24),

  // Google sign-in (US-00A). Both empty turns it off; GET /auth/google then reports it unavailable.
  GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').default(''),
  // Must match an "Authorized redirect URI" in Google Cloud Console. Defaults to APP_URL + /api/v1/auth/google/callback.
  GOOGLE_CALLBACK_URL: Joi.string().uri({ scheme: ['http', 'https'] }).allow(''),

  // Without SMTP_HOST the worker writes each email to the log instead of sending it.
  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASSWORD: Joi.string().allow('').default(''),
  MAIL_FROM: Joi.string().default('Internship Platform <no-reply@localhost>'),
  // Data protection: where people send access/erasure requests; shown on the privacy page.
  PRIVACY_CONTACT_EMAIL: Joi.string().trim().email().allow('').default(''),
  // The organisation legally responsible for the data (the "data controller"); named on the privacy page.
  DATA_CONTROLLER_NAME: Joi.string().trim().max(200).allow('').default(''),
}).unknown(true);

// Fails fast at startup with every missing/invalid variable listed.
// Settings that are fine for local development but unsafe or broken in production. Checked only
// when NODE_ENV=production, and reported together with the schema errors.
function productionProblems(value) {
  const problems = [];
  if (/change-me|^(.)\1+$/i.test(value.JWT_ACCESS_SECRET)) {
    problems.push('JWT_ACCESS_SECRET is a placeholder; generate a random one');
  }
  for (const key of ['CORS_ORIGIN', 'APP_URL']) {
    const url = value[key] ?? value.CORS_ORIGIN;
    if (!/^https:\/\//.test(url) || /localhost|127\.0\.0\.1/.test(url)) problems.push(`${key} must be the public https:// URL`);
  }
  // Without SMTP, verification emails are only logged, so no one could activate an account.
  if (!value.SMTP_HOST) problems.push('SMTP_HOST is required (accounts are activated by email)');
  if (!value.PRIVACY_CONTACT_EMAIL) problems.push('PRIVACY_CONTACT_EMAIL is required (the privacy notice names it)');
  if (!value.DATA_CONTROLLER_NAME) problems.push('DATA_CONTROLLER_NAME is required (the privacy notice names who is responsible)');
  if (value.COOKIE_SECURE === false) problems.push('COOKIE_SECURE must not be false behind https');
  if (/change-me/i.test(value.DB_PASSWORD ?? '')) problems.push('DB_PASSWORD is a placeholder');
  return problems;
}

export function loadConfig(env = process.env) {
  const { value, error } = schema.validate(env, { abortEarly: false, convert: true });
  const problems = (error?.details ?? []).map((d) => d.message);
  // ALLOW_INSECURE_PRODUCTION: only for the full Docker stack on a developer machine over http.
  if (!error && value.NODE_ENV === 'production' && !value.ALLOW_INSECURE_PRODUCTION) problems.push(...productionProblems(value));
  if (problems.length) {
    throw new Error(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }

  return {
    env: value.NODE_ENV,
    port: value.PORT,
    logLevel: value.LOG_LEVEL,
    corsOrigin: value.CORS_ORIGIN,
    apiRateLimit: value.API_RATE_LIMIT,
    db: {
      host: value.DB_HOST,
      port: value.DB_PORT,
      name: value.DB_NAME,
      user: value.DB_USER,
      password: value.DB_PASSWORD,
      ssl: value.DB_SSL_CA ? { ca: readCa(value.DB_SSL_CA), rejectUnauthorized: true } : null,
    },
    redisUrl: value.REDIS_URL,
    s3: {
      endpoint: value.S3_ENDPOINT,
      region: value.S3_REGION,
      accessKeyId: value.S3_ACCESS_KEY,
      secretAccessKey: value.S3_SECRET_KEY,
      forcePathStyle: value.S3_FORCE_PATH_STYLE,
      buckets: { resumes: value.S3_BUCKET_RESUMES, certificates: value.S3_BUCKET_CERTIFICATES },
    },
    auth: {
      accessSecret: value.JWT_ACCESS_SECRET,
      accessTtl: value.JWT_ACCESS_TTL,
      refreshTtlDays: value.REFRESH_TOKEN_TTL_DAYS,
      bcryptCost: value.BCRYPT_COST,
      rateLimit: value.AUTH_RATE_LIMIT,
      cookieSecure: value.COOKIE_SECURE,
      emailVerificationTtlHours: value.EMAIL_VERIFICATION_TTL_HOURS,
    },
    appUrl: value.APP_URL.replace(/\/+$/, ''),
    privacyContactEmail: value.PRIVACY_CONTACT_EMAIL || null,
    dataControllerName: value.DATA_CONTROLLER_NAME || null,
    google:
      value.GOOGLE_CLIENT_ID && value.GOOGLE_CLIENT_SECRET
        ? {
            clientId: value.GOOGLE_CLIENT_ID,
            clientSecret: value.GOOGLE_CLIENT_SECRET,
            callbackUrl:
              value.GOOGLE_CALLBACK_URL || `${value.APP_URL.replace(/\/+$/, '')}/api/v1/auth/google/callback`,
          }
        : null,
    mail: {
      from: value.MAIL_FROM,
      smtp: value.SMTP_HOST
        ? {
            host: value.SMTP_HOST,
            port: value.SMTP_PORT,
            secure: value.SMTP_SECURE,
            auth: value.SMTP_USER ? { user: value.SMTP_USER, pass: value.SMTP_PASSWORD } : undefined,
          }
        : null,
    },
  };
}

function readCa(path) {
  try {
    return readFileSync(fileURLToPath(new URL(path, rootUrl)), 'utf8');
  } catch (err) {
    throw new Error(`Invalid environment configuration:\n  - DB_SSL_CA: cannot read ${path} (${err.code || err.message})`, {
      cause: err,
    });
  }
}

export const config = loadConfig();
