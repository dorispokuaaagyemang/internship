// Worker process entry point: consumes the BullMQ queues (ARCHITECTURE.md §7).
// Same image as the API; compose runs it as `node src/worker.js`.
import { Worker } from 'bullmq';
import { config } from './config/index.js';
import logger from './lib/logger.js';
import { sequelize } from './db/models/index.js';
import { CERTIFICATE_QUEUE, EMAIL_QUEUE, MAINTENANCE_QUEUE, closeQueues, createConnection, getQueue } from './jobs/queues.js';
import { processEmail } from './jobs/processors/email.js';
import { processCertificate } from './jobs/processors/certificate.js';
import { SCHEDULES, processMaintenance } from './jobs/processors/maintenance.js';
// Jobs emit domain events too (certificate.issued): the same listeners write the notification
// rows and queue the emails. There is no Socket.IO server here, so no live push; the bell
// picks them up on its next fetch.
import './modules/notifications/listeners.js';

const workers = [
  new Worker(EMAIL_QUEUE, processEmail, { connection: createConnection(), concurrency: 5 }),
  // PDF rendering is CPU-bound; two at a time keeps the worker responsive.
  new Worker(CERTIFICATE_QUEUE, processCertificate, { connection: createConnection(), concurrency: 2 }),
  new Worker(MAINTENANCE_QUEUE, processMaintenance, { connection: createConnection(), concurrency: 1 }),
];

// Upserting is idempotent, so every worker start (or several workers) leaves one schedule per job.
for (const { id, every, name } of SCHEDULES) {
  getQueue(MAINTENANCE_QUEUE)
    .upsertJobScheduler(id, { every }, { name })
    .catch((err) => logger.error({ err: err.message, schedule: id }, 'Could not schedule a maintenance job'));
}

for (const worker of workers) {
  worker.on('completed', (job) => logger.info({ queue: worker.name, jobId: job.id, name: job.name }, 'Job completed'));
  worker.on('failed', (job, err) =>
    logger.warn(
      { queue: worker.name, jobId: job?.id, attempt: job?.attemptsMade, err: err.message },
      'Job failed',
    ),
  );
  worker.on('error', (err) => logger.error({ queue: worker.name, err: err.code || err.message }, 'Worker error'));
}

logger.info({ env: config.env, queues: workers.map((w) => w.name) }, 'Worker started');

async function shutdown(signal) {
  logger.info({ signal }, 'Worker shutting down');
  setTimeout(() => process.exit(1), 10000).unref();
  await Promise.allSettled(workers.map((w) => w.close()));
  await closeQueues().catch(() => {});
  await sequelize.close().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
