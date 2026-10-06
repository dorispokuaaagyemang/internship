// Deterministic env for tests; dotenv never overrides variables already set here.
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  CORS_ORIGIN: 'http://localhost:5173',
  DB_HOST: 'localhost',
  DB_NAME: 'internship_test',
  DB_USER: 'test',
  DB_PASSWORD: 'test',
  DB_SSL_CA: '',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:8333',
  S3_ACCESS_KEY: 'test',
  S3_SECRET_KEY: 'test',
  JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-123',
  BCRYPT_COST: '4',
  // Room for every auth request in tests/integration/auth.test.js, which share one limiter.
  AUTH_RATE_LIMIT: '50',
  GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-google-secret',
});
