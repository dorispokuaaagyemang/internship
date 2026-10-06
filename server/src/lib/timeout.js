// Rejects if `promise` has not settled within `ms`. Redis calls in the request path use it:
// with Redis down, ioredis queues a command for over a minute before failing.
export function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
