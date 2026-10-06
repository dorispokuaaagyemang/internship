import { Redis } from 'ioredis';
import { config } from '../config/index.js';
import logger from './logger.js';

// lazyConnect: the connection opens on first command, so importing this module has no side effects.
const redis = new Redis(config.redisUrl, { lazyConnect: true });

// ioredis retries on its own; without a listener every failed attempt prints "Unhandled error event".
redis.on('error', (err) => logger.warn({ err: err.code || err.message },'Redis connection error'));

export default redis;
