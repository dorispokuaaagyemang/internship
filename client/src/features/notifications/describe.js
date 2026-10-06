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
  if (notification.type === 'company.approved') keys.push(['company']);
  return keys;
}
