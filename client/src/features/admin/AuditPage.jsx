import { useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { useAuditLogs } from './api';

const PAGE_SIZE = 50;
// Prefixes end in a dot and match every action in the group (server: Op.startsWith).
const ACTIONS = [
  { value: '', label: 'All actions' },
  { value: 'admin.', label: 'Admin actions' },
  { value: 'auth.', label: 'Sign-in and account events' },
  { value: 'company.', label: 'Company events' },
  { value: 'internship.', label: 'Internship events' },
  { value: 'auth.login_failed', label: 'Failed sign-ins' },
  { value: 'admin.user_suspended', label: 'Suspensions' },
];

const describe = (e) => {
  const parts = [];
  if (e.entityType) parts.push(`${e.entityType} #${e.entityId}`);
  if (e.metadata?.reason) parts.push(`reason: “${e.metadata.reason}”`);
  if (e.metadata?.email && e.action !== 'auth.login_failed') parts.push(e.metadata.email);
  if (e.action === 'auth.login_failed' && e.metadata?.email) parts.push(`tried ${e.metadata.email}`);
  return parts.join(' · ');
};

// US-12: every admin action and auth event, with who, when and from where. Read-only.
export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const action = params.get('action') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Number(params.get('page')) || 1;
  const { data, isPending, isError } = useAuditLogs({
    action: action || undefined,
    // Whole days: from the start of `from` to the end of `to`, local time.
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
    page,
    limit: PAGE_SIZE,
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const set = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    setParams(next);
  };

  return (
    <main className="page">
      <h1>Audit log</h1>
      <div className="search">
        <label>
          <span className="sr-only">Action</span>
          <select value={action} onChange={(e) => set({ action: e.target.value, page: '' })}>
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">From</span>
          <input type="date" value={from} onChange={(e) => set({ from: e.target.value, page: '' })} aria-label="From date" />
        </label>
        <label>
          <span className="sr-only">To</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => set({ to: e.target.value, page: '' })} aria-label="To date" />
        </label>
      </div>

      {isPending && <p className="muted">Loading…</p>}
      {isError && <p className="alert alert--error">Could not load the audit log.</p>}
      {data && data.items.length === 0 && <p className="empty">No entries match.</p>}
      {data && data.items.length > 0 && (
        <table className="table table--dense">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Action</th>
              <th scope="col">By</th>
              <th scope="col">Details</th>
              <th scope="col">IP</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((e) => (
              <tr key={e.id}>
                <td className="small">
                  <time dateTime={e.createdAt}>{dateTime(e.createdAt)}</time>
                </td>
                <td>
                  <code>{e.action}</code>
                </td>
                <td className="small">
                  {e.actor ? e.actor.email : <span className="muted">—</span>}
                  {e.actorRole && <div className="muted">{e.actorRole}</div>}
                </td>
                <td className="small">{describe(e)}</td>
                <td className="small muted">{e.ip ?? '—'}</td>
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
