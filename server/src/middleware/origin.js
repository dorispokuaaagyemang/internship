import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from '../lib/errors.js';

const digest = (value) => createHash('sha256').update(value).digest();

// For a deployment where a proxy that is not the last hop fronts the API (Vercel in front of
// Render; docs/DEPLOY-RENDER-VERCEL.md). That proxy sets X-Origin-Secret on every request it
// forwards, so a request without it went around the proxy and is refused. Requests that pass come
// from that proxy, which overwrites X-Real-IP with the visitor's address, so req.ip (rate limits,
// audit log) is taken from it. The health check stays open for the host's own probes; Socket.IO
// connects directly and never reaches Express.
export function requireOrigin(secret) {
  const expected = digest(secret);
  return (req, res, next) => {
    if (req.path === '/api/v1/health') return next();
    const given = req.get('x-origin-secret');
    if (!given || !timingSafeEqual(digest(given), expected)) {
      return next(new AppError(403, 'DIRECT_ACCESS_FORBIDDEN', 'Use the public address of the site'));
    }
    const ip = req.get('x-real-ip')?.split(',')[0].trim();
    if (ip) Object.defineProperty(req, 'ip', { value: ip, configurable: true, enumerable: true });
    next();
  };
}
