import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiError } from '../../lib/api';
import { date, statusLabel } from '../../lib/format';
import { Alert, Button, StatusBadge } from '../../components/ui';
import { useAdminUsers, useDeleteUser, useReinstateUser, useSuspendUser } from './api';
import { askReason } from './reason';

const ROLE_NAMES = { student: 'Student', company_rep: 'Company rep', supervisor: 'Supervisor', admin: 'Admin' };
const PAGE_SIZE = 25;

// US-12: find any account; suspend it (loses login, posting and applying at once), reinstate
// it, or delete it. Admin accounts are not changed here.
export function UsersPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const role = params.get('role') ?? '';
  const status = params.get('status') ?? '';
  const page = Number(params.get('page')) || 1;
  const { data, isPending, isError, isFetching } = useAdminUsers({ q: q || undefined, role: role || undefined, status: status || undefined, page, limit: PAGE_SIZE });
  const suspend = useSuspendUser();
  const reinstate = useReinstateUser();
  const remove = useDeleteUser();
  const [message, setMessage] = useState(null);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const busy = (mutation, id) => mutation.isPending && (mutation.variables === id || mutation.variables?.id === id);

  const set = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    setParams(next);
  };

  function onSearch(e) {
    e.preventDefault();
    set({ q: String(new FormData(e.currentTarget).get('q') ?? '').trim(), page: '' });
  }

  async function run(action, success) {
    setMessage(null);
    try {
      await action();
      setMessage({ tone: 'success', text: success });
    } catch (err) {
      setMessage({ tone: 'error', text: apiError(err).message });
    }
  }

  const label = (u) => u.name ?? u.email;
  function onSuspend(u) {
    const reason = askReason(`Suspend ${label(u)}? They lose access immediately: signed out everywhere, no posting or applying.`);
    if (reason) run(() => suspend.mutateAsync({ id: u.id, reason }), `${label(u)} is suspended.`);
  }
  function onReinstate(u) {
    if (window.confirm(`Reinstate ${label(u)}?`)) run(() => reinstate.mutateAsync(u.id), `${label(u)} is reinstated.`);
  }
  function onDelete(u) {
    const reason = askReason(`Delete ${label(u)}'s account? They can no longer sign in. Their records stay for the audit trail.`);
    if (reason) run(() => remove.mutateAsync({ id: u.id, reason }), `${label(u)}'s account is deleted.`);
  }

  return (
    <main className="page">
      <h1>Users</h1>
      <form className="search" role="search" onSubmit={onSearch} key={q}>
        <label className="search__q">
          <span className="sr-only">Search by name or email</span>
          <input name="q" type="search" placeholder="Name or email" defaultValue={q} />
        </label>
        <label>
          <span className="sr-only">Role</span>
          <select value={role} onChange={(e) => set({ role: e.target.value, page: '' })}>
            <option value="">All roles</option>
            {Object.entries(ROLE_NAMES).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select value={status} onChange={(e) => set({ status: e.target.value, page: '' })}>
            <option value="">All statuses</option>
            {['active', 'pending', 'suspended'].map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">Search</Button>
      </form>

      <div aria-live="polite" className="muted results-count">
        {data && `${data.total} ${data.total === 1 ? 'account' : 'accounts'}${isFetching ? ' · updating…' : ''}`}
      </div>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {isPending && <p className="muted">Loading…</p>}
      {isError && <Alert>Could not load users.</Alert>}
      {data && data.items.length === 0 && <p className="empty">No accounts match.</p>}

      {data && data.items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Role</th>
              <th scope="col">Joined</th>
              <th scope="col">Last sign-in</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.name ?? <span className="muted">No name yet</span>}
                  <div className="muted small">
                    {u.email}
                    {u.company && ` · ${u.company.name}`}
                    {u.signInMethod === 'google' && ' · Google'}
                  </div>
                </td>
                <td>{ROLE_NAMES[u.role] ?? u.role}</td>
                <td>{date(u.createdAt)}</td>
                <td>{u.lastLoginAt ? date(u.lastLoginAt) : <span className="muted">Never</span>}</td>
                <td>
                  <StatusBadge status={u.status} />
                </td>
                <td className="actions">
                  {u.role !== 'admin' && u.status !== 'suspended' && (
                    <Button variant="link" busy={busy(suspend, u.id)} onClick={() => onSuspend(u)}>
                      Suspend
                    </Button>
                  )}
                  {u.role !== 'admin' && u.status === 'suspended' && (
                    <Button variant="secondary" busy={busy(reinstate, u.id)} onClick={() => onReinstate(u)}>
                      Reinstate
                    </Button>
                  )}
                  {u.role !== 'admin' && (
                    <Button variant="link" busy={busy(remove, u.id)} onClick={() => onDelete(u)}>
                      Delete
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
