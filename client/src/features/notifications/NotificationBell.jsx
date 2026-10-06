import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMarkRead, useNotifications } from './api';
import { describeNotification } from './describe';

// The bell in the header: unread count, the latest five, and a link to the full list.
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data } = useNotifications({ limit: 5 });
  const markRead = useMarkRead();
  const navigate = useNavigate();
  const ref = useRef(null);
  const unread = data?.unreadCount ?? 0;

  // Close when clicking elsewhere or pressing Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function openItem(notification, to) {
    if (!notification.readAt) markRead.mutate(notification.id);
    setOpen(false);
    if (to) navigate(to);
  }

  return (
    <div className="bell" ref={ref}>
      <button
        type="button"
        className="bell__button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        onClick={() => setOpen((o) => !o)}
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && <span className="bell__count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell__panel" role="menu">
          {data?.items?.length ? (
            <ul>
              {data.items.map((n) => {
                const { text, to } = describeNotification(n);
                return (
                  <li key={n.id}>
                    <button type="button" role="menuitem" className={n.readAt ? '' : 'unread'} onClick={() => openItem(n, to)}>
                      {text}
                      <time dateTime={n.createdAt}>{new Date(n.createdAt).toLocaleString()}</time>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">No notifications yet.</p>
          )}
          <Link to="/notifications" onClick={() => setOpen(false)} className="bell__all">
            See all
          </Link>
        </div>
      )}
    </div>
  );
}
