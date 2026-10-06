import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui';
import { useMarkAllRead, useMarkRead, useNotifications } from './api';
import { describeNotification } from './describe';

export function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const { data, isPending, isError } = useNotifications({ page, limit: 20, unread: unreadOnly || undefined });
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <main className="page">
      <header className="page__header">
        <h1>Notifications</h1>
        <div className="inline-actions">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => {
                setUnreadOnly(e.target.checked);
                setPage(1);
              }}
            />{' '}
            Unread only
          </label>
          <Button variant="secondary" busy={markAll.isPending} disabled={!data?.unreadCount} onClick={() => markAll.mutate()}>
            Mark all read
          </Button>
        </div>
      </header>

      {isPending && <p className="muted">Loading…</p>}
      {isError && <p className="alert alert--error">Could not load notifications.</p>}
      {data && data.items.length === 0 && <p className="muted">Nothing here yet.</p>}
      {data && data.items.length > 0 && (
        <ul className="list">
          {data.items.map((n) => {
            const { text, to } = describeNotification(n);
            return (
              <li key={n.id} className={`list__item${n.readAt ? '' : ' unread'}`}>
                <div>
                  {to ? (
                    <Link to={to} onClick={() => !n.readAt && markRead.mutate(n.id)}>
                      {text}
                    </Link>
                  ) : (
                    text
                  )}
                  <time className="muted" dateTime={n.createdAt}>
                    {new Date(n.createdAt).toLocaleString()}
                  </time>
                </div>
                {!n.readAt && (
                  <Button variant="link" onClick={() => markRead.mutate(n.id)}>
                    Mark read
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <nav className="pager" aria-label="Pages">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </nav>
      )}
    </main>
  );
}
