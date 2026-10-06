import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiError } from '../../lib/api';
import { date, deadlineText, statusLabel } from '../../lib/format';
import { Alert, Button, StatusBadge } from '../../components/ui';
import { useClosePosting, useMyPostings, usePublishPosting } from './api';

const PAGE_SIZE = 20;

// US-05: every posting of the company, and the move each one allows next:
// draft -> Edit / Publish, active -> Applicants / Close, closed -> Applicants.
export function PostingsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const page = Number(params.get('page')) || 1;
  const { data, isPending, error } = useMyPostings({ status: status || undefined, page, limit: PAGE_SIZE });
  const publish = usePublishPosting();
  const close = useClosePosting();
  const [message, setMessage] = useState(params.get('saved') ? { tone: 'success', text: 'Draft saved. Publish it when you are ready.' } : null);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  async function run(action, posting, success) {
    setMessage(null);
    try {
      await action.mutateAsync(posting.id);
      setMessage({ tone: 'success', text: success });
    } catch (err) {
      setMessage({ tone: 'error', text: apiError(err).message });
    }
  }

  const set = (changes) => {
    const next = new URLSearchParams(params);
    next.delete('saved');
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    setParams(next);
  };

  return (
    <main className="page">
      <header className="page__header">
        <h1>Postings</h1>
        <div className="inline-actions">
          <label className="inline-field">
            Status{' '}
            <select value={status} onChange={(e) => set({ status: e.target.value, page: '' })}>
              <option value="">All</option>
              {['draft', 'active', 'closed'].map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <Link className="btn btn--primary" to="/company/postings/new">
            New posting
          </Link>
        </div>
      </header>

      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {isPending && <p className="muted">Loading…</p>}
      {error && <Alert>{apiError(error).code === 'COMPANY_REQUIRED' ? 'Register your company first.' : 'Could not load your postings.'}</Alert>}
      {data && data.items.length === 0 && <p className="empty">No postings{status && ` that are ${status}`} yet.</p>}

      {data && data.items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Deadline</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.title}
                  <div className="muted small">
                    {p.location} · {p.domain}
                  </div>
                </td>
                <td>
                  {date(p.deadline)}
                  {p.status === 'active' && <div className="muted small">{deadlineText(p.deadline)}</div>}
                </td>
                <td>
                  <StatusBadge status={p.status} />
                </td>
                <td className="actions">
                  {p.status === 'draft' && (
                    <>
                      <Link to={`/company/postings/${p.id}/edit`}>Edit</Link>
                      <Button
                        variant="secondary"
                        busy={publish.isPending && publish.variables === p.id}
                        onClick={() => run(publish, p, `“${p.title}” is now live for students.`)}
                      >
                        Publish
                      </Button>
                    </>
                  )}
                  {p.status !== 'draft' && <Link to={`/company/postings/${p.id}/applications`}>Applicants</Link>}
                  {p.status === 'active' && (
                    <Button
                      variant="link"
                      busy={close.isPending && close.variables === p.id}
                      onClick={() =>
                        window.confirm(`Close “${p.title}”? It stops accepting applications.`) && run(close, p, `“${p.title}” is closed.`)
                      }
                    >
                      Close
                    </Button>
                  )}
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
