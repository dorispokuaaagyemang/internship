import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../config/index.js';
import logger from '../lib/logger.js';
import { withTimeout } from '../lib/timeout.js';

export const EMAIL_QUEUE = 'email';
export const MAINTENANCE_QUEUE = 'maintenance';
export const CERTIFICATE_QUEUE = 'certificates';

const ENQUEUE_TIMEOUT_MS = 1000;

// BullMQ needs maxRetriesPerRequest: null on its connections.
export function createConnection() {
  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', (err) => logger.warn({ err: err.code || err.message }, 'Queue Redis connection error'));
  return connection;
}

const QUEUE_OPTIONS = {
  [EMAIL_QUEUE]: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
  // US-11: storage or the database may be briefly away; the job is idempotent, so retry.
  [CERTIFICATE_QUEUE]: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
  // Repeatable housekeeping; the next run retries anyway, so keep only a short history.
  [MAINTENANCE_QUEUE]: {
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 100,
  },
};

// Created on first use, so importing this module opens no connection.
const queues = new Map();
export function getQueue(name) {
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, { connection: createConnection(), defaultJobOptions: QUEUE_OPTIONS[name] }));
  }
  return queues.get(name);
}

// Queues the `email.send` job (ARCHITECTURE.md §7); the worker renders and sends it.
// Rejects after 1 s if Redis is unreachable, instead of holding the request open.
export function enqueueEmail(template, to, data) {
  return withTimeout(getQueue(EMAIL_QUEUE).add('send', { template, to, data }), ENQUEUE_TIMEOUT_MS);
}

// Queues the `certificate.generate` job (US-11) for a completed internship.
export function enqueueCertificate(internshipId) {
  return withTimeout(getQueue(CERTIFICATE_QUEUE).add('generate', { internshipId }), ENQUEUE_TIMEOUT_MS);
}

export async function closeQueues() {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
}
