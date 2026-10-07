import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiError } from '../../lib/api';
import { dateTime, statusLabel } from '../../lib/format';
import { Alert, Button, Card, Field, PageLoading, StatusBadge } from '../../components/ui';
import { useApplication } from '../student/api';
import { openApplicantResume, useChangeStatus } from './api';

// Button wording for each move the API may allow (allowedActions).
const ACTIONS = {
  shortlisted: { label: 'Shortlist', variant: 'primary' },
  interviewed: { label: 'Mark interviewed', variant: 'primary' },
  accepted: { label: 'Accept', variant: 'primary' },
  rejected: { label: 'Reject', variant: 'danger' },
};

// US-06: one applicant. The buttons are exactly the moves the transition table allows from
// here; each one notifies the student (US-07).
export function ApplicantPage() {
  const { postingId, id } = useParams();
  const { data: application, isPending, isError } = useApplication(id);
  const change = useChangeStatus(id);
  const [note, setNote] = useState('');
  // US-09: accepting starts the internship; empty means today.
  const [startDate, setStartDate] = useState('');
  const [message, setMessage] = useState(null);

  if (isPending) return <PageLoading />;
  if (isError) {
    return (
      <main className="page">
        <h1>Application not found</h1>
        <Link to={`/company/postings/${postingId}/applications`}>Back to applicants</Link>
      </main>
    );
  }

  const { student } = application;

  async function move(status) {
    if (status === 'rejected' && !window.confirm(`Reject ${student.fullName ?? 'this applicant'}? They will be notified.`)) return;
    setMessage(null);
    try {
      const accepting = status === 'accepted';
      await change.mutateAsync({ status, note: note.trim() || undefined, ...(accepting && startDate && { startDate }) });
      setNote('');
      setMessage({
        tone: 'success',
        text: accepting
          ? 'Accepted. The internship has started, and the student has been notified. Assign a supervisor from Interns.'
          : `Moved to ${statusLabel(status)}. The student has been notified.`,
      });
    } catch (err) {
      setMessage({ tone: 'error', text: apiError(err).message });
    }
  }

  async function viewResume() {
    try {
      await openApplicantResume(id);
    } catch (err) {
      setMessage({ tone: 'error', text: apiError(err).message });
    }
  }

  return (
    <main className="page page--medium">
      <p>
        <Link to={`/company/postings/${postingId}/applications`}>← Applicants</Link>
      </p>
      <header className="page__header">
        <div>
          <h1>{student.fullName ?? student.email}</h1>
          <p className="muted">Applied for {application.posting.title}</p>
        </div>
        <StatusBadge status={application.status} />
      </header>

      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <Card title="Profile">
        <dl className="facts facts--plain">
          <div>
            <dt>University</dt>
            <dd>{student.university ?? '—'}</dd>
          </div>
          <div>
            <dt>Department</dt>
            <dd>{student.department ?? '—'}</dd>
          </div>
          <div>
            <dt>GPA</dt>
            <dd>{student.gpa ?? '—'}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${student.email}`}>{student.email}</a>
            </dd>
          </div>
        </dl>
        {student.skills.length > 0 && (
          <ul className="tags__list" aria-label="Skills">
            {student.skills.map((s) => (
              <li key={s} className="tag tag--static">
                {s}
              </li>
            ))}
          </ul>
        )}
        <div className="inline-actions">
          {student.hasResume ? (
            <Button variant="secondary" onClick={viewResume}>
              View resume
            </Button>
          ) : (
            <span className="muted">No resume uploaded.</span>
          )}
        </div>
      </Card>

      {application.coverLetter && (
        <Card title="Cover letter">
          <div className="prose">{application.coverLetter}</div>
        </Card>
      )}

      <Card title="Decision">
        {application.allowedActions.length > 0 ? (
          <>
            <Field label="Note to include (optional)" hint="Saved with the status change and shown to the student.">
              {(a11y) => <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} {...a11y} />}
            </Field>
            {application.allowedActions.includes('accepted') && (
              <Field label="Internship start date (if accepting)" hint="Leave empty to start today. It runs for the posting's duration; you can change the dates later.">
                {(a11y) => <input type="date" className="input--short-date" value={startDate} onChange={(e) => setStartDate(e.target.value)} {...a11y} />}
              </Field>
            )}
            <div className="inline-actions">
              {application.allowedActions.map((status) => (
                <Button key={status} variant={ACTIONS[status]?.variant ?? 'secondary'} busy={change.isPending && change.variables?.status === status} onClick={() => move(status)}>
                  {ACTIONS[status]?.label ?? statusLabel(status)}
                </Button>
              ))}
            </div>
          </>
        ) : (
          <p className="muted">This application is {application.status}; there is nothing more to decide.</p>
        )}
      </Card>

      <Card title="History">
        <ol className="timeline">
          {application.history.map((h, i) => (
            <li key={i}>
              <strong>{statusLabel(h.to)}</strong> <time className="muted">{dateTime(h.at)}</time>
              {h.note && <p className="muted">“{h.note}”</p>}
            </li>
          ))}
        </ol>
      </Card>
    </main>
  );
}
