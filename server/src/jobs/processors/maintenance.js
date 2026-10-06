import logger from '../../lib/logger.js';
import { closeExpiredPostings } from '../../modules/postings/service.js';
import { issueMissingCertificates } from '../../modules/internships/service.js';

// Repeatable jobs on the maintenance queue (ARCHITECTURE.md §7), scheduled by the worker at startup.
export const SCHEDULES = [
  // US-05: postings stop taking applications at their deadline. Apply and search also check
  // the deadline themselves, so nothing slips through between runs.
  { id: 'postings-auto-close', every: 5 * 60 * 1000, name: 'postings.autoClose' },
  // US-11: a completed internship whose certificate job never ran (queue down, crash) still gets one.
  { id: 'certificates-sweep', every: 10 * 60 * 1000, name: 'certificates.sweep' },
];

const handlers = {
  'postings.autoClose': async () => {
    const closed = await closeExpiredPostings();
    if (closed > 0) logger.info({ closed }, 'Closed postings past their deadline');
    return { closed };
  },
  'certificates.sweep': async () => {
    const issued = await issueMissingCertificates();
    if (issued > 0) logger.info({ issued }, 'Issued certificates that were still missing');
    return { issued };
  },
};

export async function processMaintenance(job) {
  const handler = handlers[job.name];
  if (!handler) throw new Error(`Unknown maintenance job "${job.name}"`);
  return handler(job);
}
