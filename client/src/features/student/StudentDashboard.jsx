import { Link } from 'react-router-dom';
import { Card, StatusBadge } from '../../components/ui';
import { date } from '../../lib/format';
import { useMyApplications, useProfile } from './api';

const FIELD_NAMES = { fullName: 'full name', university: 'university', department: 'department' };

export function StudentDashboard() {
  const profile = useProfile();
  const applications = useMyApplications({ limit: 5, page: 1 });
  const completeness = profile.data?.completeness;

  return (
    <main className="page">
      <h1>Dashboard</h1>

      {completeness && !completeness.complete && (
        <Card title="Finish your profile">
          <p>
            You need your {completeness.missing.map((f) => FIELD_NAMES[f] ?? f).join(', ')} before you can apply.
          </p>
          <Link className="btn btn--primary" to="/profile">
            Complete profile
          </Link>
        </Card>
      )}
      {profile.data?.profile && !profile.data.profile.resume && completeness?.complete && (
        <Card title="Add your resume">
          <p>Companies see it when you apply. <Link to="/profile">Upload a PDF or Word file</Link></p>
        </Card>
      )}

      <Card title="Recent applications" actions={<Link to="/applications">See all</Link>}>
        {applications.isPending && <p className="muted">Loading…</p>}
        {applications.data?.items.length === 0 && (
          <p>
            No applications yet. <Link to="/internships">Find internships</Link>
          </p>
        )}
        {applications.data?.items.length > 0 && (
          <ul className="list list--plain">
            {applications.data.items.map((a) => (
              <li key={a.id} className="list__item">
                <div>
                  <Link to={`/applications/${a.id}`}>{a.posting?.title}</Link>
                  <span className="muted"> · {a.posting?.company?.name} · {date(a.createdAt)}</span>
                </div>
                <StatusBadge status={a.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p>
        <Link className="btn btn--secondary" to="/internships">
          Find internships
        </Link>
      </p>
    </main>
  );
}
