import { rateLimit } from 'express-rate-limit';
import { AppError } from '../lib/errors.js';
import { withTimeout } from '../lib/timeout.js';
import { config } from '../config/index.js';
import redis from '../lib/redis.js';

const REDIS_TIMEOUT_MS = 250;

// Fixed-window counter in Redis, shared by every API instance. Plain INCR/PEXPIRE
// keeps working after Redis restarts.
class RedisCounterStore {
  constructor(prefix) {
    this.prefix = prefix;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const k = this.prefix + key;
    const [[, totalHits], [, ttl]] = await withTimeout(redis.multi().incr(k).pttl(k).exec(), REDIS_TIMEOUT_MS);
    let remainingMs = ttl;
    if (ttl < 0) {
      await withTimeout(redis.pexpire(k, this.windowMs), REDIS_TIMEOUT_MS);
      remainingMs = this.windowMs;
    }
    return { totalHits, resetTime: new Date(Date.now() + remainingMs) };
  }

  async decrement(key) {
    await withTimeout(redis.decr(this.prefix + key), REDIS_TIMEOUT_MS);
  }

  async resetKey(key) {
    await withTimeout(redis.del(this.prefix + key), REDIS_TIMEOUT_MS);
  }
}

// Per-IP limit on the auth endpoints (ARCHITECTURE.md §4.2). If Redis is down the
// request goes through (passOnStoreError) rather than locking everyone out.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.auth.rateLimit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: true,
  store: config.env === 'test' ? undefined : new RedisCounterStore('rl:auth:'),
  handler: (req, res, next) => next(new AppError(429, 'TOO_MANY_REQUESTS', 'Too many attempts, try again later')),
});

// A general per-IP ceiling for the whole API, well above normal use, against floods and
// scraping. The stricter authLimiter still applies to the auth endpoints.
export const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: config.apiRateLimit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: true,
  store: config.env === 'test' ? undefined : new RedisCounterStore('rl:api:'),
  handler: (req, res, next) => next(new AppError(429, 'TOO_MANY_REQUESTS', 'Too many requests, slow down and try again shortly')),
});
