// Starts the BullMQ workers (ARCHITECTURE.md §7). Used by the worker process (src/worker.js) and,
// with RUN_WORKER_IN_API=true, inside the API process itself, for hosts where a separate worker
// costs extra (docs/DEPLOY-RENDER-VERCEL.md).
import { Worker } from 'bullmq';
import logger from '../lib/logger.js';
import { CERTIFICATE_QUEUE, EMAIL_QUEUE, MAINTENANCE_QUEUE, createConnection, getQueue } from './queues.js';
import { processEmail } from './processors/email.js';
import { processCertificate } from './processors/certificate.js';
import { SCHEDULES, processMaintenance } from './processors/maintenance.js';
// Jobs emit domain events too (certificate.issued): the same listeners write the notification
// rows and queue the emails.
import '../modules/notifications/listeners.js';

// Returns a function that stops every worker.
export function startWorkers() {
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
      logger.warn({ queue: worker.name, jobId: job?.id, attempt: job?.attemptsMade, err: err.message }, 'Job failed'),
    );
    worker.on('error', (err) => logger.error({ queue: worker.name, err: err.code || err.message }, 'Worker error'));
  }

  logger.info({ queues: workers.map((w) => w.name) }, 'Workers started');
  return () => Promise.allSettled(workers.map((w) => w.close()));
}
