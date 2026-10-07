import { Link, useSearchParams } from 'react-router-dom';
import { Button, StatusBadge } from '../../components/ui';
import { date } from '../../lib/format';
import { useInternships } from './api';

const PAGE_SIZE = 20;

// The viewer's internships (GET /internships is role-aware): a student's own, the company's
// interns, or a supervisor's current interns. `linkTo(id)` builds each row's link.
export function InternshipsListPage({ title, linkTo, empty, showStudent = true }) {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const page = Number(params.get('page')) || 1;
  const { data, isPending, isError } = useInternships({ status: status || undefined, page, limit: PAGE_SIZE });
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const set = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    setParams(next);
  };

  return (
    <main className="page">
      <header className="page__header">
        <h1>{title}</h1>
        <label className="inline-field">
          Status{' '}
          <select value={status} onChange={(e) => set({ status: e.target.value, page: '' })}>
            <option value="">All</option>
            <option value="ongoing">Ongoing</option>
            <option value="completed">Completed</option>
          </select>
        </label>
      </header>

      {isPending && <p className="muted">Loading…</p>}
      {isError && <p className="alert alert--error">Could not load internships.</p>}
      {data && data.items.length === 0 && <p className="empty">{empty}</p>}
      {data && data.items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{showStudent ? 'Intern' : 'Internship'}</th>
              <th scope="col">{showStudent ? 'Internship' : 'Company'}</th>
              <th scope="col">Dates</th>
              <th scope="col">Supervisor</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i) => (
              <tr key={i.id}>
                <td>
                  <Link to={linkTo(i.id)}>{showStudent ? (i.student.fullName ?? i.student.email) : i.posting.title}</Link>
                </td>
                <td>{showStudent ? i.posting.title : i.company.name}</td>
                <td className="small">
                  {date(i.startDate)} – {date(i.endDate)}
                </td>
                <td>{i.supervisor ? (i.supervisor.fullName ?? i.supervisor.email) : <span className="muted">Not assigned</span>}</td>
                <td>
                  <StatusBadge status={i.status} />
                  {i.certificate && <div className="muted small">Certificate issued</div>}
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
