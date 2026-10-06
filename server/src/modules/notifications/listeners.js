import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';
import { on } from '../../lib/events.js';
import { enqueueEmail } from '../../jobs/queues.js';
import { User, CompanyMember } from '../../db/models/index.js';
import { notify } from './service.js';

// Turns domain events into notifications (US-03, US-04, US-06..US-08): an in-app row pushed
// live over Socket.IO, plus an email where the stories ask for one. Imported once by app.js,
// so each listener is registered exactly once.

async function email(template, to, data) {
  try {
    await enqueueEmail(template, to, data);
  } catch (err) {
    logger.warn({ err: err.message, template }, 'Could not queue a notification email');
  }
}

async function companyReps(companyId) {
  const reps = await CompanyMember.findAll({
    where: { companyId, memberRole: 'rep' },
    include: [{ model: User, as: 'user', attributes: ['id', 'email'] }],
  });
  return reps.map((r) => r.user);
}

const applicationUrl = (id) => `${config.appUrl}/applications/${id}`;
const companyApplicationUrl = (postingId, id) => `${config.appUrl}/company/postings/${postingId}/applications/${id}`;

const applicationPayload = (application, posting) => ({
  applicationId: application.id,
  postingId: posting.id,
  postingTitle: posting.title,
  companyName: posting.company?.name,
});

// US-03: the student gets a confirmation; the company's reps see the new applicant in-app.
on('application.created', async ({ application, posting, student }) => {
  const reps = await companyReps(posting.companyId);
  await Promise.all([
    notify([student.id], 'application.submitted', { ...applicationPayload(application, posting), status: 'applied' }),
    notify(reps.map((r) => r.id), 'application.received', applicationPayload(application, posting)),
    email('applicationReceived', student.email, {
      postingTitle: posting.title,
      companyName: posting.company.name,
      url: applicationUrl(application.id),
    }),
  ]);
});

// US-06, US-07: every status change the company makes reaches the student, live and by email.
on('application.statusChanged', ({ application, posting, student, from, to }) =>
  Promise.all([
    notify([student.id], 'application.status_changed', { ...applicationPayload(application, posting), from, to }),
    email('applicationStatusChanged', student.email, {
      postingTitle: posting.title,
      companyName: posting.company.name,
      from,
      to,
      url: applicationUrl(application.id),
    }),
  ]),
);

// US-08: the company's reps hear about a withdrawal.
on('application.withdrawn', async ({ application, posting, studentName }) => {
  const reps = await companyReps(posting.companyId);
  const url = companyApplicationUrl(posting.id, application.id);
  await Promise.all([
    notify(reps.map((r) => r.id), 'application.withdrawn', { ...applicationPayload(application, posting), studentName }),
    ...reps.map((rep) => email('applicationWithdrawn', rep.email, { postingTitle: posting.title, studentName, url })),
  ]);
});

// US-04: an admin verified the company, so its reps can post.
on('company.approved', async ({ company }) => {
  const reps = await companyReps(company.id);
  await Promise.all([
    notify(reps.map((r) => r.id), 'company.approved', { companyId: company.id, companyName: company.name }),
    ...reps.map((rep) => email('companyApproved', rep.email, { companyName: company.name, url: `${config.appUrl}/company` })),
  ]);
});

// US-09: both the intern and the supervisor are told, in-app and by email.
on('supervisor.assigned', async ({ internship, supervisor }) => {
  const studentName = internship.student.fullName ?? 'Your intern';
  const supervisorName = supervisor.fullName ?? supervisor.email;
  const payload = {
    internshipId: internship.id,
    postingTitle: internship.posting.title,
    companyName: internship.company.name,
    studentName,
    supervisorName,
  };
  const common = { studentName, supervisorName, postingTitle: internship.posting.title, companyName: internship.company.name };
  await Promise.all([
    notify([internship.student.id], 'supervisor.assigned', payload),
    notify([supervisor.id], 'intern.assigned', payload),
    internship.student.email &&
      email('supervisorAssigned', internship.student.email, { ...common, recipient: 'student', url: `${config.appUrl}/my-internships/${internship.id}` }),
    email('supervisorAssigned', supervisor.email, { ...common, recipient: 'supervisor', url: `${config.appUrl}/supervisor/interns/${internship.id}` }),
  ]);
});

// US-10: the intern sees each new evaluation in-app (it is read-only for them).
on('evaluation.submitted', ({ internship, evaluation }) =>
  notify([internship.student.id], 'evaluation.submitted', {
    internshipId: internship.id,
    evaluationId: evaluation.id,
    period: evaluation.period,
    rating: evaluation.rating,
    isFinal: evaluation.isFinal,
    postingTitle: internship.posting.title,
    companyName: internship.company.name,
  }),
);

// US-11: the certificate is stored with the internship; the student is told in-app and gets a link.
on('certificate.issued', ({ internship, certificate }) =>
  Promise.all([
    notify([internship.student.id], 'certificate.issued', {
      internshipId: internship.id,
      postingTitle: internship.posting.title,
      companyName: internship.company.name,
      serialNo: certificate.serialNo,
    }),
    internship.student.email &&
      email('certificateIssued', internship.student.email, {
        studentName: internship.student.fullName ?? 'there',
        postingTitle: internship.posting.title,
        companyName: internship.company.name,
        serialNo: certificate.serialNo,
        url: `${config.appUrl}/my-internships/${internship.id}`,
      }),
  ]),
);
