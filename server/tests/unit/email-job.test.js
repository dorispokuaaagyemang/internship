import { describe, expect, it, vi } from 'vitest';
import { sendEmail } from '../../src/integrations/email.js';
import { processEmail } from '../../src/jobs/processors/email.js';
import { renderEmail } from '../../src/jobs/processors/email-templates.js';

vi.mock('../../src/integrations/email.js', () => ({ sendEmail: vi.fn(async () => ({ messageId: 'm1' })) }));

describe('email templates', () => {
  it('US-01: the verification email carries the link and its lifetime', () => {
    const url = 'http://localhost:5173/api/v1/auth/verify-email/abc';
    const { subject, text, html } = renderEmail('verifyEmail', { url, expiresInHours: 24 });

    expect(subject).toBe('Verify your email address');
    expect(text).toContain(url);
    expect(text).toContain('24 hours');
    expect(html).toContain(`href="${url}"`);
  });

  it('escapes values placed in HTML', () => {
    const { html } = renderEmail('verifyEmail', { url: 'http://x/"><script>', expiresInHours: 1 });
    expect(html).not.toContain('<script>');
  });

  it('US-04: the approval email names the company and links to the app', () => {
    const { subject, text, html } = renderEmail('companyApproved', { companyName: 'Acme <Ltd>', url: 'http://localhost:5173/company' });

    expect(subject).toBe('Acme <Ltd> is verified');
    expect(text).toContain('http://localhost:5173/company');
    expect(html).toContain('Acme &lt;Ltd&gt;');
  });

  it('US-03, US-07, US-08: application emails name the posting and status, escaped in HTML', () => {
    const base = { postingTitle: 'Data <Intern>', companyName: 'Acme', url: 'http://x/applications/1' };

    expect(renderEmail('applicationReceived', base).text).toContain('Its status is Applied');
    const changed = renderEmail('applicationStatusChanged', { ...base, from: 'applied', to: 'shortlisted' });
    expect(changed.subject).toBe('Update on your application: Shortlisted');
    expect(changed.html).toContain('Data &lt;Intern&gt;');
    expect(renderEmail('applicationWithdrawn', { ...base, studentName: 'Ada' }).text).toContain('Ada withdrew');
  });

  it('US-09: the staff invite carries the link; the assignment email suits each recipient', () => {
    const invite = renderEmail('staffInvite', { companyName: 'Acme', fullName: 'Grace', url: 'http://x/accept-invite/t', expiresInDays: 7 });
    expect(invite.subject).toBe('Acme added you as a supervisor');
    expect(invite.text).toContain('http://x/accept-invite/t');
    expect(invite.text).toContain('7 days');

    const common = { studentName: 'Ada', supervisorName: 'Grace', postingTitle: 'Analyst', companyName: 'Acme', url: 'http://x' };
    expect(renderEmail('supervisorAssigned', { ...common, recipient: 'student' }).subject).toBe('Your supervisor at Acme');
    expect(renderEmail('supervisorAssigned', { ...common, recipient: 'supervisor' }).subject).toBe('New intern: Ada');
  });

  it('US-11: the certificate email names the internship and serial, and links to the app', () => {
    const { subject, text } = renderEmail('certificateIssued', {
      studentName: 'Ada',
      postingTitle: 'Analyst',
      companyName: 'Acme',
      serialNo: 'CERT-2026-000040-ABC123',
      url: 'http://x/my-internships/40',
    });
    expect(subject).toBe('Your certificate for Analyst');
    expect(text).toContain('CERT-2026-000040-ABC123');
    expect(text).toContain('http://x/my-internships/40');
  });

  it('rejects an unknown template', () => {
    expect(() => renderEmail('nope', {})).toThrow(/Unknown email template/);
  });
});

describe('email.send processor', () => {
  it('renders the template and hands it to the email adapter', async () => {
    const job = { data: { template: 'verifyEmail', to: 'ada@example.com', data: { url: 'http://x', expiresInHours: 24 } } };

    await expect(processEmail(job)).resolves.toEqual({ messageId: 'm1' });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ada@example.com', subject: 'Verify your email address' }),
    );
  });

  it('lets an adapter failure propagate so BullMQ retries', async () => {
    sendEmail.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(processEmail({ data: { template: 'verifyEmail', to: 'a@b.co', data: {} } })).rejects.toThrow(
      'ECONNREFUSED',
    );
  });
});
