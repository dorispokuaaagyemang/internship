import logger from './logger.js';

// In-process domain events (ARCHITECTURE.md §5.2). Services emit after their transaction
// commits; listeners (modules/notifications/listeners.js) turn events into emails now, and
// into notification rows and Socket.IO pushes in phase 5. A failing listener is logged and
// never fails the request that emitted the event.
const listeners = new Map();

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event).push(handler);
}

// Resolves once every listener has finished, so tests can await the side effects.
export async function emit(event, payload) {
  const handlers = listeners.get(event) ?? [];
  await Promise.all(
    handlers.map(async (handler) => {
      try {
        await handler(payload);
      } catch (err) {
        logger.error({ err: err.message, event }, 'Event listener failed');
      }
    }),
  );
}
