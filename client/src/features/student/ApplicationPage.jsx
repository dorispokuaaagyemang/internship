import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiError } from '../../lib/api';
import { dateTime, statusLabel } from '../../lib/format';
import { Alert, Button, Card, PageLoading, StatusBadge } from '../../components/ui';
import { useApplication, useWithdraw } from './api';

// US-07: status and history, refreshed live. US-08: Withdraw only when the API lists it in
// allowedActions (Applied or Shortlisted); otherwise it is not offered at all.
export function ApplicationPage() {
  const { id } = useParams();
  const { data: application, isPending, isError } = useApplication(id);
  const withdraw = useWithdraw(id);
  const [error, setError] = useState(null);

  if (isPending) return <PageLoading />;
  if (isError) {
    return (
      <main className="page">
        <h1>Application not found</h1>
        <Link to="/applications">Back to my applications</Link>
      </main>
    );
  }

  const canWithdraw = application.allowedActions.includes('withdraw');

  async function onWithdraw() {
    if (!window.confirm('Withdraw this application? The company will be told, and you cannot undo it.')) return;
    setError(null);
    try {
      await withdraw.mutateAsync();
    } catch (err) {
      setError(apiError(err).message);
    }
  }

  return (
    <main className="page page--medium">
      <p>
        <Link to="/applications">← My applications</Link>
      </p>
      <header className="page__header">
        <div>
          <h1>{application.posting.title}</h1>
          <p className="muted">{application.posting.company?.name}</p>
        </div>
        <StatusBadge status={application.status} />
      </header>

      <Alert>{error}</Alert>

      <Card title="Progress">
        <ol className="timeline">
          {application.history.map((h, i) => (
            <li key={i}>
              <strong>{statusLabel(h.to)}</strong> <time className="muted">{dateTime(h.at)}</time>
              {h.note && <p className="muted">“{h.note}”</p>}
            </li>
          ))}
        </ol>
        {canWithdraw ? (
          <Button variant="danger" busy={withdraw.isPending} onClick={onWithdraw}>
            Withdraw application
          </Button>
        ) : (
          ['accepted', 'rejected'].includes(application.status) && (
            <p className="muted">This application is {application.status}, so it can no longer be withdrawn.</p>
          )
        )}
      </Card>

      {application.coverLetter && (
        <Card title="Your cover letter">
          <div className="prose">{application.coverLetter}</div>
        </Card>
      )}

      <p>
        <Link to={`/internships/${application.posting.id}`}>View the internship</Link>
      </p>
    </main>
  );
}
