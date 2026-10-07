// Each template turns job data into { subject, text, html }.
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// "shortlisted" -> "Shortlisted", as US-07 names the statuses.
const statusLabel = (status) => String(status).charAt(0).toUpperCase() + String(status).slice(1);

export const templates = {
  // US-01
  verifyEmail: ({ url, expiresInHours }) => ({
    subject: 'Verify your email address',
    text: [
      'Welcome to the Internship Platform.',
      '',
      'Confirm your email address by opening this link:',
      url,
      '',
      `The link expires in ${expiresInHours} hours. If you did not create an account, ignore this email.`,
    ].join('\n'),
    html: `<p>Welcome to the Internship Platform.</p>
<p><a href="${escapeHtml(url)}">Confirm your email address</a></p>
<p>The link expires in ${escapeHtml(expiresInHours)} hours. If you did not create an account, ignore this email.</p>`,
  }),

  // US-04: an admin verified the company, so it can now post internships.
  companyApproved: ({ companyName, url }) => ({
    subject: `${companyName} is verified`,
    text: [
      `Good news: ${companyName} has been verified on the Internship Platform.`,
      '',
      'You can now create and publish internship postings:',
      url,
    ].join('\n'),
    html: `<p>Good news: <strong>${escapeHtml(companyName)}</strong> has been verified on the Internship Platform.</p>
<p><a href="${escapeHtml(url)}">Start posting internships</a></p>`,
  }),

  // US-09: a company added this person as a supervisor; the link sets their password.
  staffInvite: ({ companyName, fullName, url, expiresInDays }) => ({
    subject: `${companyName} added you as a supervisor`,
    text: [
      `Hello ${fullName},`,
      '',
      `${companyName} added you as a supervisor on the Internship Platform, so you can follow and evaluate your interns.`,
      '',
      'Set your password to get started:',
      url,
      '',
      `The link expires in ${expiresInDays} days. If you were not expecting this, ignore this email.`,
    ].join('\n'),
    html: `<p>Hello ${escapeHtml(fullName)},</p>
<p>${escapeHtml(companyName)} added you as a supervisor on the Internship Platform, so you can follow and evaluate your interns.</p>
<p><a href="${escapeHtml(url)}">Set your password to get started</a></p>
<p>The link expires in ${escapeHtml(expiresInDays)} days. If you were not expecting this, ignore this email.</p>`,
  }),

  // US-09: the student and the supervisor are both told about an assignment.
  supervisorAssigned: ({ recipient, studentName, supervisorName, postingTitle, companyName, url }) => ({
    subject: recipient === 'student' ? `Your supervisor at ${companyName}` : `New intern: ${studentName}`,
    text:
      recipient === 'student'
        ? `${supervisorName} is now your supervisor for ${postingTitle} at ${companyName}.\n\n${url}`
        : `${studentName} (${postingTitle}) is now assigned to you at ${companyName}.\n\n${url}`,
    html:
      recipient === 'student'
        ? `<p>${escapeHtml(supervisorName)} is now your supervisor for <strong>${escapeHtml(postingTitle)}</strong> at ${escapeHtml(companyName)}.</p><p><a href="${escapeHtml(url)}">View your internship</a></p>`
        : `<p>${escapeHtml(studentName)} (<strong>${escapeHtml(postingTitle)}</strong>) is now assigned to you at ${escapeHtml(companyName)}.</p><p><a href="${escapeHtml(url)}">View the intern</a></p>`,
  }),

  // US-11: the link opens the internship page in the app, which fetches a fresh download link.
  certificateIssued: ({ studentName, postingTitle, companyName, serialNo, url }) => ({
    subject: `Your certificate for ${postingTitle}`,
    text: [
      `Congratulations ${studentName}!`,
      '',
      `${companyName} has confirmed that you completed ${postingTitle}. Your certificate (serial no. ${serialNo}) is ready.`,
      '',
      'Download it here:',
      url,
    ].join('\n'),
    html: `<p>Congratulations ${escapeHtml(studentName)}!</p>
<p>${escapeHtml(companyName)} has confirmed that you completed <strong>${escapeHtml(postingTitle)}</strong>. Your certificate (serial no. ${escapeHtml(serialNo)}) is ready.</p>
<p><a href="${escapeHtml(url)}">Download your certificate</a></p>`,
  }),

  // US-11: the internship has ended; the certificate needs a final evaluation and confirmation.
  internshipEnded: ({ studentName, postingTitle, endDate, url }) => ({
    subject: `Internship ended: ${studentName}`,
    text: [
      `${studentName}'s internship (${postingTitle}) ended on ${endDate}.`,
      '',
      'To issue their certificate, add a final evaluation and confirm completion:',
      url,
    ].join('\n'),
    html: `<p>${escapeHtml(studentName)}'s internship (<strong>${escapeHtml(postingTitle)}</strong>) ended on ${escapeHtml(endDate)}.</p>
<p>To issue their certificate, <a href="${escapeHtml(url)}">add a final evaluation and confirm completion</a>.</p>`,
  }),

  // US-03: confirmation to the student.
  applicationReceived: ({ postingTitle, companyName, url }) => ({
    subject: `Application sent: ${postingTitle}`,
    text: [
      `Your application for ${postingTitle} at ${companyName} has been received. Its status is Applied.`,
      '',
      'Follow its progress here:',
      url,
    ].join('\n'),
    html: `<p>Your application for <strong>${escapeHtml(postingTitle)}</strong> at ${escapeHtml(companyName)} has been received. Its status is <strong>Applied</strong>.</p>
<p><a href="${escapeHtml(url)}">Follow its progress</a></p>`,
  }),

  // US-06, US-07: the company moved the application on.
  applicationStatusChanged: ({ postingTitle, companyName, to, url }) => ({
    subject: `Update on your application: ${statusLabel(to)}`,
    text: [
      `${companyName} updated your application for ${postingTitle}. Its status is now ${statusLabel(to)}.`,
      '',
      'See the details:',
      url,
    ].join('\n'),
    html: `<p>${escapeHtml(companyName)} updated your application for <strong>${escapeHtml(postingTitle)}</strong>. Its status is now <strong>${escapeHtml(statusLabel(to))}</strong>.</p>
<p><a href="${escapeHtml(url)}">See the details</a></p>`,
  }),

  // US-08: to the company's reps.
  applicationWithdrawn: ({ postingTitle, studentName, url }) => ({
    subject: `Application withdrawn: ${postingTitle}`,
    text: [`${studentName} withdrew their application for ${postingTitle}.`, '', url].join('\n'),
    html: `<p>${escapeHtml(studentName)} withdrew their application for <strong>${escapeHtml(postingTitle)}</strong>.</p>
<p><a href="${escapeHtml(url)}">View the application</a></p>`,
  }),

};

export function renderEmail(template, data) {
  const render = templates[template];
  if (!render) throw new Error(`Unknown email template "${template}"`);
  return render(data);
}
