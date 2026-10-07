// Turns a notification row (type + payload from the API listeners) into words and a link.
const label = (status) => (status ? status.charAt(0).toUpperCase() + status.slice(1) : '');

const DESCRIBE = {
  'application.submitted': (p) => ({
    text: `Your application for ${p.postingTitle} at ${p.companyName} was sent.`,
    to: `/applications/${p.applicationId}`,
  }),
  'application.status_changed': (p) => ({
    text: `${p.companyName} moved your application for ${p.postingTitle} to ${label(p.to)}.`,
    to: `/applications/${p.applicationId}`,
  }),
  'application.received': (p) => ({
    text: `New applicant for ${p.postingTitle}.`,
    to: `/company/postings/${p.postingId}/applications/${p.applicationId}`,
  }),
  'application.withdrawn': (p) => ({
    text: `${p.studentName} withdrew their application for ${p.postingTitle}.`,
    to: `/company/postings/${p.postingId}/applications/${p.applicationId}`,
  }),
  // US-09..US-11
  'supervisor.assigned': (p) => ({
    text: `${p.supervisorName} is now your supervisor for ${p.postingTitle}.`,
    to: `/my-internships/${p.internshipId}`,
  }),
  'intern.assigned': (p) => ({
    text: `${p.studentName} (${p.postingTitle}) is now assigned to you.`,
    to: `/supervisor/interns/${p.internshipId}`,
  }),
  'evaluation.submitted': (p) => ({
    text: `New ${p.isFinal ? 'final ' : ''}evaluation for ${p.postingTitle}: ${p.period}, rated ${p.rating}/5.`,
    to: `/my-internships/${p.internshipId}`,
  }),
  'certificate.issued': (p) => ({
    text: `Your certificate for ${p.postingTitle} is ready to download.`,
    to: `/my-internships/${p.internshipId}`,
  }),
  // US-12
  'company.suspended': (p) => ({
    text: `${p.companyName} has been suspended by an admin. Its postings are closed.`,
    to: '/company',
  }),
  'company.reinstated': (p) => ({
    text: `${p.companyName} has been reinstated.`,
    to: '/company',
  }),
  'company.approved': (p) => ({
    text: `${p.companyName} is verified. You can now post internships.`,
    to: '/company/postings/new',
  }),
};

export function describeNotification(notification) {
  const describe = DESCRIBE[notification.type];
  return describe ? describe(notification.payload ?? {}) : { text: notification.type, to: null };
}

// Which cached queries a notification makes stale (US-07: the dashboard updates without a refresh).
export function queriesToRefresh(notification) {
  const keys = [['notifications']];
  if (notification.type.startsWith('application.')) keys.push(['applications']);
  if (notification.type.startsWith('company.')) keys.push(['company'], ['company-postings']);
  const internshipEvents = ['supervisor.assigned', 'intern.assigned', 'evaluation.submitted', 'certificate.issued'];
  // Accepting an application creates the internship (US-09).
  if (internshipEvents.includes(notification.type) || notification.payload?.to === 'accepted') {
    keys.push(['internships']);
  }
  return keys;
}
