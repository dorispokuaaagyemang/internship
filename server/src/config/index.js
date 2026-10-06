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
}).unknown(true);

// Fails fast at startup with every missing/invalid variable listed.
export function loadConfig(env = process.env) {
  const { value, error } = schema.validate(env, { abortEarly: false, convert: true });
  if (error) {
    const problems = error.details.map((d) => `  - ${d.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return {
    env: value.NODE_ENV,
    port: value.PORT,
    logLevel: value.LOG_LEVEL,
    corsOrigin: value.CORS_ORIGIN,
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
