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

export async function sendEmail({ to, subject, text, html }) {
  const message = { from: config.mail.from, to, subject, text, html };
  const smtp = getTransport();
  if (!smtp) {
    logger.info({ to, subject, text }, 'Email (SMTP_HOST not set, not sent)');
    return { logged: true };
  }
  const info = await smtp.sendMail(message);
  return { messageId: info.messageId };
}
