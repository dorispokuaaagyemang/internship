import { Link } from 'react-router-dom';
import { Card } from '../../components/ui';
import { dateTime, statusLabel } from '../../lib/format';
import { SystemStatus } from '../system/SystemStatus';
import { useStats } from './api';

function Stat({ label, value, sub, to }) {
  const body = (
    <>
      <span className="stat__value">{value ?? '—'}</span>
      <span className="stat__label">{label}</span>
      {sub && <span className="stat__sub">{sub}</span>}
    </>
  );
  return <li className="stat">{to ? <Link to={to}>{body}</Link> : body}</li>;
}

// US-12: counts of active students, companies, postings and applications (cached for 60 s).
export function OverviewPage() {
  const { data: s, isPending, isError } = useStats();

  return (
    <main className="page">
      <h1>Admin overview</h1>
      {isPending && <p className="muted">Loading…</p>}
      {isError && <p className="alert alert--error">Could not load the counts.</p>}
      {s && (
        <>
          <ul className="stats" aria-label="Platform counts">
            <Stat label="Active students" value={s.students.active} sub={`${s.students.total} registered`} to="/admin/users?role=student&status=active" />
            <Stat
              label="Verified companies"
              value={s.companies.verified}
              sub={s.companies.pending ? `${s.companies.pending} awaiting verification` : 'none awaiting verification'}
              to="/admin/companies"
            />
            <Stat label="Active postings" value={s.postings.active} sub={`${s.postings.total} in total`} />
            <Stat label="Applications" value={s.applications.total} sub={`${s.applications.applied ?? 0} awaiting review`} />
          </ul>
          <Card title="Applications by status">
            <ul className="inline-list">
              {['applied', 'shortlisted', 'interviewed', 'accepted', 'rejected', 'withdrawn'].map((k) => (
                <li key={k}>
                  {statusLabel(k)}: <strong>{s.applications[k] ?? 0}</strong>
                </li>
              ))}
            </ul>
            <p className="muted small">
              {s.users.suspended} suspended {s.users.suspended === 1 ? 'account' : 'accounts'} · {s.users.pending} awaiting email verification · counts as of{' '}
              {dateTime(s.generatedAt)}
            </p>
          </Card>
        </>
      )}
      <Card title="System status">
        <SystemStatus />
      </Card>
    </main>
  );
}
