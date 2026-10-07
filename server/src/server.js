import http from 'node:http';
import { config } from './config/index.js';
import logger from './lib/logger.js';
import redis from './lib/redis.js';
import { closeRealtime, initRealtime } from './lib/realtime.js';
import { sequelize } from './db/index.js';
import { createApp } from './app.js';
import { closeQueues } from './jobs/queues.js';
import { startWorkers } from './jobs/runner.js';

const server = http.createServer(createApp());
// Socket.IO shares the HTTP server, at /socket.io (proxied by Vite in dev and nginx in production).
initRealtime(server);
// One process instead of API + worker, where a separate worker costs extra (Render).
const stopWorkers = config.runWorkerInApi ? startWorkers() : null;

server.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env, worker: Boolean(stopWorkers) }, 'API listening');
});

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  setTimeout(() => process.exit(1), 10000).unref();
  // Closing Socket.IO also closes the HTTP server.
  await closeRealtime();
  if (stopWorkers) await stopWorkers();
  await Promise.allSettled([sequelize.close(), redis.quit(), closeQueues()]);
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
