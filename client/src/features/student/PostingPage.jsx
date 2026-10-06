import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { apiError } from '../../lib/api';
import { date, deadlineText, money } from '../../lib/format';
import { Alert, Button, Card, Field, PageLoading, StatusBadge } from '../../components/ui';
import { needsVerification, useAuth } from '../auth/auth-context';
import { useApply, usePosting } from './api';

const FIELD_NAMES = { fullName: 'full name', university: 'university', department: 'department' };

// US-03: apply. The server checks the profile, the deadline and duplicates; each answer is
// turned into a next step here.
function ApplyPanel({ posting }) {
  const { status, user } = useAuth();
  const location = useLocation();
  const apply = useApply(posting.id);
  const [coverLetter, setCoverLetter] = useState('');
  const [problem, setProblem] = useState(null);

  const open = posting.status === 'active' && new Date(posting.deadline) > new Date();
  if (!open) return <Alert tone="info">This internship is closed and no longer accepts applications.</Alert>;

  if (status !== 'signedIn') {
    return (
      <Card title="Interested?">
        <p>Sign in as a student to apply.</p>
        <Link className="btn btn--primary" to={`/login?next=${encodeURIComponent(location.pathname)}`}>
          Sign in to apply
        </Link>
      </Card>
    );
  }
  if (user.role !== 'student') return null;
  if (needsVerification(user)) {
    return (
      <Alert tone="info">
        Confirm your email address before applying. <Link to="/verify">See how</Link>
      </Alert>
    );
  }

  if (apply.isSuccess) {
    return (
      <Alert tone="success">
        Application sent. Its status is Applied, and we emailed you a confirmation.{' '}
        <Link to={`/applications/${apply.data.id}`}>Follow it here</Link>
      </Alert>
    );
  }

  async function submit(e) {
    e.preventDefault();
    setProblem(null);
    try {
      await apply.mutateAsync({ coverLetter });
    } catch (err) {
      setProblem(apiError(err));
    }
  }

  return (
    <Card title="Apply">
      {problem?.code === 'PROFILE_INCOMPLETE' && (
        <Alert>
          Complete your profile first. Missing: {Object.keys(problem.fields).map((f) => FIELD_NAMES[f] ?? f).join(', ')}.{' '}
          <Link to="/profile">Go to your profile</Link>
        </Alert>
      )}
      {problem?.code === 'ALREADY_APPLIED' && (
        <Alert tone="info">
          You have already applied to this internship. <Link to="/applications">See your applications</Link>
        </Alert>
      )}
      {problem && !['PROFILE_INCOMPLETE', 'ALREADY_APPLIED'].includes(problem.code) && <Alert>{problem.message}</Alert>}
      <form onSubmit={submit} className="stack">
        <Field label="Cover letter (optional)" hint="A few lines on why you fit this internship.">
          {(a11y) => <textarea {...a11y} maxLength={5000} value={coverLetter} onChange={(e) => setCoverLetter(e.target.value)} />}
        </Field>
        <div>
          <Button type="submit" busy={apply.isPending}>
            Submit application
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function PostingPage() {
  const { id } = useParams();
  const { data: posting, isPending, isError } = usePosting(id);

  if (isPending) return <PageLoading />;
  if (isError) {
    return (
      <main className="page">
        <h1>Internship not found</h1>
        <Link to="/internships">Back to search</Link>
      </main>
    );
  }

  return (
    <main className="page page--medium">
      <p>
        <Link to="/internships">← All internships</Link>
      </p>
      <header className="page__header">
        <div>
          <h1>{posting.title}</h1>
          <p className="muted">
            {posting.company?.name}
            {posting.company?.website && (
              <>
                {' · '}
                <a href={posting.company.website} target="_blank" rel="noopener noreferrer">
                  Website
                </a>
              </>
            )}
          </p>
        </div>
        {posting.status !== 'active' && <StatusBadge status={posting.status} />}
      </header>

      <dl className="facts">
        <div>
          <dt>Location</dt>
          <dd>{posting.location}</dd>
        </div>
        <div>
          <dt>Domain</dt>
          <dd>{posting.domain}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{posting.durationWeeks} weeks</dd>
        </div>
        <div>
          <dt>Stipend</dt>
          <dd>
            {money(posting.stipend, posting.stipendCurrency)}
            {posting.stipend > 0 && ' / month'}
          </dd>
        </div>
        <div>
          <dt>Apply by</dt>
          <dd>
            {date(posting.deadline)} <span className="muted">({deadlineText(posting.deadline)})</span>
          </dd>
        </div>
      </dl>

      {posting.skills.length > 0 && (
        <>
          <h2>Required skills</h2>
          <ul className="tags__list">
            {posting.skills.map((s) => (
              <li key={s} className="tag tag--static">
                {s}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>About the internship</h2>
      <div className="prose">{posting.description}</div>

      <ApplyPanel posting={posting} />
    </main>
  );
}
