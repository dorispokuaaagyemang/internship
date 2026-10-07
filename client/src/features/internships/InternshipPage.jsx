import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiError } from '../../lib/api';
import { applyServerErrors } from '../../lib/forms';
import { date, dateTime, statusLabel } from '../../lib/format';
import { Alert, Button, Card, Field, PageLoading, StatusBadge } from '../../components/ui';
import {
  openCertificate,
  openInternResume,
  useAddEvaluation,
  useAssignSupervisor,
  useComplete,
  useEvaluations,
  useInternship,
  useStaff,
  useUpdateDates,
} from './api';

const ATTENDANCE = ['excellent', 'good', 'fair', 'poor'];

// Mirrors server/src/modules/internships/validators.js (US-10).
const evaluationSchema = z.object({
  period: z.string().trim().min(1, 'Period is required, e.g. "Week 4"').max(50),
  rating: z.string().regex(/^[1-5]$/, 'Choose a rating from 1 to 5'),
  attendance: z.enum(ATTENDANCE, { message: 'Choose the attendance' }),
  comments: z.string().trim().min(1, 'Comments are required').max(5000),
  isFinal: z.boolean(),
});

// US-10: the active supervisor's form. Saved evaluations can't be changed, so it says so.
function EvaluationForm({ internshipId }) {
  const add = useAddEvaluation(internshipId);
  const [message, setMessage] = useState(null);
  const form = useForm({
    resolver: zodResolver(evaluationSchema),
    defaultValues: { period: '', rating: '', attendance: '', comments: '', isFinal: false },
  });
  const { register, handleSubmit, formState, reset } = form;
  const e = formState.errors;

  const onSubmit = handleSubmit(async (values) => {
    setMessage(null);
    if (values.isFinal && !window.confirm('Submit this as the final evaluation? Evaluations cannot be edited once saved.')) return;
    try {
      await add.mutateAsync({ ...values, rating: Number(values.rating) });
      reset();
      setMessage({ tone: 'success', text: 'Evaluation saved. The intern can now read it.' });
    } catch (err) {
      setMessage({ tone: 'error', text: applyServerErrors(err, form.setError, Object.keys(evaluationSchema.shape)).message });
    }
  });

  return (
    <Card title="Add an evaluation">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <form onSubmit={onSubmit} noValidate className="stack">
        <div className="grid-2">
          <Field label="Period" error={e.period?.message} hint='e.g. "Week 4" or "Final"'>
            {(a11y) => <input {...a11y} {...register('period')} />}
          </Field>
          <Field label="Attendance" error={e.attendance?.message}>
            {(a11y) => (
              <select {...a11y} {...register('attendance')}>
                <option value="">Choose…</option>
                {ATTENDANCE.map((a) => (
                  <option key={a} value={a}>
                    {statusLabel(a)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <fieldset className="choice choice--inline">
          <legend>Performance rating</legend>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n}>
              <input type="radio" value={String(n)} {...register('rating')} /> {n}
            </label>
          ))}
          <span className="muted small">1 = poor, 5 = excellent</span>
          {e.rating && <p className="field__error">{e.rating.message}</p>}
        </fieldset>
        <Field label="Comments" error={e.comments?.message}>
          {(a11y) => <textarea rows={5} {...a11y} {...register('comments')} />}
        </Field>
        <label className="checkbox">
          <input type="checkbox" {...register('isFinal')} /> This is the final evaluation (needed for the certificate)
        </label>
        <p className="field__hint">Evaluations are timestamped and cannot be edited once saved.</p>
        <div>
          <Button type="submit" busy={formState.isSubmitting}>
            Save evaluation
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Evaluations({ internshipId, viewerRole }) {
  const { data, isPending } = useEvaluations(internshipId);
  return (
    <Card title="Evaluations">
      {viewerRole === 'student' && <p className="muted small">Written by your supervisor. They are read-only.</p>}
      {isPending && <p className="muted">Loading…</p>}
      {data?.length === 0 && <p className="muted">No evaluations yet.</p>}
      {data?.length > 0 && (
        <ol className="evaluations">
          {data.map((ev) => (
            <li key={ev.id} className="evaluation">
              <header>
                <strong>{ev.period}</strong>
                {ev.isFinal && <span className="badge badge--accepted">Final</span>}
                <span className="rating" aria-label={`Rating ${ev.rating} out of 5`}>
                  {'★'.repeat(ev.rating)}
                  <span className="rating__empty">{'★'.repeat(5 - ev.rating)}</span>
                </span>
              </header>
              <p className="muted small">
                Attendance: {statusLabel(ev.attendance)} · {ev.supervisor?.fullName ?? 'Supervisor'} · <time dateTime={ev.createdAt}>{dateTime(ev.createdAt)}</time>
              </p>
              <div className="prose">{ev.comments}</div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// US-09: the company picks the supervisor from its staff list.
function SupervisorPicker({ internship }) {
  const staff = useStaff();
  const assign = useAssignSupervisor(internship.id);
  const [choice, setChoice] = useState('');
  const [message, setMessage] = useState(null);
  const supervisors = (staff.data ?? []).filter((m) => m.memberRole === 'supervisor' && m.status !== 'suspended');

  async function onAssign(e) {
    e.preventDefault();
    setMessage(null);
    try {
      await assign.mutateAsync(Number(choice));
      setChoice('');
      setMessage({ tone: 'success', text: 'Supervisor assigned. They and the intern have been notified.' });
    } catch (err) {
      setMessage({ tone: 'error', text: apiError(err).message });
    }
  }

  if (staff.data && supervisors.length === 0) {
    return (
      <p className="muted">
        No supervisors on your staff yet. <Link to="/company/staff">Add one</Link>.
      </p>
    );
  }
  return (
    <form onSubmit={onAssign} className="inline-actions">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <label className="inline-field">
        <span>{internship.supervisor ? 'Change to' : 'Assign'}</span>
        <select value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Choose a supervisor…</option>
          {supervisors
            .filter((m) => m.id !== internship.supervisor?.id)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName ?? m.email}
                {m.status === 'invited' ? ' (invited)' : ''} · {m.activeInterns} {m.activeInterns === 1 ? 'intern' : 'interns'}
              </option>
            ))}
        </select>
      </label>
      <Button type="submit" disabled={!choice} busy={assign.isPending}>
        {internship.supervisor ? 'Change supervisor' : 'Assign'}
      </Button>
    </form>
  );
}

// The company can move the dates while the internship is ongoing.
function DatesEditor({ internship }) {
  const update = useUpdateDates(internship.id);
  const [editing, setEditing] = useState(false);
  const [dates, setDates] = useState({ startDate: internship.startDate, endDate: internship.endDate });
  const [error, setError] = useState(null);

  if (!editing) {
    return (
      <Button variant="link" onClick={() => setEditing(true)}>
        Change dates
      </Button>
    );
  }
  async function save(e) {
    e.preventDefault();
    setError(null);
    try {
      await update.mutateAsync(dates);
      setEditing(false);
    } catch (err) {
      setError(apiError(err).message);
    }
  }
  return (
    <form onSubmit={save} className="stack">
      <Alert>{error}</Alert>
      <div className="grid-2">
        <label className="field">
          Start date
          <input type="date" value={dates.startDate} onChange={(e) => setDates((d) => ({ ...d, startDate: e.target.value }))} />
        </label>
        <label className="field">
          End date
          <input type="date" value={dates.endDate} onChange={(e) => setDates((d) => ({ ...d, endDate: e.target.value }))} />
        </label>
      </div>
      <div className="inline-actions">
        <Button type="submit" busy={update.isPending}>
          Save dates
        </Button>
        <Button type="button" variant="link" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// US-11: the supervisor (or an admin) confirms; the server says what is still missing, if anything.
function Completion({ internship }) {
  const complete = useComplete(internship.id);
  const [problem, setProblem] = useState(null);

  async function onComplete() {
    if (!window.confirm('Confirm that this internship is complete? A certificate will be issued to the intern.')) return;
    setProblem(null);
    try {
      await complete.mutateAsync();
    } catch (err) {
      setProblem(apiError(err));
    }
  }

  return (
    <Card title="Completion">
      <p className="muted">
        Once the end date ({date(internship.endDate)}) has passed and a final evaluation is saved, confirm completion to issue the certificate.
      </p>
      {problem && (
        <Alert>
          {problem.code === 'CERTIFICATE_NOT_READY' ? (
            <>
              Not yet:
              <ul>
                {Object.values(problem.fields).map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </>
          ) : (
            problem.message
          )}
        </Alert>
      )}
      <Button onClick={onComplete} busy={complete.isPending}>
        Confirm completion
      </Button>
    </Card>
  );
}

function CertificateCard({ internship }) {
  const [error, setError] = useState(null);
  if (internship.status !== 'completed') return null;

  async function download() {
    setError(null);
    try {
      await openCertificate(internship.id);
    } catch (err) {
      setError(apiError(err).message);
    }
  }

  return (
    <Card title="Certificate">
      <Alert>{error}</Alert>
      {internship.certificate ? (
        <div className="inline-actions">
          <Button onClick={download}>Download certificate (PDF)</Button>
          <span className="muted small">
            Serial no. {internship.certificate.serialNo} · issued {date(internship.certificate.issuedAt)}
          </span>
        </div>
      ) : (
        <p className="muted" aria-live="polite">
          Completed {date(internship.completedAt)}. The certificate is being prepared; this page updates by itself.
        </p>
      )}
    </Card>
  );
}

// One page for everyone involved in an internship; what it offers depends on `viewerRole`,
// which the API sets: 'student', 'company', 'supervisor' or 'admin'.
export function InternshipPage({ backTo, backLabel }) {
  const { id } = useParams();
  const { data: internship, isPending, isError } = useInternship(id);
  const [resumeError, setResumeError] = useState(null);

  if (isPending) return <PageLoading />;
  if (isError) {
    return (
      <main className="page">
        <h1>Internship not found</h1>
        <Link to={backTo}>{backLabel}</Link>
      </main>
    );
  }

  const { viewerRole: role, student, supervisor } = internship;
  const ongoing = internship.status === 'ongoing';

  async function viewResume() {
    setResumeError(null);
    try {
      await openInternResume(internship.id);
    } catch (err) {
      setResumeError(apiError(err).message);
    }
  }

  return (
    <main className="page page--medium">
      <p>
        <Link to={backTo}>← {backLabel}</Link>
      </p>
      <header className="page__header">
        <div>
          <h1>{role === 'student' ? internship.posting.title : (student.fullName ?? student.email)}</h1>
          <p className="muted">
            {role === 'student' ? internship.company.name : `${internship.posting.title} · ${internship.company.name}`}
          </p>
        </div>
        <StatusBadge status={internship.status} />
      </header>

      <Card title="Details">
        <dl className="facts facts--plain">
          <div>
            <dt>Dates</dt>
            <dd>
              {date(internship.startDate)} – {date(internship.endDate)}
            </dd>
          </div>
          <div>
            <dt>Supervisor</dt>
            <dd>{supervisor ? (supervisor.fullName ?? supervisor.email) : <span className="muted">Not assigned yet</span>}</dd>
          </div>
          {supervisor && role !== 'supervisor' && (
            <div>
              <dt>Supervisor email</dt>
              <dd>
                <a href={`mailto:${supervisor.email}`}>{supervisor.email}</a>
              </dd>
            </div>
          )}
        </dl>
        {role === 'company' && ongoing && (
          <div className="stack">
            <DatesEditor internship={internship} />
            <SupervisorPicker internship={internship} />
          </div>
        )}
      </Card>

      {(role === 'company' || role === 'supervisor' || role === 'admin') && (
        <Card title="Intern">
          <Alert>{resumeError}</Alert>
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
          {student.skills?.length > 0 && (
            <ul className="tags__list" aria-label="Skills">
              {student.skills.map((s) => (
                <li key={s} className="tag tag--static">
                  {s}
                </li>
              ))}
            </ul>
          )}
          {student.hasResume && (
            <Button variant="secondary" onClick={viewResume}>
              View resume
            </Button>
          )}
        </Card>
      )}

      <CertificateCard internship={internship} />
      {(role === 'supervisor' || role === 'admin') && ongoing && <Completion internship={internship} />}
      {role === 'supervisor' && ongoing && <EvaluationForm internshipId={internship.id} />}
      <Evaluations internshipId={internship.id} viewerRole={role} />
    </main>
  );
}
