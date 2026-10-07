// Worker process entry point: consumes the BullMQ queues (ARCHITECTURE.md §7).
// Same image as the API; compose runs it as `node src/worker.js`. There is no Socket.IO server
// here, so notifications written by jobs are not pushed live; the bell picks them up on its next fetch.
import { config } from './config/index.js';
import logger from './lib/logger.js';
import { sequelize } from './db/models/index.js';
import { closeQueues } from './jobs/queues.js';
import { startWorkers } from './jobs/runner.js';

const stopWorkers = startWorkers();
logger.info({ env: config.env }, 'Worker started');

async function shutdown(signal) {
  logger.info({ signal }, 'Worker shutting down');
  setTimeout(() => process.exit(1), 10000).unref();
  await stopWorkers();
  await closeQueues().catch(() => {});
  await sequelize.close().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
