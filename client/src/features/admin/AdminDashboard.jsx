import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiError } from '../../lib/api';
import { date, statusLabel } from '../../lib/format';
import { Alert, Button, Card, StatusBadge } from '../../components/ui';
import { SystemStatus } from '../system/SystemStatus';
import { useAdminCompanies, useApproveCompany } from './api';

const TABS = [
  { status: 'pending_verification', label: 'Awaiting verification' },
  { status: 'verified', label: 'Verified' },
  { status: 'suspended', label: 'Suspended' },
  { status: '', label: 'All' },
];
const PAGE_SIZE = 20;

// US-04: approve pending companies, oldest first, so they can post. Every approval is
// audited on the server with this admin's id (US-12).
function CompanyQueue() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'pending_verification';
  const page = Number(params.get('page')) || 1;
  const { data, isPending, isError } = useAdminCompanies({ status: status || undefined, page, limit: PAGE_SIZE });
  const approve = useApproveCompany();
  const [message, setMessage] = useState(null);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const show = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) next.set(k, v);
    setParams(next);
  };

  async function onApprove(company) {
    if (!window.confirm(`Approve ${company.name} (${company.regNumber})? Its representatives will be able to post internships.`)) return;
    setMessage(null);
    try {
      await approve.mutateAsync(company.id);
      setMessage({ tone: 'success', text: `${company.name} is verified. Its representatives have been notified.` });
    } catch (err) {
      setMessage({ tone: 'error', text: apiError(err).message });
    }
  }

  return (
    <Card title="Companies">
      <div className="tabs" role="tablist" aria-label="Company status">
        {TABS.map((tab) => (
          <button
            key={tab.label}
            type="button"
            role="tab"
            aria-selected={status === tab.status}
            className={status === tab.status ? 'tab tab--active' : 'tab'}
            onClick={() => show({ status: tab.status, page: '1' })}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {isPending && <p className="muted">Loading…</p>}
      {isError && <Alert>Could not load companies.</Alert>}
      {data && data.items.length === 0 && (
        <p className="empty">{status === 'pending_verification' ? 'No companies are waiting. All caught up.' : 'No companies here.'}</p>
      )}

      {data && data.items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Company</th>
              <th scope="col">Representative</th>
              <th scope="col">Registered</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.name}</strong>
                  <div className="muted small">
                    Reg. {c.regNumber}
                    {c.website && (
                      <>
                        {' · '}
                        <a href={c.website} target="_blank" rel="noopener noreferrer">
                          website
                        </a>
                      </>
                    )}
                  </div>
                </td>
                <td className="small">
                  {c.reps.map((r) => (
                    <div key={r.id}>
                      <a href={`mailto:${r.email}`}>{r.email}</a>
                      <div className="muted">{r.phone}</div>
                    </div>
                  ))}
                </td>
                <td>{date(c.createdAt)}</td>
                <td>
                  <StatusBadge status={c.status} />
                  {c.verifiedAt && <div className="muted small">{date(c.verifiedAt)}</div>}
                </td>
                <td className="actions">
                  {c.status === 'pending_verification' && (
                    <Button busy={approve.isPending && approve.variables === c.id} onClick={() => onApprove(c)}>
                      Approve
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
          <Button variant="secondary" disabled={page <= 1} onClick={() => show({ page: String(page - 1) })}>
            Previous
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => show({ page: String(page + 1) })}>
            Next
          </Button>
        </nav>
      )}
      {data && status && <p className="muted small">{data.total} {statusLabel(status).toLowerCase()} in total.</p>}
    </Card>
  );
}

export function AdminDashboard() {
  return (
    <main className="page">
      <h1>Admin</h1>
      <CompanyQueue />
      <Card title="System status">
        <SystemStatus />
      </Card>
    </main>
  );
}
