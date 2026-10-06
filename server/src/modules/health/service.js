import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { config } from '../../config/index.js';
import { sequelize } from '../../db/index.js';
import redis from '../../lib/redis.js';
import s3 from '../../lib/s3.js';

const CHECK_TIMEOUT_MS = 2000;

async function probe(name, fn) {
  const started = Date.now();
  let timer;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), CHECK_TIMEOUT_MS);
      }),
    ]);
    return { name, status: 'up', latencyMs: Date.now() - started };
  } catch (err) {
    // AWS SDK errors often have an empty message; the name (e.g. NotFound, Forbidden) says more.
    return { name, status: 'down', error: err.message || err.name || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function getHealth() {
  const checks = await Promise.all([
    probe('mysql', () => sequelize.authenticate()),
    probe('redis', () => redis.ping()),
    // A signed request, so bad credentials or a missing bucket show up as "down" too. HeadBucket
    // rather than ListBuckets: an R2 token scoped to specific buckets may not list them all.
    probe('storage', () => s3.send(new HeadBucketCommand({ Bucket: config.s3.buckets.resumes }))),
  ]);
  const healthy = checks.every((c) => c.status === 'up');
  return { status: healthy ? 'ok' : 'degraded', checks };
}
