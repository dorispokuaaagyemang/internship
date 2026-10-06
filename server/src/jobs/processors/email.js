import { sendEmail } from '../../integrations/email.js';
import { renderEmail } from './email-templates.js';

// Processes `email.send` jobs: { template, to, data }. A thrown error lets BullMQ retry with backoff.
export async function processEmail(job) {
  const { template, to, data } = job.data;
  return sendEmail({ to, ...renderEmail(template, data) });
}
