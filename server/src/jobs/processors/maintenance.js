import logger from '../../lib/logger.js';
import { closeExpiredPostings } from '../../modules/postings/service.js';
import { issueMissingCertificates } from '../../modules/internships/service.js';
import { purgeExpired, remindEndedInternships } from '../../modules/maintenance/service.js';
import { applyRetention } from '../../modules/privacy/service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Repeatable jobs on the maintenance queue (ARCHITECTURE.md §7), scheduled by the worker at startup.
export const SCHEDULES = [
  // US-05: postings stop taking applications at their deadline. Apply and search also check
  // the deadline themselves, so nothing slips through between runs.
  { id: 'postings-auto-close', every: 5 * 60 * 1000, name: 'postings.autoClose' },
  // US-11: a completed internship whose certificate job never ran (queue down, crash) still gets one.
  { id: 'certificates-sweep', every: 10 * 60 * 1000, name: 'certificates.sweep' },
  // US-11: remind the supervisor once an internship's end date has passed.
  { id: 'internships-ended', every: DAY_MS, name: 'internships.markEnded' },
  // Security: drop credentials that can no longer be used, and old read notifications.
  { id: 'maintenance-cleanup', every: DAY_MS, name: 'maintenance.cleanup' },
  // Data protection: warn and anonymise inactive accounts, drop stale resumes and old audit entries.
  { id: 'privacy-retention', every: DAY_MS, name: 'privacy.retention' },
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
  'internships.markEnded': async () => {
    const reminded = await remindEndedInternships();
    if (reminded > 0) logger.info({ reminded }, 'Reminded supervisors of ended internships');
    return { reminded };
  },
  'privacy.retention': async () => {
    const result = await applyRetention();
    logger.info(result, 'Applied the data retention rules');
    return result;
  },
  'maintenance.cleanup': async () => {
    const removed = await purgeExpired();
    logger.info(removed, 'Removed expired tokens and old notifications');
    return removed;
  },
};

export async function processMaintenance(job) {
  const handler = handlers[job.name];
  if (!handler) throw new Error(`Unknown maintenance job "${job.name}"`);
  return handler(job);
}
