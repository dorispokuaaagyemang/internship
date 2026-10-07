// Checks the SMTP settings and sends one test email.
//   npm run mail:test -w server -- you@example.com
import Joi from 'joi';
import nodemailer from 'nodemailer';
import { config } from '../src/config/index.js';

const { value: to, error } = Joi.string().trim().email().required().validate(process.argv[2]);
if (error) {
  console.error('Usage: npm run mail:test -w server -- <your email address>');
  process.exit(1);
}
const smtp = config.mail.smtp;
if (!smtp) {
  console.error('SMTP_HOST is not set in .env, so emails are only written to the log. See docs/EMAIL.md.');
  process.exit(1);
}

console.log(`Connecting to ${smtp.host}:${smtp.port} (${smtp.secure ? 'TLS' : 'STARTTLS'}) as ${smtp.auth?.user ?? 'no login'}...`);
const transport = nodemailer.createTransport(smtp);
try {
  await transport.verify();
  console.log('Login OK.');
  const info = await transport.sendMail({
    from: config.mail.from,
    to,
    subject: 'Internship Platform: test email',
    text: `This is a test from the Internship Platform (${config.env}). If you can read it, email is set up.\n\nSent from: ${config.mail.from}`,
  });
  console.log(`Sent to ${to} (message id ${info.messageId}). Check the inbox, and the spam folder.`);
} catch (err) {
  console.error(`Failed: ${err.message}`);
  if (err.code === 'EAUTH') console.error('The login was refused: check SMTP_USER and SMTP_PASSWORD (an SMTP key or app password, not your normal password).');
  if (['ETIMEDOUT', 'ECONNREFUSED', 'ESOCKET', 'ECONNECTION'].includes(err.code)) {
    console.error('Could not reach the server: check SMTP_HOST and SMTP_PORT (587 with SMTP_SECURE=false, or 465 with SMTP_SECURE=true).');
  }
  process.exitCode = 1;
} finally {
  transport.close();
}
