import nodemailer from 'nodemailer';
import { config } from '../config/index.js';
import logger from '../lib/logger.js';

// Email adapter (ARCHITECTURE.md §2.1). With no SMTP_HOST configured, messages are
// written to the log so local development works without a mail server.
let transport;
function getTransport() {
  transport ??= config.mail.smtp ? nodemailer.createTransport(config.mail.smtp) : null;
  return transport;
}

// Reserved for examples and testing (RFC 2606, RFC 6761): no mailbox exists there. The demo seed
// uses @demo.example.com and erased accounts @deleted.invalid; sending would only bounce and hurt
// the sender's reputation with the provider.
const RESERVED = /@(?:[^@]+\.)?(?:example\.(?:com|net|org)|example|invalid|test|localhost)$/i;
export const isReservedAddress = (to) => RESERVED.test(to.trim());

export async function sendEmail({ to, subject, text, html }) {
  const message = { from: config.mail.from, to, subject, text, html };
  const smtp = getTransport();
  if (!smtp || isReservedAddress(to)) {
    logger.info({ to, subject, text }, smtp ? 'Email to a reserved test domain, not sent' : 'Email (SMTP_HOST not set, not sent)');
    return { logged: true };
  }
  const info = await smtp.sendMail(message);
  return { messageId: info.messageId };
}
