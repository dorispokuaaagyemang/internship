import { Link, useSearchParams } from 'react-router-dom';
import { Button, StatusBadge } from '../../components/ui';
import { date, statusLabel } from '../../lib/format';
import { useMyApplications } from './api';

const STATUSES = ['applied', 'shortlisted', 'interviewed', 'accepted', 'rejected', 'withdrawn'];
const PAGE_SIZE = 20;

// US-07: every application and where it stands. Live notifications refresh this list.
export function ApplicationsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const page = Number(params.get('page')) || 1;
  const { data, isPending, isError } = useMyApplications({ status: status || undefined, page, limit: PAGE_SIZE });
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const set = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    setParams(next);
  };

  return (
    <main className="page">
      <header className="page__header">
        <h1>My applications</h1>
        <label className="inline-field">
          Status{' '}
          <select value={status} onChange={(e) => set({ status: e.target.value, page: '' })}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </label>
      </header>

      {isPending && <p className="muted">Loading…</p>}
      {isError && <p className="alert alert--error">Could not load your applications.</p>}
      {data && data.items.length === 0 && (
        <p className="empty">
          {status ? 'No applications with this status.' : "You haven't applied to anything yet."}{' '}
          <Link to="/internships">Find internships</Link>
        </p>
      )}
      {data && data.items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Internship</th>
              <th scope="col">Company</th>
              <th scope="col">Applied</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link to={`/applications/${a.id}`}>{a.posting?.title}</Link>
                </td>
                <td>{a.posting?.company?.name}</td>
                <td>{date(a.createdAt)}</td>
                <td>
                  <StatusBadge status={a.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pages > 1 && (
        <nav className="pager" aria-label="Pages">
          <Button variant="secondary" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
            Previous
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>
            Next
          </Button>
        </nav>
      )}
    </main>
  );
}
