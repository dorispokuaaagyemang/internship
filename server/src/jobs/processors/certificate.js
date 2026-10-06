import logger from '../../lib/logger.js';
import { generateCertificate } from '../../modules/internships/service.js';

// Processes `certificate.generate` jobs: { internshipId } (US-11). PDFKit -> certificates bucket ->
// files + certificates rows -> email and notification. A thrown error lets BullMQ retry; the
// work is idempotent, so a retry never issues a second certificate.
export async function processCertificate(job) {
  const certificate = await generateCertificate(job.data.internshipId);
  if (certificate) logger.info({ internshipId: job.data.internshipId, serialNo: certificate.serialNo }, 'Certificate issued');
  return { issued: Boolean(certificate) };
}
