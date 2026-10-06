import { Suspense, lazy } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { PageLoading } from './ui';
import { homeFor, needsVerification, useAuth } from '../features/auth/auth-context';
import { NotificationBell } from '../features/notifications/NotificationBell';

// The socket client is only needed once someone is signed in.
const RealtimeBridge = lazy(() => import('../features/notifications/RealtimeBridge').then((m) => ({ default: m.RealtimeBridge })));

// Navigation per role. Each portal adds its links here as its pages land.
const NAV = {
  student: [
    { to: '/student', label: 'Dashboard', end: true },
    { to: '/internships', label: 'Find internships' },
    { to: '/applications', label: 'My applications' },
    { to: '/profile', label: 'Profile' },
  ],
  company_rep: [
    { to: '/company', label: 'Dashboard', end: true },
    { to: '/company/postings', label: 'Postings' },
  ],
  supervisor: [{ to: '/supervisor', label: 'Dashboard', end: true }],
  admin: [{ to: '/admin', label: 'Dashboard', end: true }],
};

export function Layout() {
  const { status, user, logout } = useAuth();
  const signedIn = status === 'signedIn';
  const active = signedIn && !needsVerification(user);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar__inner">
          <Link to={signedIn ? homeFor(user) : '/'} className="brand">
            Internship Platform
          </Link>
          {(active || status === 'signedOut') && (
            <nav aria-label="Main">
              {(active ? (NAV[user.role] ?? []) : [{ to: '/internships', label: 'Internships' }]).map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          )}
          <div className="topbar__right">
            {active && <NotificationBell />}
            {signedIn ? (
              <>
                <span className="muted topbar__user">{user.email}</span>
                <button type="button" className="btn btn--link" onClick={logout}>
                  Sign out
                </button>
              </>
            ) : (
              status === 'signedOut' && (
                <>
                  <NavLink to="/login">Sign in</NavLink>
                  <NavLink to="/register" className="btn btn--primary btn--small">
                    Register
                  </NavLink>
                </>
              )
            )}
          </div>
        </div>
      </header>
      {active && (
        <Suspense fallback={null}>
          <RealtimeBridge />
        </Suspense>
      )}
      <div id="main">
        {/* Portal pages load on demand (routes/AppRoutes.jsx). */}
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </div>
    </>
  );
}
