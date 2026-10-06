import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { config } from '../config/index.js';
import logger from './logger.js';
import { verifyAccessToken } from './tokens.js';
import { loadStatus } from '../middleware/auth.js';

// Socket.IO (ARCHITECTURE.md §5.2, US-07). A client connects with its access token in
// `auth.token` and joins its own room, user:<id>; pushToUser() emits there. The Redis
// adapter relays emits between API instances. Until initRealtime() runs (tests, the
// worker), pushToUser() is a no-op and the data simply shows up on the next load.
let io = null;

export const userRoom = (id) => `user:${id}`;

// Same checks as the authenticate middleware: a valid token and an account that exists and
// is not suspended. The status is checked at connect time only.
async function authenticateSocket(socket, next) {
  try {
    const claims = verifyAccessToken(socket.handshake.auth?.token ?? '');
    const status = await loadStatus(claims.id);
    if (!status || status === 'suspended') return next(new Error('UNAUTHENTICATED'));
    socket.data.user = { id: claims.id, role: claims.role };
    next();
  } catch {
    next(new Error('UNAUTHENTICATED'));
  }
}

export function initRealtime(httpServer, { adapter = true } = {}) {
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: config.corsOrigin, credentials: true },
    serveClient: false,
  });

  if (adapter) {
    const pub = new Redis(config.redisUrl, { lazyConnect: false });
    const sub = pub.duplicate();
    for (const client of [pub, sub]) {
      client.on('error', (err) => logger.warn({ err: err.code || err.message }, 'Socket.IO Redis connection error'));
    }
    io.adapter(createAdapter(pub, sub));
  }

  io.use(authenticateSocket);
  io.on('connection', (socket) => {
    socket.join(userRoom(socket.data.user.id));
  });
  return io;
}

export function pushToUser(userId, event, data) {
  io?.to(userRoom(userId)).emit(event, data);
}

// For a suspension (US-12, phase 7): drop the user's open sockets at once.
export function disconnectUser(userId) {
  io?.in(userRoom(userId)).disconnectSockets(true);
}

export async function closeRealtime() {
  if (!io) return;
  await io.close();
  io = null;
}
